/**
 * Importa el "Reporte de stock de producto" exportado de SysVent en CSV.
 *
 *   npm run importar:sysvent -- ruta/stock_produto.csv
 *
 * Cada fila de ese CSV repite la cabecera del reporte; los datos del
 * producto empiezan en la columna "Id Producto". SysVent repite el Id en las
 * presentaciones de un producto (unidad y bolsa), así que cada fila se
 * identifica por Id + código de barras y queda como producto propio.
 * Se puede volver a correr: solo se actualizan nombre, código, marca, unidad
 * y precios (el stock solo se carga la primera vez).
 */
import { PrismaClient, TipoMovimiento } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const CAMPOS = ['Id Producto', 'Cod. Barra', 'Producto', 'Marca', 'Familia', 'Grupo', 'Precio1', 'Precio2', 'Precio3', 'U.Med', 'Stock'];

async function main() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error('Indica la ruta del CSV: npm run importar:sysvent -- archivo.csv');
  const filas: string[][] = parse(readFileSync(ruta, 'utf-8'), { relax_column_count: true });

  const marcas = new Map<string, number>();
  const categorias = new Map<string, number>();
  const idMarca = (nombre: string) => idCatalogo(nombre, 'SIN MARCA', marcas, (n) => prisma.marca.upsert({ where: { nombre: n }, create: { nombre: n }, update: {} }));
  const idCategoria = (nombre: string) => idCatalogo(nombre, 'SIN FAMILIA', categorias, (n) => prisma.categoria.upsert({ where: { nombre: n }, create: { nombre: n }, update: {} }));

  let creados = 0;
  let actualizados = 0;
  const avisos: string[] = [];

  for (const fila of filas) {
    const inicio = fila.indexOf('Id Producto');
    if (inicio < 0) continue;
    const v = fila.slice(inicio + CAMPOS.length, inicio + 2 * CAMPOS.length).map((x) => x.trim());
    const [idAnterior, codigo, nombre, marca, familia, , p1, p2, p3, unidad, stockTxt] = v;
    if (!idAnterior || !nombre) continue;

    const revisar: string[] = [];
    let stock = Number(stockTxt) || 0;
    if (stock < 0) {
      revisar.push(`Stock negativo en SysVent (${stock}); se cargó en 0`);
      stock = 0;
    }
    if (nombre === codigo) revisar.push('El nombre es solo el código de barras');

    const data = {
      codigoBarra: codigo || null,
      nombre,
      unidad: unidad || 'UND',
      precio1: Number(p1) || 0,
      precio2: Number(p2) || Number(p1) || 0,
      precio3: Number(p3) || Number(p1) || 0,
      marcaId: await idMarca(marca),
      categoriaId: await idCategoria(familia),
    };

    const codigoAnterior = codigo ? `${idAnterior}:${codigo}` : idAnterior;
    const existente = await prisma.producto.findUnique({ where: { codigoAnterior } });
    if (existente) {
      await prisma.producto.update({ where: { id: existente.id }, data });
      actualizados++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const p = await tx.producto.create({
        data: { ...data, codigoAnterior, stock, revisar: revisar.length ? revisar.join('. ') : null },
      });
      if (stock > 0) {
        await tx.movimientoStock.create({
          data: {
            productoId: p.id,
            tipo: TipoMovimiento.IMPORTACION,
            cantidad: stock,
            stockResultante: stock,
            referencia: 'Importación SysVent',
          },
        });
      }
    });
    creados++;
    if (revisar.length) avisos.push(`${nombre}: ${revisar.join('. ')}`);
  }

  console.log(`Productos creados: ${creados}, actualizados: ${actualizados}`);
  if (avisos.length) {
    console.log(`\nPara revisar (${avisos.length}), filtro "Por revisar" en Productos:`);
    avisos.forEach((a) => console.log(`  - ${a}`));
  }
}

async function idCatalogo(
  nombre: string,
  vacio: string,
  cache: Map<string, number>,
  crear: (n: string) => Promise<{ id: number }>,
): Promise<number | null> {
  const n = nombre?.trim().toUpperCase();
  if (!n || n === vacio) return null;
  if (!cache.has(n)) cache.set(n, (await crear(n)).id);
  return cache.get(n)!;
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
