import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCaja, EstadoVenta, MedioPago, Prisma, TipoMovimientoCaja } from '@prisma/client';
import { BackupService } from '../backup/backup.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { FondoService } from '../fondo/fondo.service';
import { PrismaService } from '../prisma/prisma.service';

/** Billetes y monedas en soles para el contador del cierre, de menor a mayor. */
export const DENOMINACIONES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

/** Medios que no son efectivo: al cerrar se confirman con la app o el voucher del POS. */
const MEDIOS_DIGITALES = Object.values(MedioPago).filter((m) => m !== MedioPago.EFECTIVO);

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class CajaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfiguracionService,
    private readonly backup: BackupService,
    private readonly fondo: FondoService,
  ) {}

  /** La caja abierta (solo hay una caja en la tienda) o null. */
  abierta(tx: Prisma.TransactionClient = this.prisma) {
    return tx.caja.findFirst({ where: { estado: EstadoCaja.ABIERTA }, orderBy: { id: 'desc' } });
  }

  async exigirAbierta(tx: Prisma.TransactionClient = this.prisma) {
    const c = await this.abierta(tx);
    if (!c) throw new BadRequestException('Abre la caja antes de vender o registrar movimientos');
    return c;
  }

  async actual() {
    const c = await this.abierta();
    return c ? this.detalle(c.id) : null;
  }

  async abrir(usuarioId: number, montoInicial?: number) {
    if (await this.abierta()) throw new BadRequestException('Ya hay una caja abierta');
    const cfg = await this.config.obtener();
    const c = await this.prisma.caja.create({
      data: { usuarioAperturaId: usuarioId, montoInicial: montoInicial ?? cfg.montoInicialCaja },
    });
    return this.detalle(c.id);
  }

  async movimiento(usuarioId: number, tipo: TipoMovimientoCaja, concepto: string | undefined, monto: number, medioPago?: MedioPago) {
    const c = await this.exigirAbierta();
    concepto = concepto?.trim() ?? '';
    if (tipo === TipoMovimientoCaja.VENTA_SIN_COMPROBANTE) {
      medioPago ??= MedioPago.EFECTIVO;
      concepto ||= 'Venta sin comprobante';
    } else if (tipo === TipoMovimientoCaja.EGRESO) {
      // Los gastos se registran con su categoría (Gastos › Registrar gasto, origen caja del día).
      throw new BadRequestException('Registra el gasto con su categoría desde «Gasto»');
    } else {
      medioPago = undefined;
      if (concepto.length < 3) throw new BadRequestException('Escribe el concepto (mínimo 3 letras)');
    }
    if (tipo === TipoMovimientoCaja.RETIRO) {
      const { efectivoEsperado } = await this.resumen(c.id);
      if (monto > efectivoEsperado) {
        throw new BadRequestException(`No hay suficiente efectivo en caja (S/ ${efectivoEsperado.toFixed(2)})`);
      }
    }
    await this.prisma.movimientoCaja.create({ data: { cajaId: c.id, usuarioId, tipo, concepto, monto, medioPago } });
    return this.detalle(c.id);
  }

  /** Totales de la caja calculados a partir de ventas y movimientos. */
  async resumen(cajaId: number, tx: Prisma.TransactionClient = this.prisma) {
    const caja = await tx.caja.findUniqueOrThrow({ where: { id: cajaId } });
    const [pagos, porTipo, anuladas, movs] = await Promise.all([
      tx.ventaPago.groupBy({
        by: ['medioPago'],
        where: { venta: { cajaId, estado: EstadoVenta.EMITIDA } },
        _sum: { monto: true },
      }),
      tx.venta.groupBy({
        by: ['tipoComprobante'],
        where: { cajaId, estado: EstadoVenta.EMITIDA },
        _sum: { total: true, costoTotal: true, descuento: true },
        _count: true,
      }),
      tx.venta.aggregate({ where: { cajaId, estado: EstadoVenta.ANULADA }, _sum: { total: true }, _count: true }),
      tx.movimientoCaja.findMany({ where: { cajaId }, select: { tipo: true, monto: true, medioPago: true, pagoProveedorId: true } }),
    ]);

    const ceros = () => Object.fromEntries(Object.values(MedioPago).map((m) => [m, 0])) as Record<MedioPago, number>;
    const porMedio = ceros();
    pagos.forEach((p) => (porMedio[p.medioPago] = r2(Number(p._sum.monto ?? 0))));
    let ingresos = 0;
    let gastos = 0;
    let retiros = 0;
    let pagosProveedor = 0;
    const sinComprobante = ceros();
    for (const m of movs) {
      const monto = Number(m.monto);
      if (m.tipo === TipoMovimientoCaja.INGRESO) ingresos += monto;
      else if (m.tipo === TipoMovimientoCaja.VENTA_SIN_COMPROBANTE) sinComprobante[m.medioPago ?? MedioPago.EFECTIVO] += monto;
      else if (m.tipo === TipoMovimientoCaja.RETIRO) retiros += monto;
      else if (m.pagoProveedorId) pagosProveedor += monto;
      else gastos += monto;
    }
    Object.values(MedioPago).forEach((m) => (sinComprobante[m] = r2(sinComprobante[m])));
    const egresos = gastos + retiros + pagosProveedor;
    const totalSinComprobante = r2(Object.values(sinComprobante).reduce((s, v) => s + v, 0));
    // Lo que entró por cada medio: ventas del sistema más ventas sin comprobante.
    const totalPorMedio = ceros();
    Object.values(MedioPago).forEach((m) => (totalPorMedio[m] = r2(porMedio[m] + sinComprobante[m])));
    const totalVentas = r2(porTipo.reduce((s, t) => s + Number(t._sum.total ?? 0), 0));
    const costo = r2(porTipo.reduce((s, t) => s + Number(t._sum.costoTotal ?? 0), 0));

    return {
      montoInicial: Number(caja.montoInicial),
      totalVentas,
      numeroVentas: porTipo.reduce((s, t) => s + t._count, 0),
      utilidad: r2(totalVentas - costo),
      porMedio,
      porComprobante: porTipo.map((t) => ({
        tipo: t.tipoComprobante,
        cantidad: t._count,
        total: Number(t._sum.total ?? 0),
        descuento: Number(t._sum.descuento ?? 0),
      })),
      anuladas: { cantidad: anuladas._count, total: Number(anuladas._sum.total ?? 0) },
      sinComprobante: { porMedio: sinComprobante, total: totalSinComprobante },
      totalPorMedio,
      ingresos: r2(ingresos),
      gastos: r2(gastos),
      retiros: r2(retiros),
      pagosProveedor: r2(pagosProveedor),
      egresos: r2(egresos),
      // Total de efectivo que debe haber en caja.
      efectivoEsperado: r2(Number(caja.montoInicial) + totalPorMedio.EFECTIVO + ingresos - egresos),
    };
  }

  async detalle(id: number) {
    const caja = await this.prisma.caja.findUnique({
      where: { id },
      include: {
        usuarioApertura: { select: { nombre: true } },
        usuarioCierre: { select: { nombre: true } },
        movimientos: { include: { usuario: { select: { nombre: true } } }, orderBy: { fecha: 'asc' } },
      },
    });
    if (!caja) throw new NotFoundException('Caja no encontrada');
    // Una caja cerrada muestra el resumen congelado al cierre.
    const resumen = caja.estado === EstadoCaja.CERRADA && caja.resumenCierre ? (caja.resumenCierre as object) : await this.resumen(id);
    return { ...caja, resumen };
  }

  /**
   * Cierra la caja si cuadra: el conteo de billetes debe igualar el efectivo en caja y
   * cada medio digital con movimiento debe igualar lo que dice su app o voucher.
   * Con `forzar` (casilla "cerrar aunque no cuadre") se cierra igual: se guardan las
   * diferencias, se marca la caja como sin cuadrar y se exige una observación.
   */
  async cerrar(
    usuarioId: number,
    conteo: Record<string, number>,
    digital: Record<string, number> = {},
    observacion?: string,
    forzar = false,
  ) {
    observacion = observacion?.trim() || undefined;
    return this.prisma.$transaction(async (tx) => {
      const c = await this.exigirAbierta(tx);
      const resumen = await this.resumen(c.id, tx);
      const detalle = DENOMINACIONES.map((d) => ({ denominacion: d, cantidad: Math.max(0, Math.floor(Number(conteo[String(d)] ?? 0))) }));
      const contado = r2(detalle.reduce((s, x) => s + x.denominacion * x.cantidad, 0));
      const diferencia = r2(contado - resumen.efectivoEsperado);
      const confirmado = MEDIOS_DIGITALES.map((m) => ({
        medio: m,
        sistema: resumen.totalPorMedio[m],
        confirmado: digital[m] == null ? (resumen.totalPorMedio[m] ? null : 0) : r2(Number(digital[m])),
      }));

      const errores: string[] = [];
      if (Math.abs(diferencia) >= 0.005) {
        errores.push(`el efectivo no cuadra (${diferencia < 0 ? 'falta' : 'sobra'} S/ ${Math.abs(diferencia).toFixed(2)})`);
      }
      for (const d of confirmado) {
        if (d.confirmado == null) errores.push(`falta confirmar ${d.medio.toLowerCase()}`);
        else if (Math.abs(d.confirmado - d.sistema) >= 0.005) errores.push(`${d.medio.toLowerCase()} no cuadra`);
      }
      const sinCuadrar = errores.length > 0;
      if (sinCuadrar && !forzar) throw new BadRequestException(`La caja no está cuadrada: ${errores.join(', ')}`);
      if (sinCuadrar && !observacion) {
        throw new BadRequestException('Para cerrar sin cuadrar escribe en la observación el motivo de la diferencia');
      }
      const digitalCierre = confirmado.map((d) => ({
        ...d,
        diferencia: d.confirmado == null ? null : r2(d.confirmado - d.sistema),
      }));
      // Pasa al acumulado todo menos el fondo para el día siguiente; lo digital, completo
      // (lo que confirmó la app o el voucher, o lo del sistema si no se confirmó).
      const cfg = await this.config.obtener();
      const quedaEnCaja = r2(Math.min(contado, Number(cfg.montoInicialCaja)));
      const alAcumulado = {
        efectivo: r2(contado - quedaEnCaja),
        yape: r2(confirmado.reduce((s, d) => s + (d.confirmado ?? d.sistema), 0)),
        quedaEnCaja,
      };

      await tx.caja.update({
        where: { id: c.id },
        data: {
          estado: EstadoCaja.CERRADA,
          usuarioCierreId: usuarioId,
          fechaCierre: new Date(),
          efectivoEsperado: resumen.efectivoEsperado,
          efectivoContado: contado,
          diferencia,
          sinCuadrar,
          observacion,
          resumenCierre: {
            ...resumen,
            conteo: detalle,
            digital: digitalCierre,
            efectivoContado: contado,
            diferencia,
            sinCuadrar,
            pendientes: errores,
            alAcumulado,
          } as Prisma.InputJsonValue,
        },
      });
      await this.fondo.desdeCierre(tx, c.id, usuarioId, alAcumulado.efectivo, alAcumulado.yape);
      return c.id;
    }).then((id) => {
      // Backup al cerrar caja, sin hacer esperar al cajero.
      void this.backup.hacer('cierre de caja');
      return this.detalle(id);
    });
  }

  historial() {
    return this.prisma.caja.findMany({
      include: { usuarioApertura: { select: { nombre: true } }, usuarioCierre: { select: { nombre: true } } },
      orderBy: { id: 'desc' },
      take: 60,
    });
  }
}
