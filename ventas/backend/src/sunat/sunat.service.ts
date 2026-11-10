import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EstadoSunat, ModoSunat, Prisma, TipoComprobante } from '@prisma/client';
import { createHash } from 'crypto';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { NUBE, PorEmpresa } from '../nube/contexto';
import { registro } from '../nube/registro';
import { PrismaService } from '../prisma/prisma.service';
import { Certificado, leerPfx } from './certificado';
import { firmarXml } from './firma';
import { guardarCertificado, guardarClaves, leerCertificado, leerClaves } from './secretos';
import { Cdr, Credenciales, ENDPOINTS, ErrorSunat, getStatus, sendBill, sendSummary } from './soap';
import { boletaUbl, Emisor, fechaLima, resumenBajaUbl } from './ubl';

/** Una boleta debe informarse a SUNAT en un plazo corto: avisamos desde 2 días. */
export const DIAS_AVISO_PENDIENTE = 2;

const ventaXml = {
  cliente: true,
  items: { include: { producto: { select: { codigoBarra: true, id: true } }, presentacion: { select: { codigoBarra: true } } } },
} satisfies Prisma.VentaInclude;

@Injectable()
export class SunatService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SUNAT');
  private reloj?: NodeJS.Timeout;
  // Cola, pausas y certificado van por empresa: en la nube un mismo proceso atiende a varias.
  private readonly cola = new PorEmpresa(() => ({
    procesando: null as Promise<unknown> | null,
    // Correcciones de ventas en curso: mientras haya alguna, la cola no envía.
    pausas: 0,
    cert: null as { huella: string; cert: Certificado } | null,
  }));

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfiguracionService,
  ) {}

  onModuleInit() {
    if (process.env.SUNAT_AUTOMATICO === '0') return;
    this.reloj = setInterval(
      () => void (NUBE ? registro.paraCadaEmpresa('SUNAT', () => this.procesar()) : this.procesar()),
      2 * 60_000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.reloj);
  }

  // ------------------------------------------------------------ configuración

  async activo() {
    return (await this.config.obtener()).sunatModo !== ModoSunat.DESACTIVADO;
  }

  private async emisor(): Promise<Emisor> {
    const c = await this.config.obtener();
    const faltan = [
      !c.empresaRuc && 'RUC',
      !c.empresaRazonSocial && 'razón social',
      !c.empresaDireccion && 'dirección',
      !c.empresaUbigeo && 'ubigeo',
    ].filter(Boolean);
    if (faltan.length) throw new BadRequestException(`Faltan datos del emisor: ${faltan.join(', ')}`);
    return {
      ruc: c.empresaRuc!,
      razonSocial: c.empresaRazonSocial!,
      nombreComercial: c.empresaNombre,
      direccion: c.empresaDireccion!,
      ubigeo: c.empresaUbigeo!,
      departamento: c.empresaDepartamento ?? '',
      provincia: c.empresaProvincia ?? '',
      distrito: c.empresaDistrito ?? '',
      codigoEstablecimiento: c.codigoEstablecimiento,
    };
  }

  private async certificado(): Promise<Certificado> {
    const pfx = await leerCertificado();
    if (!pfx) {
      throw new BadRequestException(NUBE ? 'Infosmart aún no cargó el certificado digital de tu empresa' : 'Carga el certificado digital en Configuración → SUNAT');
    }
    const { certificadoClave } = await leerClaves();
    // Si el panel cambia el certificado, la huella cambia y se vuelve a leer.
    const huella = createHash('sha256').update(pfx).update(certificadoClave ?? '').digest('hex');
    const c = this.cola.actual;
    if (c.cert?.huella !== huella) c.cert = { huella, cert: leerPfx(pfx, certificadoClave ?? '') };
    return c.cert.cert;
  }

  private async credenciales(): Promise<Credenciales> {
    const c = await this.config.obtener();
    if (c.sunatModo === ModoSunat.DESACTIVADO) throw new BadRequestException('La facturación electrónica está desactivada');
    if (c.sunatModo === ModoSunat.BETA) {
      // SUNAT beta acepta el usuario genérico MODDATOS.
      return { url: ENDPOINTS.BETA, usuario: `${c.empresaRuc}MODDATOS`, clave: 'moddatos' };
    }
    const { solUsuario, solClave } = await leerClaves();
    if (!solUsuario || !solClave) throw new BadRequestException('Falta el usuario SOL secundario y su clave');
    return { url: ENDPOINTS.PRODUCCION, usuario: `${c.empresaRuc}${solUsuario.toUpperCase()}`, clave: solClave };
  }

  async cargarCertificado(pfx: Buffer, clave: string) {
    const cert = leerPfx(pfx, clave); // valida antes de guardar
    await guardarCertificado(pfx);
    await guardarClaves({ certificadoClave: clave });
    this.cola.actual.cert = { huella: createHash('sha256').update(pfx).update(clave).digest('hex'), cert };
    return this.estado();
  }

  async guardarSol(usuario?: string, clave?: string) {
    await guardarClaves({ solUsuario: usuario?.trim(), solClave: clave });
    return this.estado();
  }

  async estado() {
    const c = await this.config.obtener();
    const claves = await leerClaves();
    let certificado: { sujeto: string; emisor: string; venceEl: Date } | null = null;
    let errorCertificado: string | null = null;
    try {
      const x = await this.certificado();
      certificado = { sujeto: x.sujeto, emisor: x.emisor, venceEl: x.venceEl };
    } catch (e) {
      errorCertificado = (e as Error).message;
    }
    const [porEstado, atrasadas] = await Promise.all([
      this.prisma.venta.groupBy({ by: ['estadoSunat'], where: { tipoComprobante: TipoComprobante.BOLETA }, _count: true }),
      this.prisma.venta.count({
        where: {
          estadoSunat: { in: [EstadoSunat.PENDIENTE, EstadoSunat.RECHAZADO] },
          fecha: { lt: new Date(Date.now() - DIAS_AVISO_PENDIENTE * 86_400_000) },
        },
      }),
    ]);
    return {
      // En la nube el modo, el certificado y la clave SOL los maneja Infosmart.
      nube: NUBE,
      modo: c.sunatModo,
      certificado,
      errorCertificado,
      solConfigurado: Boolean(claves.solUsuario && claves.solClave),
      solUsuario: claves.solUsuario ?? null,
      conteo: Object.fromEntries(porEstado.map((p) => [p.estadoSunat, p._count])),
      atrasadas,
    };
  }

  // ---------------------------------------------------------------- boletas

  /** Genera y firma el XML; guarda el hash para el ticket y el QR. */
  async firmarVenta(id: number) {
    const v = await this.prisma.venta.findUniqueOrThrow({ where: { id }, include: ventaXml });
    if (v.tipoComprobante !== TipoComprobante.BOLETA) return v;
    const xml = boletaUbl(
      {
        serie: v.serie,
        numero: v.numero,
        fecha: v.fecha,
        cliente: v.cliente,
        descuento: Number(v.descuento),
        items: v.items.map((i) => ({
          codigo: i.presentacion?.codigoBarra ?? i.producto.codigoBarra ?? String(i.producto.id),
          descripcion: i.descripcion,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
          descuento: Number(i.descuento),
          afectacion: i.afectacionIgv,
        })),
      },
      await this.emisor(),
    );
    const firmado = firmarXml(xml, await this.certificado());
    return this.prisma.venta.update({ where: { id }, data: { xmlFirmado: firmado.xml, hashCpe: firmado.hash } });
  }

  private nombreArchivo(ruc: string, tipo: string, serie: string, numero: number | string) {
    return `${ruc}-${tipo}-${serie}-${numero}`;
  }

  /** Envía una boleta. Si no hay conexión, queda pendiente para el siguiente intento. */
  async enviarVenta(id: number): Promise<'ok' | 'sin-conexion' | 'error'> {
    let v = await this.prisma.venta.findUniqueOrThrow({ where: { id } });
    if (v.estadoSunat !== EstadoSunat.PENDIENTE && v.estadoSunat !== EstadoSunat.RECHAZADO) return 'ok';
    try {
      if (!v.xmlFirmado) v = await this.firmarVenta(id);
      const cfg = await this.config.obtener();
      const cdr = await sendBill(await this.credenciales(), this.nombreArchivo(cfg.empresaRuc!, '03', v.serie, v.numero), v.xmlFirmado!);
      await this.aplicarCdr(v.id, cdr);
      return 'ok';
    } catch (e) {
      const sinConexion = !(e instanceof ErrorSunat) && !(e instanceof BadRequestException);
      const rechazo = e instanceof ErrorSunat && e.rechazo;
      await this.prisma.venta.update({
        where: { id },
        data: {
          sunatIntentos: { increment: 1 },
          sunatError: e instanceof ErrorSunat ? `${e.codigo}: ${e.message}` : sinConexion ? 'Sin conexión con SUNAT; se reintentará automáticamente' : (e as Error).message,
          ...(rechazo ? { estadoSunat: EstadoSunat.RECHAZADO, cdrCodigo: (e as ErrorSunat).codigo, cdrMensaje: (e as Error).message } : {}),
        },
      });
      // Si SUNAT llegó a responder, queda en el historial de envíos. Un mismo error
      // repetido por los reintentos automáticos se anota una sola vez.
      if (e instanceof ErrorSunat) {
        const ultimo = await this.prisma.envioSunat.findFirst({ where: { ventaId: id }, orderBy: { id: 'desc' } });
        const resultado = rechazo ? 'RECHAZADO' : 'ERROR';
        if (!(ultimo && ultimo.resultado === resultado && ultimo.codigo === e.codigo)) {
          await this.prisma.envioSunat.create({ data: { ventaId: id, resultado, codigo: e.codigo, mensaje: e.message.slice(0, 1000) } });
        }
      }
      if (!sinConexion) this.log.warn(`Boleta ${v.serie}-${v.numero}: ${(e as Error).message}`);
      return sinConexion ? 'sin-conexion' : 'error';
    }
  }

  private async aplicarCdr(id: number, cdr: Cdr) {
    const codigo = Number(cdr.codigo);
    const estado = codigo === 0 ? EstadoSunat.ACEPTADO : codigo >= 4000 ? EstadoSunat.OBSERVADO : EstadoSunat.RECHAZADO;
    const mensaje = [cdr.descripcion, ...cdr.observaciones].join(' | ').slice(0, 1000);
    const ahora = new Date();
    const [v] = await this.prisma.$transaction([
      this.prisma.venta.update({
        where: { id },
        data: {
          estadoSunat: estado,
          cdrCodigo: cdr.codigo,
          cdrMensaje: mensaje,
          sunatEnviadoEn: ahora,
          sunatIntentos: { increment: 1 },
          sunatError: null,
        },
      }),
      this.prisma.envioSunat.create({ data: { ventaId: id, fecha: ahora, resultado: estado as 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO', codigo: cdr.codigo, mensaje } }),
    ]);
    // Si la venta se anuló antes de llegar a SUNAT, ahora toca darla de baja.
    if (v.estado === 'ANULADA' && (estado === EstadoSunat.ACEPTADO || estado === EstadoSunat.OBSERVADO)) {
      await this.prisma.venta.update({ where: { id }, data: { estadoSunat: EstadoSunat.BAJA_PENDIENTE } });
    }
  }

  /** Al anular una venta: las boletas ya aceptadas se informan como baja. */
  async marcarBaja(tx: Prisma.TransactionClient, id: number) {
    const v = await tx.venta.findUniqueOrThrow({ where: { id } });
    if (v.estadoSunat === EstadoSunat.ACEPTADO || v.estadoSunat === EstadoSunat.OBSERVADO) {
      await tx.venta.update({ where: { id }, data: { estadoSunat: EstadoSunat.BAJA_PENDIENTE } });
    }
  }

  // ----------------------------------------------------------------- bajas

  private async enviarBajas() {
    const pendientes = await this.prisma.venta.findMany({
      where: { estadoSunat: EstadoSunat.BAJA_PENDIENTE },
      include: { cliente: true },
      orderBy: { id: 'asc' },
    });
    if (!pendientes.length) return;
    const emisor = await this.emisor();
    const cert = await this.certificado();
    const cred = await this.credenciales();
    // Un resumen por fecha de emisión de las boletas.
    const porFecha = new Map<string, typeof pendientes>();
    for (const v of pendientes) {
      const f = fechaLima(v.fecha).fecha;
      porFecha.set(f, [...(porFecha.get(f) ?? []), v]);
    }
    for (const [referencia, ventas] of porFecha) {
      const hoy = fechaLima(new Date()).fecha;
      const n = (await this.prisma.resumenDiario.count({ where: { identificador: { startsWith: `RC-${hoy.replace(/-/g, '')}-` } } })) + 1;
      const identificador = `RC-${hoy.replace(/-/g, '')}-${n}`;
      const xml = resumenBajaUbl(
        identificador,
        referencia,
        hoy,
        ventas.map((v) => ({
          serie: v.serie,
          numero: v.numero,
          cliente: v.cliente,
          total: Number(v.total),
          opGravada: Number(v.opGravada),
          opExonerada: Number(v.opExonerada),
          opInafecta: Number(v.opInafecta),
          igv: Number(v.igv),
        })),
        emisor,
      );
      const firmado = firmarXml(xml, cert).xml;
      const ticket = await sendSummary(cred, `${emisor.ruc}-${identificador}`, firmado);
      await this.prisma.resumenDiario.create({
        data: {
          identificador,
          fechaReferencia: new Date(`${referencia}T00:00:00Z`),
          ticket,
          xmlFirmado: firmado,
          ventas: { connect: ventas.map((v) => ({ id: v.id })) },
        },
      });
      await this.prisma.venta.updateMany({ where: { id: { in: ventas.map((v) => v.id) } }, data: { estadoSunat: EstadoSunat.BAJA_ENVIADA } });
    }
  }

  private async consultarTickets() {
    const enviados = await this.prisma.resumenDiario.findMany({ where: { estado: 'ENVIADO' }, include: { ventas: { select: { id: true } } } });
    if (!enviados.length) return;
    const cred = await this.credenciales();
    for (const r of enviados) {
      const { estado, cdr } = await getStatus(cred, r.ticket!);
      if (estado === '98') continue; // SUNAT aún lo procesa
      const ok = estado === '0' && cdr && (Number(cdr.codigo) === 0 || Number(cdr.codigo) >= 4000);
      await this.prisma.resumenDiario.update({
        where: { id: r.id },
        data: { estado: ok ? 'ACEPTADO' : 'RECHAZADO', cdrCodigo: cdr?.codigo, mensaje: cdr?.descripcion },
      });
      await this.prisma.venta.updateMany({
        where: { id: { in: r.ventas.map((v) => v.id) } },
        // Si SUNAT rechaza el resumen, las boletas vuelven a la cola de bajas.
        data: ok ? { estadoSunat: EstadoSunat.BAJA_ACEPTADA } : { estadoSunat: EstadoSunat.BAJA_PENDIENTE, sunatError: cdr?.descripcion ?? `Resumen ${r.identificador} rechazado`, resumenBajaId: null },
      });
    }
  }

  // ----------------------------------------------------------------- cola

  /** Envía lo pendiente. Lo llama el reloj cada 2 minutos y el botón "Enviar ahora". */
  procesar() {
    const c = this.cola.actual;
    if (c.pausas) return Promise.resolve();
    c.procesando ??= this.procesarCola()
      .catch((e) => this.log.warn((e as Error).message))
      .finally(() => (c.procesando = null));
    return c.procesando;
  }

  private async procesarCola() {
    if (!(await this.activo())) return;
    const pendientes = await this.prisma.venta.findMany({
      where: { estadoSunat: EstadoSunat.PENDIENTE },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 50,
    });
    for (const { id } of pendientes) {
      // Sin internet no tiene sentido seguir intentando con las demás.
      if ((await this.enviarVenta(id)) === 'sin-conexion') return;
    }
    await this.enviarBajas();
    await this.consultarTickets();
  }

  /**
   * Ejecuta `fn` con la cola de envíos detenida, para corregir una boleta sin que
   * salga a SUNAT a medio cambiar. Si había un envío en curso, primero espera que termine.
   */
  async sinEnvios<T>(fn: () => Promise<T>): Promise<T> {
    const c = this.cola.actual;
    c.pausas++;
    try {
      await c.procesando;
      return await fn();
    } finally {
      c.pausas--;
    }
  }

  /** Prueba de punta a punta con el entorno beta de SUNAT. */
  async probarBeta() {
    const cfg = await this.config.obtener();
    const emisor = await this.emisor();
    const numero = Math.floor(Date.now() / 1000) % 100000000;
    const xml = boletaUbl(
      {
        serie: 'B999',
        numero,
        fecha: new Date(),
        cliente: null,
        descuento: 0,
        items: [{ codigo: 'PRUEBA', descripcion: 'PRODUCTO DE PRUEBA', cantidad: 1, precioUnitario: 1, descuento: 0, afectacion: 'EXONERADO' }],
      },
      emisor,
    );
    const firmado = firmarXml(xml, await this.certificado());
    const cdr = await sendBill(
      { url: ENDPOINTS.BETA, usuario: `${cfg.empresaRuc}MODDATOS`, clave: 'moddatos' },
      this.nombreArchivo(emisor.ruc, '03', 'B999', numero),
      firmado.xml,
    );
    return { ...cdr, hash: firmado.hash };
  }
}
