/** Cálculo de cuándo toca pagar un gasto fijo. Sin base de datos, para poder probarlo. */

export type EstadoGastoFijo = 'PAGADO' | 'VENCIDO' | 'HOY' | 'PROXIMO' | 'PENDIENTE';

/** Días antes del día de pago en que empieza el aviso. */
export const DIAS_AVISO_GASTO_FIJO = 3;

export const periodoDe = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}`;

/** Fecha de pago en un mes; si el mes no tiene ese día (31 en noviembre), el último día. */
export function fechaPago(anio: number, mes: number, dia: number) {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes - 1, Math.min(dia, ultimo)));
}

/**
 * Estado del mes de `hoy` y del anterior (si quedó sin pagar). `hoy` se toma como
 * fecha de calendario en UTC (año, mes, día) ya pasada a hora de Lima.
 */
export function pendientesGastoFijo(
  dia: number,
  hoy: { anio: number; mes: number; dia: number },
  pagados: Set<string>,
  creado: { anio: number; mes: number; dia: number },
) {
  const res: { periodo: string; fecha: Date; estado: EstadoGastoFijo; dias: number }[] = [];
  const hoyF = Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia);
  const creadoF = Date.UTC(creado.anio, creado.mes - 1, creado.dia);
  const anterior = hoy.mes === 1 ? { anio: hoy.anio - 1, mes: 12 } : { anio: hoy.anio, mes: hoy.mes - 1 };
  for (const p of [anterior, { anio: hoy.anio, mes: hoy.mes }]) {
    const periodo = periodoDe(p.anio, p.mes);
    const f = fechaPago(p.anio, p.mes, dia);
    const esActual = p.anio === hoy.anio && p.mes === hoy.mes;
    // Un mes solo cuenta si el gasto fijo ya existía cuando tocaba pagarlo
    // (si se crea el 8 con día de pago 5, el primer aviso es del mes siguiente).
    if (f.getTime() < creadoF) continue;
    if (!esActual && pagados.has(periodo)) continue;
    const dias = Math.round((f.getTime() - hoyF) / 86_400_000);
    const estado: EstadoGastoFijo = pagados.has(periodo)
      ? 'PAGADO'
      : dias < 0
        ? 'VENCIDO'
        : dias === 0
          ? 'HOY'
          : dias <= DIAS_AVISO_GASTO_FIJO
            ? 'PROXIMO'
            : 'PENDIENTE';
    res.push({ periodo, fecha: f, estado, dias });
  }
  return res;
}
