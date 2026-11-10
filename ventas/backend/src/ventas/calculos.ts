import { AfectacionIgv } from '@prisma/client';

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const TASA_IGV = 0.18;

export interface LineaCalculo {
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  afectacionIgv: AfectacionIgv;
}

/**
 * Totales de una venta. Los precios incluyen IGV. El descuento global se
 * reparte entre los tipos de operación en proporción a su importe.
 */
export function calcularTotales(lineas: LineaCalculo[], descuentoGlobal = 0) {
  const subtotales = lineas.map((l) => r2(l.cantidad * l.precioUnitario - l.descuento));
  if (subtotales.some((s) => s < 0)) throw new Error('El descuento de un producto supera su importe');
  const subtotal = r2(subtotales.reduce((s, x) => s + x, 0));
  if (descuentoGlobal > subtotal) throw new Error('El descuento supera el total');
  const total = r2(subtotal - descuentoGlobal);

  const por: Record<AfectacionIgv, number> = { EXONERADO: 0, GRAVADO: 0, INAFECTO: 0 };
  lineas.forEach((l, i) => (por[l.afectacionIgv] += subtotales[i]));
  const factor = subtotal > 0 ? total / subtotal : 0;
  const gravadoConIgv = r2(por.GRAVADO * factor);
  const opGravada = r2(gravadoConIgv / (1 + TASA_IGV));
  const igv = r2(gravadoConIgv - opGravada);
  const opInafecta = r2(por.INAFECTO * factor);
  // El exonerado absorbe el redondeo para que todo sume el total.
  const opExonerada = r2(total - gravadoConIgv - opInafecta);
  return { subtotales, subtotal, total, opGravada, opExonerada, opInafecta, igv };
}

export interface PagoCalculo {
  medioPago: string;
  monto: number;
}

/** Valida pagos mixtos y calcula el vuelto (solo del efectivo). */
export function calcularPagos(total: number, pagos: PagoCalculo[]) {
  const efectivo = r2(pagos.filter((p) => p.medioPago === 'EFECTIVO').reduce((s, p) => s + p.monto, 0));
  const otros = r2(pagos.filter((p) => p.medioPago !== 'EFECTIVO').reduce((s, p) => s + p.monto, 0));
  if (otros > total) throw new Error('Los pagos con tarjeta o billetera superan el total');
  const pagado = r2(efectivo + otros);
  if (pagado < total) throw new Error(`Falta cobrar S/ ${(total - pagado).toFixed(2)}`);
  const vuelto = r2(pagado - total);
  return { efectivoRecibido: efectivo, vuelto, efectivoAplicado: r2(efectivo - vuelto) };
}
