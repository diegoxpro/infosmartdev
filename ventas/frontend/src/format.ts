const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });
const numero = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 });

export const n = (v: unknown) => Number(v ?? 0);
export const money = (v: unknown) => soles.format(n(v));
export const qty = (v: unknown) => numero.format(n(v));

/** Fechas de columnas DATE llegan como medianoche UTC: se muestran sin desfase. */
/** Stock en unidades expresado con la presentación más grande: "67 = 3 x20 + 7". */
export function equivalencia(stock: unknown, presentaciones?: { nombre: string; factor: unknown }[]) {
  const mayor = presentaciones?.reduce<{ nombre: string; factor: unknown } | null>((m, p) => (!m || n(p.factor) > n(m.factor) ? p : m), null);
  const f = n(mayor?.factor);
  const s = n(stock);
  if (!mayor || f <= 1 || s < f) return null;
  const enteras = Math.floor(s / f);
  const resto = Math.round((s - enteras * f) * 1000) / 1000;
  return `${enteras} ${mayor.nombre.toLowerCase()}${resto ? ` + ${qty(resto)}` : ''}`;
}

export function fecha(v?: string | null) {
  if (!v) return '';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fechaHora(v?: string | null) {
  if (!v) return '';
  return new Date(v).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

export function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function diasHasta(v: string) {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  const hoy = new Date();
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

/** Misma fórmula que el backend: costo * (1 + margen%), redondeado hacia arriba. */
export function precioSugerido(costo: number, margen: number, redondeo = 0.1) {
  const base = costo * (1 + margen / 100);
  if (!redondeo) return Math.round(base * 100) / 100;
  return Math.round(Math.ceil(base / redondeo - 1e-9) * redondeo * 100) / 100;
}

export function margenReal(costo: number, precio: number) {
  if (costo <= 0) return null;
  return Math.round(((precio - costo) / costo) * 1000) / 10;
}

const importe = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Monto sin "S/": para columnas cuya cabecera ya dice la moneda. */
export const monto = (v: unknown) => importe.format(n(v));

/** "hoy hasta las 11:59 p. m." / "hasta el 08/11/2026 10:00 a. m." */
export function venceTexto(v: string) {
  const d = new Date(v);
  const hora = d.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' });
  const hoy = new Date();
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  if (d.toDateString() === hoy.toDateString()) return `hoy hasta las ${hora}`;
  if (d.toDateString() === manana.toDateString()) return `mañana hasta las ${hora}`;
  return `hasta el ${d.toLocaleDateString('es-PE')} ${hora}`;
}
