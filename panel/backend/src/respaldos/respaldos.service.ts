import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Producto } from '@prisma/client';
import { execFile } from 'child_process';
import { mkdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { config } from '../config';
import { accesoEmpresa } from '../empresas/reglas';
import { PrismaService } from '../prisma/prisma.service';

const ejecutar = promisify(execFile);
const LIMA_MS = -5 * 3600_000; // Perú no tiene horario de verano

/** "Ahora" en hora de Lima, para nombres de archivo y la hora programada. */
export function enLima(d = new Date()) {
  return new Date(d.getTime() + LIMA_MS);
}

/** Inicio (en UTC) del backup de hoy a la hora HH:MM de Lima. */
export function horaProgramada(hora: string, ahora = new Date()) {
  const [h, m] = hora.split(':').map(Number);
  const lima = enLima(ahora);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), h || 0, m || 0) - LIMA_MS);
}

export function urlDeBase(baseDatos: string, url = config.databaseUrl) {
  const u = new URL(url);
  u.pathname = `/${baseDatos}`;
  u.search = '';
  return u.toString();
}

/**
 * Backups de las bases de cada empresa con pg_dump, en RESPALDOS_DIR/<base>/.
 * Corre uno a la vez: el programado de cada día, el pedido desde el panel y el
 * que pide el sistema de ventas al cerrar caja.
 */
@Injectable()
export class RespaldosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Respaldos');
  private reloj?: NodeJS.Timeout;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.RESPALDOS_AUTOMATICOS === '0') return;
    this.reloj = setInterval(() => void this.revisarProgramados(), 5 * 60_000);
    setTimeout(() => void this.revisarProgramados(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.reloj);
  }

  async revisarProgramados(ahora = new Date()) {
    try {
      const productos = await this.prisma.productoEmpresa.findMany({
        where: { aprovisionado: true },
        include: { empresa: true, ajustes: true },
      });
      for (const pe of productos) {
        // Una empresa suspendida no cambia sus datos: no hace falta respaldarla cada día.
        if (!accesoEmpresa(pe.empresa.estado, pe.empresa.venceEl).permitido) continue;
        const desde = horaProgramada(pe.ajustes?.backupHora ?? '03:00', ahora);
        if (ahora < desde) continue;
        const hecho = await this.prisma.respaldo.findFirst({ where: { productoEmpresaId: pe.id, ok: true, motivo: 'programado', creadoEl: { gte: desde } } });
        if (!hecho) await this.encolar(pe.id, 'programado');
      }
    } catch (e) {
      this.log.error(`Revisión programada: ${(e as Error).message}`);
    }
  }

  /** Pone un backup en la cola y espera a que termine. */
  encolar(productoEmpresaId: number, motivo: string) {
    const tarea = this.cola.then(() => this.hacer(productoEmpresaId, motivo));
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async hacer(productoEmpresaId: number, motivo: string) {
    const pe = await this.prisma.productoEmpresa.findUniqueOrThrow({ where: { id: productoEmpresaId }, include: { ajustes: true } });
    const carpeta = join(config.respaldosDir, pe.baseDatos);
    const sello = enLima().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
    const archivo = join(carpeta, `${pe.baseDatos}_${sello}.backup`);
    try {
      await mkdir(carpeta, { recursive: true });
      await ejecutar(config.pgDump, ['--format=custom', '--no-owner', `--file=${archivo}`, urlDeBase(pe.baseDatos)], { timeout: 15 * 60_000 });
      const { size } = await stat(archivo);
      const r = await this.prisma.respaldo.create({ data: { productoEmpresaId, ok: true, motivo, archivo, bytes: size } });
      this.log.log(`${pe.baseDatos} (${motivo}): ${size} bytes`);
      await this.limpiar(productoEmpresaId, pe.ajustes?.backupConservar ?? 14);
      return r;
    } catch (e) {
      const error = (e as Error).message.split('\n')[0].slice(0, 500);
      this.log.error(`${pe.baseDatos} (${motivo}) falló: ${error}`);
      await unlink(archivo).catch(() => undefined);
      return this.prisma.respaldo.create({ data: { productoEmpresaId, ok: false, motivo, error } });
    }
  }

  /** Borra los archivos más antiguos y deja los últimos `conservar`. */
  private async limpiar(productoEmpresaId: number, conservar: number) {
    const viejos = await this.prisma.respaldo.findMany({
      where: { productoEmpresaId, ok: true, disponible: true },
      orderBy: { creadoEl: 'desc' },
      skip: Math.max(1, conservar),
    });
    for (const r of viejos) {
      if (r.archivo) await unlink(r.archivo).catch(() => undefined);
      await this.prisma.respaldo.update({ where: { id: r.id }, data: { disponible: false } });
    }
  }

  async listar(empresaId: number, producto: Producto) {
    const pe = await this.prisma.productoEmpresa.findUnique({ where: { empresaId_producto: { empresaId, producto } } });
    if (!pe) throw new NotFoundException('La empresa no tiene ese producto');
    const respaldos = await this.prisma.respaldo.findMany({ where: { productoEmpresaId: pe.id }, orderBy: { creadoEl: 'desc' }, take: 60 });
    return respaldos.map(({ archivo, ...r }) => ({ ...r, nombre: archivo?.split('/').pop() ?? null }));
  }

  async archivo(id: number) {
    const r = await this.prisma.respaldo.findUnique({ where: { id } });
    if (!r?.ok || !r.disponible || !r.archivo) throw new NotFoundException('Ese backup ya no está disponible');
    return r.archivo;
  }
}
