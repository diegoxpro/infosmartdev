import { Prisma } from '@prisma/client';

type Num = Prisma.Decimal | number | string;

/** Precio sugerido = costo * (1 + margen%), redondeado hacia arriba al múltiplo indicado. */
export function precioSugerido(costo: Num, margen: Num, redondeo: Num = 0.1): number {
  const base = Number(costo) * (1 + Number(margen) / 100);
  const paso = Number(redondeo);
  if (!paso || paso <= 0) return Math.round(base * 100) / 100;
  // El epsilon evita que 2.5000000001 suba a 2.60 por errores de coma flotante.
  return Math.round(Math.ceil(base / paso - 1e-9) * paso * 100) / 100;
}

/** Margen real (%) que deja un precio sobre el costo. */
export function margenReal(costo: Num, precio: Num): number | null {
  const c = Number(costo);
  if (c <= 0) return null;
  return Math.round(((Number(precio) - c) / c) * 10000) / 100;
}
