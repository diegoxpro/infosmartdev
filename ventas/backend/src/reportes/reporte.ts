import ExcelJS from 'exceljs';

export type TipoColumna = 'texto' | 'moneda' | 'numero' | 'porcentaje' | 'fecha' | 'fechaHora';

export interface Columna {
  clave: string;
  titulo: string;
  tipo?: TipoColumna;
}

/** Forma común de todos los reportes: la pantalla y el Excel se arman con esto. */
export interface Reporte {
  titulo: string;
  subtitulo?: string;
  columnas: Columna[];
  filas: Record<string, unknown>[];
  /** Fila de totales (solo las claves que se suman). */
  totales?: Record<string, number>;
  /** Si se indica, las filas se muestran en grupos con subtotal. */
  agruparPor?: string;
}

const FORMATO: Partial<Record<TipoColumna, string>> = {
  moneda: '"S/ "#,##0.00',
  numero: '#,##0.###',
  porcentaje: '0.0"%"',
  fecha: 'dd/mm/yyyy',
  fechaHora: 'dd/mm/yyyy hh:mm',
};

export async function reporteAExcel(r: Reporte, empresa: string): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  // Excel no acepta * ? : \ / [ ] en el nombre de la hoja (p. ej. "COCA COLA 2,25 LITROS**").
  const hoja = libro.addWorksheet(r.titulo.replace(/[*?:\\/[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Reporte');
  hoja.addRow([empresa]).font = { bold: true, size: 13 };
  hoja.addRow([r.titulo]).font = { bold: true };
  if (r.subtitulo) hoja.addRow([r.subtitulo]);
  hoja.addRow([]);
  const cab = hoja.addRow(r.columnas.map((c) => c.titulo));
  cab.font = { bold: true };
  cab.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDEA' } }));

  const valor = (c: Columna, v: unknown) => {
    if (v == null) return null;
    // Excel no maneja zonas horarias: la hora se escribe ya en hora de Lima (UTC-5, sin horario de verano).
    if (c.tipo === 'fechaHora') return new Date(new Date(String(v)).getTime() - 5 * 3_600_000);
    if (c.tipo === 'fecha') return new Date(String(v));
    if (c.tipo && c.tipo !== 'texto') return Number(v);
    return String(v);
  };
  for (const f of r.filas) hoja.addRow(r.columnas.map((c) => valor(c, f[c.clave])));
  if (r.totales) {
    const t = hoja.addRow(r.columnas.map((c, i) => (i === 0 ? 'TOTAL' : (r.totales![c.clave] ?? null))));
    t.font = { bold: true };
  }

  r.columnas.forEach((c, i) => {
    const col = hoja.getColumn(i + 1);
    if (c.tipo && FORMATO[c.tipo]) col.numFmt = FORMATO[c.tipo]!;
    const largo = Math.max(c.titulo.length, ...r.filas.slice(0, 200).map((f) => String(f[c.clave] ?? '').length));
    col.width = Math.min(50, Math.max(10, largo + 2));
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}
