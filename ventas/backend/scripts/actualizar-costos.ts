/**
 * Actualiza el costo de los productos con el "Reporte de stock valorizado"
 * exportado de SysVent en CSV.
 *
 *   npm run importar:costos -- ruta/stock_producto.csv            (solo costos)
 *   npm run importar:costos -- ruta/stock_producto.csv --stock    (costos y stock)
 *   npm run importar:costos -- ruta/stock_producto.csv --probar   (muestra sin guardar)
 *
 * Cada fila repite la cabecera del reporte; los datos empiezan en la columna
 * "Id Producto" (Id, Nombre, U. Medida, Stock, Costo, Total). El producto se
 * busca por el Id de SysVent que guardó la importación (codigoAnterior).
 * Con --stock, la diferencia de stock queda como un ajuste en el kardex.
 * Se puede volver a correr cuantas veces haga falta.
 */
import { PrismaClient, TipoMovimiento } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const CAMPOS = ['Id Producto', 'Nombre Producto', 'U. Medida', 'Stock', 'Costo', 'Total'];
const numero = (x: string) => (x.trim() === '' ? null : Number(x.replace(/,/g, '')));

async function main() {
  const [ruta, ...opciones] = process.argv.slice(2);
  if (!ruta) throw new Error('Indica la ruta del CSV: npm run importar:costos -- archivo.csv [--stock] [--probar]');
  const conStock = opciones.includes('--stock');
  const probar = opciones.includes('--probar');
  const filas: string[][] = parse(readFileSync(ruta, 'utf-8'), { relax_column_count: true });

  const productos = await prisma.producto.findMany({
    where: { codigoAnterior: { not: null } },
    select: { id: true, nombre: true, codigoAnterior: true, costo: true, stock: true },
  });
  // Las presentaciones comparten el Id de SysVent: "Id" o "Id:código de barras".
  const porId = new Map<string, typeof productos>();
  for (const p of productos) {
    const id = p.codigoAnterior!.split(':')[0];
    porId.set(id, [...(porId.get(id) ?? []), p]);
  }

  let costos = 0;
  let stocks = 0;
  let iguales = 0;
  const noEncontrados: string[] = [];
  const ambiguos: string[] = [];
  const sinCosto: string[] = [];

  for (const fila of filas) {
    const inicio = fila.indexOf('Id Producto');
    if (inicio < 0) continue;
    const [id, nombre, , stockTxt, costoTxt] = fila.slice(inicio + CAMPOS.length, inicio + 2 * CAMPOS.length).map((x) => x.trim());
    if (!id) continue;

    let candidatos = porId.get(id) ?? [];
    if (candidatos.length > 1) candidatos = candidatos.filter((p) => p.nombre === nombre);
    if (!candidatos.length) {
      noEncontrados.push(`${id} ${nombre}`);
      continue;
    }
    if (candidatos.length > 1) {
      ambiguos.push(`${id} ${nombre} (${candidatos.length} presentaciones con el mismo Id; revisa el costo a mano)`);
      continue;
    }
    const p = candidatos[0];
    const costo = numero(costoTxt);
    const stock = numero(stockTxt);
    const cambiaCosto = costo !== null && costo > 0 && costo !== Number(p.costo);
    const cambiaStock = conStock && stock !== null && stock >= 0 && stock !== Number(p.stock);
    if (costo === null || costo <= 0) sinCosto.push(`${id} ${nombre}`);
    if (!cambiaCosto && !cambiaStock) {
      iguales++;
      continue;
    }

    if (probar) {
      if (cambiaCosto) console.log(`${nombre}: costo ${Number(p.costo)} → ${costo}`);
      if (cambiaStock) console.log(`${nombre}: stock ${Number(p.stock)} → ${stock}`);
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.producto.update({
          where: { id: p.id },
          data: { ...(cambiaCosto && { costo: costo! }), ...(cambiaStock && { stock: stock! }) },
        });
        if (cambiaStock) {
          await tx.movimientoStock.create({
            data: {
              productoId: p.id,
              tipo: TipoMovimiento.AJUSTE,
              cantidad: stock! - Number(p.stock),
              stockResultante: stock!,
              costoUnitario: cambiaCosto ? costo! : p.costo,
              referencia: 'Stock valorizado SysVent',
              motivo: 'Actualización desde SysVent',
            },
          });
        }
      });
    }
    if (cambiaCosto) costos++;
    if (cambiaStock) stocks++;
  }

  console.log(`\n${probar ? 'PRUEBA (no se guardó nada). ' : ''}Costos actualizados: ${costos}${conStock ? `, stock ajustado: ${stocks}` : ''}, sin cambios: ${iguales}`);
  const lista = (titulo: string, items: string[]) => items.length && console.log(`\n${titulo} (${items.length}):\n${items.map((x) => `  - ${x}`).join('\n')}`);
  lista('No están en el sistema', noEncontrados);
  lista('Varias presentaciones, no se tocaron', ambiguos);
  lista('Sin costo en el reporte, se dejó el actual', sinCosto);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
