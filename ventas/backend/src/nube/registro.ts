import { Logger } from '@nestjs/common';
import { PrismaClient, Rol, TipoComprobante } from '@prisma/client';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { enInquilino, InfoEmpresa, Inquilino } from './contexto';
import { panel } from './panel';

const ejecutar = promisify(execFile);
const VIGENCIA_MS = Number(process.env.PANEL_CACHE_MS ?? 30_000);

/**
 * Empresas atendidas por este proceso: su ficha del panel (en caché unos segundos),
 * su conexión a la base y su preparación (migraciones y datos iniciales).
 */
class RegistroEmpresas {
  private readonly log = new Logger('Empresas');
  private fichas = new Map<string, { info: InfoEmpresa | null; hasta: number; pedido?: Promise<InfoEmpresa | null> }>();
  private clientes = new Map<string, PrismaClient>();
  private preparadas = new Map<string, Promise<void>>();
  // Último hash de la clave del administrador ya aplicado, para no leer la base en cada petición.
  private claveAplicada = new Map<string, string>();

  urlBase(baseDatos: string) {
    const plantilla = process.env.EMPRESA_DATABASE_URL;
    if (!plantilla?.includes('{db}')) throw new Error('Falta EMPRESA_DATABASE_URL con {db}, p. ej. postgresql://u:c@db:5432/{db}');
    return plantilla.replace('{db}', baseDatos);
  }

  private async ficha(sub: string): Promise<InfoEmpresa | null> {
    const f = this.fichas.get(sub);
    if (f && f.hasta > Date.now()) return f.info;
    if (f?.pedido) return f.pedido;
    const pedido = panel.empresa(sub).then(
      (info) => {
        this.fichas.set(sub, { info, hasta: Date.now() + VIGENCIA_MS });
        return info;
      },
      (e) => {
        // Si el panel no responde, se sigue con la última ficha conocida.
        if (f) {
          this.fichas.set(sub, { info: f.info, hasta: Date.now() + 5_000 });
          return f.info;
        }
        this.fichas.delete(sub);
        throw e;
      },
    );
    this.fichas.set(sub, { info: f?.info ?? null, hasta: 0, pedido });
    return pedido;
  }

  /** Olvida la ficha en caché (p. ej. tras cambiar la clave) para pedirla de nuevo. */
  olvidar(sub: string) {
    this.fichas.delete(sub);
  }

  private cliente(info: InfoEmpresa) {
    let c = this.clientes.get(info.baseDatos);
    if (!c) {
      c = new PrismaClient({ datasourceUrl: this.urlBase(info.baseDatos) });
      this.clientes.set(info.baseDatos, c);
    }
    return c;
  }

  async obtener(sub: string): Promise<Inquilino | null> {
    const info = await this.ficha(sub);
    if (!info) return null;
    const cliente = this.cliente(info);
    let prep = this.preparadas.get(sub);
    if (!prep) {
      prep = this.preparar(sub, info, cliente).catch((e) => {
        this.preparadas.delete(sub);
        throw e;
      });
      this.preparadas.set(sub, prep);
    }
    await prep;
    if (this.claveAplicada.get(sub) !== info.admin.claveHash) await this.sincronizarAdmin(sub, info, cliente);
    return { subdominio: sub, info, cliente };
  }

  /**
   * Una vez por proceso y empresa: aplica las migraciones pendientes (también a las
   * empresas ya creadas cuando sale una versión nueva) y deja los datos iniciales.
   */
  private async preparar(sub: string, info: InfoEmpresa, cliente: PrismaClient) {
    const inicio = Date.now();
    const prisma = join(process.cwd(), 'node_modules', '.bin', 'prisma');
    await ejecutar(prisma, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: this.urlBase(info.baseDatos) },
      timeout: 5 * 60_000,
    });
    await cliente.configuracion.upsert({
      where: { id: 1 },
      create: { id: 1, empresaNombre: info.empresa.razonSocial.toUpperCase(), empresaRuc: info.empresa.ruc, empresaRazonSocial: info.empresa.razonSocial },
      update: {},
    });
    for (const s of [
      { serie: 'B001', tipo: TipoComprobante.BOLETA },
      { serie: 'L001', tipo: TipoComprobante.BOLETA_LIBRE },
    ]) {
      await cliente.serie.upsert({ where: { serie: s.serie }, create: s, update: {} });
    }
    const usuario = info.admin.usuario.toLowerCase();
    if (!(await cliente.usuario.findUnique({ where: { usuario } }))) {
      await cliente.usuario.create({ data: { usuario, nombre: 'Administrador', rol: Rol.ADMIN, passwordHash: info.admin.claveHash } });
      await cliente.configuracion.update({ where: { id: 1 }, data: { nubeAdminHash: info.admin.claveHash } });
    }
    if (!info.aprovisionado) {
      await panel.reportar(sub, { aprovisionado: true }).catch((e) => this.log.warn(`${sub}: ${(e as Error).message}`));
    }
    this.log.log(`${sub}: base ${info.baseDatos} lista en ${Date.now() - inicio} ms`);
  }

  /** Aplica la clave temporal que Infosmart generó para el administrador, si es nueva. */
  private async sincronizarAdmin(sub: string, info: InfoEmpresa, cliente: PrismaClient) {
    const cfg = await cliente.configuracion.findUnique({ where: { id: 1 }, select: { nubeAdminHash: true } });
    if (cfg?.nubeAdminHash !== info.admin.claveHash) {
      const usuario = info.admin.usuario.toLowerCase();
      await cliente.usuario.upsert({
        where: { usuario },
        create: { usuario, nombre: 'Administrador', rol: Rol.ADMIN, passwordHash: info.admin.claveHash },
        update: { passwordHash: info.admin.claveHash, activo: true, rol: Rol.ADMIN, perfilId: null },
      });
      await cliente.configuracion.update({ where: { id: 1 }, data: { nubeAdminHash: info.admin.claveHash } });
      this.log.log(`${sub}: clave del administrador actualizada desde Infosmart`);
    }
    this.claveAplicada.set(sub, info.admin.claveHash);
  }

  /** Corre `fn` dentro de cada empresa activa, una tras otra (tareas programadas). */
  async paraCadaEmpresa(nombre: string, fn: () => Promise<unknown>) {
    let subs: string[];
    try {
      subs = await panel.empresasActivas();
    } catch (e) {
      this.log.warn(`${nombre}: no se pudo listar empresas: ${(e as Error).message}`);
      return;
    }
    for (const sub of subs) {
      try {
        const i = await this.obtener(sub);
        if (i?.info.acceso.permitido) await enInquilino(i, fn);
      } catch (e) {
        this.log.warn(`${nombre} en ${sub}: ${(e as Error).message}`);
      }
    }
  }

  async cerrar() {
    await Promise.all([...this.clientes.values()].map((c) => c.$disconnect()));
  }
}

export const registro = new RegistroEmpresas();
