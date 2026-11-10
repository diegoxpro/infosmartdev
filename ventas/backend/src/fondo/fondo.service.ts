import { BadRequestException, Injectable } from '@nestjs/common';
import { CuentaFondo, MedioPago, Prisma, TipoMovimientoFondo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Billetes y monedas en soles (los mismos del cierre de caja). */
export const DENOMINACIONES_FONDO = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const cuadra = (n: number) => Math.abs(n) < 0.005;

export const CUENTA_LABEL: Record<CuentaFondo, string> = { EFECTIVO: 'Efectivo', YAPE: 'Yape' };

/** Efectivo sale del efectivo del acumulado; Yape, Plin, tarjeta y transferencia, del saldo Yape. */
export const cuentaDe = (medio: MedioPago) => (medio === MedioPago.EFECTIVO ? CuentaFondo.EFECTIVO : CuentaFondo.YAPE);

export interface NuevoMovimiento {
  usuarioId: number;
  tipo: TipoMovimientoFondo;
  cuenta: CuentaFondo;
  /** Positivo entra al acumulado, negativo sale. */
  monto: number;
  concepto: string;
  cajaId?: number;
  gastoId?: number;
  pagoProveedorId?: number;
  conteoId?: number;
}

/**
 * Acumulado de las cajas anteriores: lo que deja cada cierre de caja y de donde
 * se pagan gastos, proveedores y sueldos. El saldo de cada cuenta es la suma de
 * sus movimientos; el conteo semanal registra la diferencia como ajuste.
 */
@Injectable()
export class FondoService {
  constructor(private readonly prisma: PrismaService) {}

  async saldos(tx: Prisma.TransactionClient = this.prisma) {
    const filas = await tx.movimientoFondo.groupBy({ by: ['cuenta'], _sum: { monto: true } });
    const de = (c: CuentaFondo) => r2(filas.find((f) => f.cuenta === c)?._sum.monto);
    const efectivo = de(CuentaFondo.EFECTIVO);
    const yape = de(CuentaFondo.YAPE);
    return { EFECTIVO: efectivo, YAPE: yape, total: r2(efectivo + yape) };
  }

  /**
   * Registra un movimiento dentro de una transacción. Una salida no puede dejar
   * la cuenta en negativo: si falta, el gasto o pago se hace desde la caja del día.
   */
  async registrar(tx: Prisma.TransactionClient, m: NuevoMovimiento, { permitirNegativo = false } = {}) {
    // Un movimiento a la vez, para que dos salidas simultáneas no pasen el saldo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
    const monto = r2(m.monto);
    if (monto < 0 && !permitirNegativo) {
      const saldo = (await this.saldos(tx))[m.cuenta];
      if (-monto > saldo + 0.005) {
        throw new BadRequestException(
          `No alcanza el ${CUENTA_LABEL[m.cuenta].toLowerCase()} del acumulado (hay S/ ${saldo.toFixed(2)}). Págalo desde la caja del día.`,
        );
      }
    }
    return tx.movimientoFondo.create({ data: { ...m, monto } });
  }

  /** Al cerrar la caja: pasa el efectivo menos el fondo del día siguiente, y todo lo digital. */
  async desdeCierre(tx: Prisma.TransactionClient, cajaId: number, usuarioId: number, efectivo: number, digital: number) {
    const ref = `Cierre de caja #${cajaId}`;
    if (!cuadra(efectivo)) {
      await this.registrar(tx, { usuarioId, tipo: TipoMovimientoFondo.CIERRE_CAJA, cuenta: CuentaFondo.EFECTIVO, monto: efectivo, concepto: ref, cajaId }, { permitirNegativo: true });
    }
    if (!cuadra(digital)) {
      await this.registrar(tx, { usuarioId, tipo: TipoMovimientoFondo.CIERRE_CAJA, cuenta: CuentaFondo.YAPE, monto: digital, concepto: ref, cajaId }, { permitirNegativo: true });
    }
  }

  async resumen() {
    const [saldos, ultimoConteo, movimientos] = await Promise.all([
      this.saldos(),
      this.prisma.conteoFondo.findFirst({ orderBy: { id: 'desc' }, include: { usuario: { select: { nombre: true } } } }),
      this.movimientos({ limite: 100 }),
    ]);
    return { saldos, ultimoConteo, movimientos };
  }

  movimientos({ desde, hasta, limite }: { desde?: Date; hasta?: Date; limite?: number } = {}) {
    return this.prisma.movimientoFondo.findMany({
      where: { fecha: { gte: desde, lt: hasta } },
      include: { usuario: { select: { nombre: true } }, gasto: { select: { id: true, categoria: { select: { nombre: true } } } } },
      orderBy: { id: 'desc' },
      take: limite,
    });
  }

  /** Retiro del dueño o depósito al banco. */
  async retiro(usuarioId: number, cuenta: CuentaFondo, monto: number, concepto: string) {
    concepto = concepto.trim();
    if (concepto.length < 3) throw new BadRequestException('Escribe el motivo (mínimo 3 letras)');
    await this.prisma.$transaction((tx) => this.registrar(tx, { usuarioId, tipo: TipoMovimientoFondo.RETIRO, cuenta, monto: -monto, concepto }));
    return this.resumen();
  }

  /** Pase de una cuenta a la otra (por ejemplo, retirar Yape en efectivo). */
  async traspaso(usuarioId: number, desde: CuentaFondo, monto: number, concepto?: string) {
    const hacia = desde === CuentaFondo.EFECTIVO ? CuentaFondo.YAPE : CuentaFondo.EFECTIVO;
    const texto = concepto?.trim() || `De ${CUENTA_LABEL[desde].toLowerCase()} a ${CUENTA_LABEL[hacia].toLowerCase()}`;
    await this.prisma.$transaction(async (tx) => {
      await this.registrar(tx, { usuarioId, tipo: TipoMovimientoFondo.TRASPASO, cuenta: desde, monto: -monto, concepto: texto });
      await this.registrar(tx, { usuarioId, tipo: TipoMovimientoFondo.TRASPASO, cuenta: hacia, monto, concepto: texto });
    });
    return this.resumen();
  }

  /**
   * Conteo semanal, como un cierre de caja: billetes y monedas para el efectivo y
   * el saldo de la app para Yape. Si no cuadra se exige una observación y se cierra
   * igual: la diferencia queda como ajuste y el saldo pasa a ser lo contado.
   */
  async contar(usuarioId: number, conteo: Record<string, number>, yapeContado: number, observacion?: string) {
    observacion = observacion?.trim() || undefined;
    const detalle = DENOMINACIONES_FONDO.map((d) => ({ denominacion: d, cantidad: Math.max(0, Math.floor(Number(conteo[String(d)] ?? 0))) }));
    const efectivoContado = r2(detalle.reduce((s, x) => s + x.denominacion * x.cantidad, 0));
    yapeContado = r2(yapeContado);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
      const s = await this.saldos(tx);
      const difE = r2(efectivoContado - s.EFECTIVO);
      const difY = r2(yapeContado - s.YAPE);
      if ((!cuadra(difE) || !cuadra(difY)) && !observacion) {
        throw new BadRequestException('El conteo no cuadra: escribe en la observación el motivo de la diferencia');
      }
      const c = await tx.conteoFondo.create({
        data: {
          usuarioId,
          efectivoEsperado: s.EFECTIVO,
          efectivoContado,
          yapeEsperado: s.YAPE,
          yapeContado,
          diferenciaEfectivo: difE,
          diferenciaYape: difY,
          detalle: detalle as Prisma.InputJsonValue,
          observacion,
        },
      });
      const concepto = `Conteo #${c.id}${observacion ? `: ${observacion}` : ''}`;
      for (const [cuenta, dif] of [[CuentaFondo.EFECTIVO, difE], [CuentaFondo.YAPE, difY]] as const) {
        if (!cuadra(dif)) {
          await tx.movimientoFondo.create({ data: { usuarioId, tipo: TipoMovimientoFondo.AJUSTE_CONTEO, cuenta, monto: dif, concepto, conteoId: c.id } });
        }
      }
      return c.id;
    });
    return this.prisma.conteoFondo.findUniqueOrThrow({ where: { id }, include: { usuario: { select: { nombre: true } } } });
  }

  conteos() {
    return this.prisma.conteoFondo.findMany({ include: { usuario: { select: { nombre: true } } }, orderBy: { id: 'desc' }, take: 60 });
  }
}
