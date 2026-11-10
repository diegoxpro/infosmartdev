import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Cantidad contada de una fecha de vencimiento. Se guarda como JSON en el conteo. */
export interface LoteContado {
  fecha: string; // AAAA-MM-DD
  cantidad: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Junta las fechas repetidas, quita las que quedan en cero y ordena por fecha. */
export function normalizarLotes(lotes: LoteContado[] | undefined | null): LoteContado[] {
  const mapa = new Map<string, number>();
  for (const l of lotes ?? []) {
    const fecha = String(l.fecha).slice(0, 10);
    mapa.set(fecha, (mapa.get(fecha) ?? 0) + Number(l.cantidad));
  }
  return [...mapa]
    .map(([fecha, cantidad]) => ({ fecha, cantidad: r3(cantidad) }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function leerLotes(json: Prisma.JsonValue | null | undefined): LoteContado[] {
  return Array.isArray(json) ? normalizarLotes(json as unknown as LoteContado[]) : [];
}

export const juntarLotes = (a: LoteContado[], b: LoteContado[]) => normalizarLotes([...a, ...b]);

export const sumaLotes = (lotes: LoteContado[]) => r3(lotes.reduce((s, l) => s + l.cantidad, 0));

export const lotesJson = (lotes: LoteContado[]) => lotes as unknown as Prisma.InputJsonValue;

/**
 * Si se detallan fechas, el total es su suma. En un producto que controla
 * vencimiento ninguna unidad puede quedar sin fecha.
 */
export function exigirLotes(cantidad: number, lotes: LoteContado[], controlaVencimiento: boolean) {
  if (controlaVencimiento && cantidad > 0 && !lotes.length) {
    throw new BadRequestException('Este producto controla vencimiento: indica la fecha de cada cantidad');
  }
  if (lotes.length && Math.abs(sumaLotes(lotes) - cantidad) >= 0.0005) {
    throw new BadRequestException(`La suma por fechas (${sumaLotes(lotes)}) no coincide con el total (${cantidad})`);
  }
}
