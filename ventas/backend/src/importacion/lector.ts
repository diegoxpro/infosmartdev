/**
 * Lee el Excel (o CSV) de productos y lo convierte en filas con nombres de
 * campo fijos. No toca la base de datos: así se puede probar sola.
 *
 * Las columnas se reconocen por su título, sin importar mayúsculas, tildes,
 * espacios ni el orden ("Cod. Barra", "Código de barras" y "EAN" son lo
 * mismo). La fila de títulos puede estar en cualquiera de las primeras 15.
 */
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';

export type Valor = string | number | boolean | Date | null;

export interface FilaLeida {
  /** Número de fila en la hoja, tal como lo ve el usuario en Excel. */
  fila: number;
  datos: Record<string, Valor>;
}

export interface ArchivoLeido {
  productos: FilaLeida[];
  presentaciones: FilaLeida[];
  /** Columnas que no se reconocieron (se ignoran). */
  ignoradas: string[];
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Títulos aceptados para cada campo (ya normalizados).
const PRODUCTO: Record<string, string[]> = {
  id: ['idsistema', 'idcandys'],
  codigo: ['codigodebarras', 'codigodebarra', 'codigobarras', 'codigobarra', 'codbarra', 'codbarras', 'codigo', 'cod', 'ean', 'barcode'],
  nombre: ['nombre', 'producto', 'nombreproducto', 'nombredelproducto', 'descripcion', 'articulo'],
  categoria: ['categoria', 'familia', 'rubro', 'linea'],
  marca: ['marca'],
  unidad: ['unidad', 'umed', 'um', 'unidadmedida', 'unidaddemedida', 'medida'],
  costo: ['costo', 'costounitario', 'costoxunidad', 'costoporunidad', 'preciocompra', 'preciodecompra'],
  precio1: ['precio1', 'precio', 'precioventa', 'preciodeventa', 'pventa', 'pv'],
  precio2: ['precio2'],
  precio3: ['precio3'],
  stock: ['stock', 'stockactual', 'existencia', 'existencias', 'cantidad'],
  stockMinimo: ['stockminimo', 'stockmin', 'minimo'],
  controlaVencimiento: ['controlavencimiento', 'controlvencimiento', 'vence', 'tienevencimiento'],
  fechaVencimiento: ['fechadevencimiento', 'fechavencimiento', 'vencimiento', 'fvencimiento', 'fvenc'],
  lote: ['lote', 'codigolote', 'codigodelote', 'nlote', 'nrolote'],
  activo: ['activo', 'estado'],
};

const PRESENTACION: Record<string, string[]> = {
  productoId: ['idproducto', 'idsistema', 'idsistemaproducto'],
  productoCodigo: ['codigodelproducto', 'codigoproducto', 'codproducto', 'codigobarraproducto'],
  productoNombre: ['producto', 'nombreproducto', 'nombredelproducto'],
  nombre: ['presentacion', 'nombrepresentacion', 'nombredelapresentacion'],
  factor: ['unidadesquetrae', 'unidades', 'factor', 'contiene', 'unidadesporpresentacion', 'cantidadunidades'],
  codigo: ['codigodebarras', 'codigodebarra', 'codigobarras', 'codigobarra', 'codbarra', 'ean', 'codigo'],
  precio1: ['precio1', 'precio', 'precioventa'],
  precio2: ['precio2'],
  precio3: ['precio3'],
};

/** Ubica la fila de títulos y qué campo es cada columna. */
function columnas(filas: Valor[][], mapa: Record<string, string[]>, obligatorio: string) {
  const sinonimos = new Map<string, string>();
  for (const [campo, nombres] of Object.entries(mapa)) for (const n of nombres) if (!sinonimos.has(n)) sinonimos.set(n, campo);

  for (let i = 0; i < Math.min(15, filas.length); i++) {
    const porColumna = new Map<number, string>();
    const ignoradas: string[] = [];
    filas[i].forEach((v, col) => {
      const titulo = texto(v);
      if (!titulo) return;
      const campo = sinonimos.get(normalizar(titulo));
      if (campo && ![...porColumna.values()].includes(campo)) porColumna.set(col, campo);
      else ignoradas.push(titulo);
    });
    if ([...porColumna.values()].includes(obligatorio) && porColumna.size >= 2) return { fila: i, porColumna, ignoradas };
  }
  return null;
}

function aFilas(filas: Valor[][], encabezado: NonNullable<ReturnType<typeof columnas>>, numeros: number[]): FilaLeida[] {
  const out: FilaLeida[] = [];
  for (let i = encabezado.fila + 1; i < filas.length; i++) {
    const datos: Record<string, Valor> = {};
    let vacia = true;
    for (const [col, campo] of encabezado.porColumna) {
      let v = filas[i][col] ?? null;
      if (typeof v === 'string') v = v.trim() || null;
      if (v !== null) vacia = false;
      datos[campo] = v;
    }
    if (!vacia) out.push({ fila: numeros[i], datos });
  }
  return out;
}

/** Valor simple de una celda de exceljs (fórmulas, texto enriquecido, hipervínculos…). */
function celda(v: ExcelJS.CellValue): Valor {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return celda(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v);
}

function hojaAMatriz(hoja: ExcelJS.Worksheet) {
  const filas: Valor[][] = [];
  const numeros: number[] = [];
  hoja.eachRow({ includeEmpty: false }, (row, n) => {
    const valores: Valor[] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => (valores[col - 1] = celda(c.value)));
    filas.push(valores);
    numeros.push(n);
  });
  return { filas, numeros };
}

export async function leerArchivo(contenido: Buffer, nombreArchivo: string): Promise<ArchivoLeido> {
  const hojas: { nombre: string; filas: Valor[][]; numeros: number[] }[] = [];
  if (/\.csv$/i.test(nombreArchivo) || /\.txt$/i.test(nombreArchivo)) {
    const txt = contenido.toString('utf-8').replace(/^﻿/, '');
    const primera = txt.split(/\r?\n/, 1)[0];
    const delimiter = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : primera.includes('\t') ? '\t' : ',';
    const filas: Valor[][] = parse(txt, { delimiter, relax_column_count: true, skip_empty_lines: true });
    hojas.push({ nombre: 'Productos', filas, numeros: filas.map((_, i) => i + 1) });
  } else {
    const libro = new ExcelJS.Workbook();
    try {
      await libro.xlsx.load(contenido as unknown as ArrayBuffer);
    } catch {
      throw new Error('No se pudo abrir el archivo. Guárdalo como "Libro de Excel (.xlsx)" e inténtalo de nuevo.');
    }
    libro.eachSheet((h) => hojas.push({ nombre: h.name, ...hojaAMatriz(h) }));
  }

  // Presentaciones: la hoja que se llama así o la que trae "Unidades que trae".
  let presentaciones: FilaLeida[] = [];
  let hojaPres = -1;
  hojas.forEach((h, i) => {
    if (hojaPres >= 0) return;
    const enc = columnas(h.filas, PRESENTACION, 'factor');
    if (enc && (normalizar(h.nombre).startsWith('presentacion') || [...enc.porColumna.values()].includes('nombre'))) {
      presentaciones = aFilas(h.filas, enc, h.numeros);
      hojaPres = i;
    }
  });

  for (let i = 0; i < hojas.length; i++) {
    if (i === hojaPres) continue;
    const enc = columnas(hojas[i].filas, PRODUCTO, 'nombre') ?? columnas(hojas[i].filas, PRODUCTO, 'codigo');
    if (enc) return { productos: aFilas(hojas[i].filas, enc, hojas[i].numeros), presentaciones, ignoradas: enc.ignoradas };
  }
  if (presentaciones.length) return { productos: [], presentaciones, ignoradas: [] };
  throw new Error('No se encontró la fila de títulos. La hoja debe tener al menos las columnas "Nombre" y "Código de barras" (descarga la plantilla para ver el formato).');
}

// ------------------------------------------------------------ conversión de valores

export function texto(v: Valor): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Excel guarda los códigos de barras largos como número: 7751731002971.
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  const t = String(v).trim();
  return t || null;
}

/** Número de una celda: acepta "S/ 2.50", "1,234.50" y "2,50". undefined = no es número. */
export function numero(v: Valor): number | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean' || v instanceof Date) return undefined;
  let t = v.replace(/s\/\.?/i, '').replace(/\s/g, '');
  if (!t) return null;
  if (/^-?\d+,\d{1,3}$/.test(t) && !t.includes('.')) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** SI/NO, X, 1/0, verdadero/falso. undefined = no se entiende. */
export function siNo(v: Valor): boolean | null | undefined {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined;
  const t = normalizar(String(v));
  if (!t) return null;
  if (['si', 's', 'x', 'true', 'verdadero', 'activo', 'yes', 'y'].includes(t)) return true;
  if (['no', 'n', 'false', 'falso', 'inactivo'].includes(t)) return false;
  return undefined;
}

/** Fecha como Date UTC (para columnas @db.Date). Acepta celdas de fecha, dd/mm/aaaa y aaaa-mm-dd. */
export function fecha(v: Valor): Date | null | undefined {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === 'number') {
    // Número de serie de Excel (días desde 1899-12-30).
    if (v < 20000 || v > 80000) return undefined;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valida(anio, Number(m[2]), Number(m[1]));
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  return undefined;
}

function valida(anio: number, mes: number, dia: number) {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : undefined;
}
