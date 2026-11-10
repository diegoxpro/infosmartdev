import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TipoMovimiento } from '@prisma/client';
import ExcelJS from 'exceljs';
import { StockService } from '../inventario/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { fecha, FilaLeida, leerArchivo, numero, siNo, texto, Valor } from './lector';

/** reemplazar: la columna Stock es el conteo real. sumar: es lo que ingresa. */
export type ModoStock = 'reemplazar' | 'sumar';

export interface FilaRevisada {
  hoja: 'Productos' | 'Presentaciones';
  fila: number;
  estado: 'nuevo' | 'actualiza' | 'igual' | 'error';
  nombre: string;
  codigo: string | null;
  cambios: string[];
  errores: string[];
  avisos: string[];
}

export interface Revision {
  archivo: string;
  modoStock: ModoStock;
  resumen: {
    productosNuevos: number;
    productosActualizados: number;
    presentacionesNuevas: number;
    presentacionesActualizadas: number;
    sinCambios: number;
    conError: number;
    unidadesEntran: number;
    unidadesSalen: number;
    categoriasNuevas: string[];
    marcasNuevas: string[];
  };
  columnasIgnoradas: string[];
  /** Solo las filas con cambios, avisos o errores (las iguales se cuentan en el resumen). */
  filas: FilaRevisada[];
}

type ProductoBd = Prisma.ProductoGetPayload<{ include: { categoria: true; marca: true } }>;
type PresentacionBd = Prisma.PresentacionGetPayload<object>;

/** Lo que se hará con una fila de productos (solo los campos que cambian). */
interface PlanProducto {
  revisada: FilaRevisada;
  existente?: ProductoBd;
  data: Record<string, unknown>;
  categoria?: string | null;
  marca?: string | null;
  /** Unidades que entran (+) o salen (-) del stock. */
  movimiento: number;
  costoMovimiento: number;
  lote?: { codigo: string | null; fechaVencimiento: Date };
  /** Clave para que las presentaciones encuentren un producto nuevo del mismo archivo. */
  claves: string[];
  creadoId?: number;
}

interface PlanPresentacion {
  revisada: FilaRevisada;
  producto: PlanProducto | ProductoBd;
  existente?: PresentacionBd;
  data: Record<string, unknown>;
}

const MAX_FILAS = 10000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const mayus = (t: string | null) => (t ? t.replace(/\s+/g, ' ').trim().toUpperCase() : t);
const fmtFecha = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

@Injectable()
export class ImportacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async revisar(contenido: Buffer, archivo: string, modoStock: ModoStock): Promise<Revision> {
    const { revision } = await this.planificar(contenido, archivo, modoStock);
    return revision;
  }

  async importar(contenido: Buffer, archivo: string, modoStock: ModoStock, usuarioId: number) {
    const { revision, productos, presentaciones } = await this.planificar(contenido, archivo, modoStock);
    const validosP = productos.filter((p) => p.revisada.estado === 'nuevo' || p.revisada.estado === 'actualiza');
    const validosPr = presentaciones.filter((p) => p.revisada.estado === 'nuevo' || p.revisada.estado === 'actualiza');
    if (!validosP.length && !validosPr.length) throw new BadRequestException('El archivo no trae cambios para importar');
    const referencia = `Importación Excel ${archivo}`.slice(0, 190);

    await this.prisma.$transaction(
      async (tx) => {
        const categorias = await this.catalogo(tx, 'categoria', revision.resumen.categoriasNuevas);
        const marcas = await this.catalogo(tx, 'marca', revision.resumen.marcasNuevas);
        const idCat = async (nombre: string | null | undefined, cache: Map<string, number>, tipo: 'categoria' | 'marca') => {
          if (nombre === undefined) return undefined;
          if (nombre === null) return null;
          if (!cache.has(nombre)) {
            const fila = tipo === 'categoria'
              ? await tx.categoria.findUniqueOrThrow({ where: { nombre } })
              : await tx.marca.findUniqueOrThrow({ where: { nombre } });
            cache.set(nombre, fila.id);
          }
          return cache.get(nombre)!;
        };

        for (const p of validosP) {
          const categoriaId = await idCat(p.categoria, categorias, 'categoria');
          const marcaId = await idCat(p.marca, marcas, 'marca');
          const data = {
            ...p.data,
            ...(categoriaId !== undefined && { categoriaId }),
            ...(marcaId !== undefined && { marcaId }),
          };
          let id: number;
          if (p.existente) {
            id = p.existente.id;
            if (Object.keys(data).length) await tx.producto.update({ where: { id }, data });
          } else {
            id = (await tx.producto.create({ data: data as Prisma.ProductoUncheckedCreateInput })).id;
            p.creadoId = id;
          }
          if (Math.abs(p.movimiento) >= 0.0005) {
            const lote = p.lote && p.movimiento > 0
              ? await tx.lote.create({ data: { productoId: id, codigo: p.lote.codigo, fechaVencimiento: p.lote.fechaVencimiento, cantidad: 0 } })
              : null;
            await this.stock.mover(tx, {
              productoId: id,
              tipo: TipoMovimiento.IMPORTACION,
              cantidad: p.movimiento,
              costoUnitario: p.costoMovimiento,
              usuarioId,
              loteId: lote?.id,
              referencia,
              motivo: modoStock === 'reemplazar' ? 'Stock contado (Excel)' : 'Ingreso desde Excel',
              permitirNegativo: true,
            });
          }
        }

        for (const pr of validosPr) {
          if (pr.existente) {
            await tx.presentacion.update({ where: { id: pr.existente.id }, data: pr.data });
          } else {
            const productoId = 'revisada' in pr.producto ? (pr.producto.existente?.id ?? pr.producto.creadoId!) : pr.producto.id;
            await tx.presentacion.create({ data: { ...(pr.data as Omit<Prisma.PresentacionUncheckedCreateInput, 'productoId'>), productoId } });
          }
        }
      },
      { timeout: 300_000, maxWait: 20_000 },
    );

    return { ...revision.resumen, conError: revision.resumen.conError };
  }

  private async catalogo(tx: Prisma.TransactionClient, tipo: 'categoria' | 'marca', nuevos: string[]) {
    const cache = new Map<string, number>();
    for (const nombre of nuevos) {
      const fila = tipo === 'categoria'
        ? await tx.categoria.upsert({ where: { nombre }, create: { nombre }, update: {} })
        : await tx.marca.upsert({ where: { nombre }, create: { nombre }, update: {} });
      cache.set(nombre, fila.id);
    }
    return cache;
  }

  /** Compara el archivo con la base y arma lo que se haría, sin guardar nada. */
  private async planificar(contenido: Buffer, archivo: string, modoStock: ModoStock) {
    let leido;
    try {
      leido = await leerArchivo(contenido, archivo);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (leido.productos.length + leido.presentaciones.length > MAX_FILAS) {
      throw new BadRequestException(`El archivo tiene más de ${MAX_FILAS} filas; divídelo en partes`);
    }
    if (!leido.productos.length && !leido.presentaciones.length) throw new BadRequestException('El archivo no tiene filas con datos');

    const [productosBd, presentacionesBd, categoriasBd, marcasBd] = await Promise.all([
      this.prisma.producto.findMany({ include: { categoria: true, marca: true } }),
      this.prisma.presentacion.findMany({ where: { activo: true } }),
      this.prisma.categoria.findMany(),
      this.prisma.marca.findMany(),
    ]);
    const porId = new Map(productosBd.map((p) => [p.id, p]));
    const porCodigo = new Map(productosBd.filter((p) => p.codigoBarra).map((p) => [p.codigoBarra!, p]));
    const porNombre = new Map<string, ProductoBd[]>();
    for (const p of productosBd) porNombre.set(mayus(p.nombre)!, [...(porNombre.get(mayus(p.nombre)!) ?? []), p]);
    const presPorCodigo = new Map(presentacionesBd.filter((p) => p.codigoBarra).map((p) => [p.codigoBarra!, p]));
    const nombresCat = new Set(categoriasBd.map((c) => c.nombre));
    const nombresMarca = new Set(marcasBd.map((c) => c.nombre));
    const categoriasNuevas = new Set<string>();
    const marcasNuevas = new Set<string>();

    // Códigos que ya usa alguna fila del archivo (para detectar repetidos).
    const codigosArchivo = new Map<string, string>();
    const tocados = new Set<number>();
    const planes: PlanProducto[] = [];

    for (const { fila, datos } of leido.productos) {
      const rev: FilaRevisada = { hoja: 'Productos', fila, estado: 'igual', nombre: '', codigo: null, cambios: [], errores: [], avisos: [] };
      const plan: PlanProducto = { revisada: rev, data: {}, movimiento: 0, costoMovimiento: 0, claves: [] };
      planes.push(plan);
      const error = (m: string) => rev.errores.push(m);
      const num = (campo: string, titulo: string, min = 0) => {
        const v = numero(datos[campo] ?? null);
        if (v === undefined) return error(`${titulo}: "${datos[campo]}" no es un número`), undefined;
        if (v !== null && v < min) return error(`${titulo} no puede ser negativo`), undefined;
        return v;
      };

      const idTxt = texto(datos.id ?? null);
      const codigo = texto(datos.codigo ?? null);
      const nombre = mayus(texto(datos.nombre ?? null));
      rev.nombre = nombre ?? '';
      rev.codigo = codigo;

      // 1) ID del sistema, 2) código de barras, 3) nombre exacto.
      let existente: ProductoBd | undefined;
      if (idTxt) {
        existente = /^\d+$/.test(idTxt) ? porId.get(Number(idTxt)) : undefined;
        if (!existente) error(`No hay un producto con ID ${idTxt} (déjalo vacío para crear uno nuevo)`);
      } else if (codigo && porCodigo.has(codigo)) {
        existente = porCodigo.get(codigo);
      } else if (codigo && presPorCodigo.has(codigo)) {
        const pres = presPorCodigo.get(codigo)!;
        error(`El código ${codigo} es de la presentación "${pres.nombre}" de ${porId.get(pres.productoId)?.nombre}; ponlo en la hoja Presentaciones`);
      } else if (!codigo && nombre) {
        const mismos = porNombre.get(nombre) ?? [];
        if (mismos.length === 1) existente = mismos[0];
        if (mismos.length > 1) error(`Hay ${mismos.length} productos llamados "${nombre}"; agrega el ID o el código de barras para saber cuál es`);
      }
      if (!existente && codigo && nombre && porNombre.has(nombre)) {
        rev.avisos.push(`Ya existe otro producto llamado "${nombre}" con otro código; se creará uno nuevo`);
      }
      if (existente) {
        if (tocados.has(existente.id)) error(`"${existente.nombre}" ya aparece en otra fila del archivo`);
        tocados.add(existente.id);
        plan.existente = existente;
        if (!rev.nombre) rev.nombre = existente.nombre;
      }
      if (rev.errores.length) {
        rev.estado = 'error';
        continue;
      }

      const p = existente;
      const cambia = (campo: string, titulo: string, nuevo: unknown, actual: unknown, mostrar = (x: unknown) => String(x ?? '—')) => {
        if (nuevo === undefined) return;
        const igual = typeof actual === 'number' || typeof nuevo === 'number' ? Number(actual ?? 0) === Number(nuevo ?? 0) : (actual ?? null) === (nuevo ?? null);
        if (p && igual) return;
        plan.data[campo] = nuevo;
        if (p) rev.cambios.push(`${titulo}: ${mostrar(actual)} → ${mostrar(nuevo)}`);
      };
      const soles = (x: unknown) => `S/ ${Number(x ?? 0).toFixed(2)}`;

      // Nombre
      if (nombre) {
        if (nombre.length < 2) error('El nombre es muy corto');
        cambia('nombre', 'Nombre', nombre, p ? mayus(p.nombre) : undefined);
      } else if (!p) error(codigo ? `El código ${codigo} no está en el sistema y la fila no trae nombre para crearlo` : 'Falta el nombre');

      // Código de barras
      if (codigo) {
        const otra = codigosArchivo.get(codigo);
        if (otra) error(`El código ${codigo} se repite (también está en ${otra})`);
        codigosArchivo.set(codigo, `la fila ${fila}`);
        const dueno = porCodigo.get(codigo);
        if (dueno && dueno.id !== p?.id) error(`El código ${codigo} ya lo usa "${dueno.nombre}"`);
        if (presPorCodigo.has(codigo) && p) error(`El código ${codigo} ya lo usa una presentación`);
        cambia('codigoBarra', 'Código', codigo, p?.codigoBarra);
        plan.claves.push(`c:${codigo}`);
      }
      if (nombre) plan.claves.push(`n:${nombre}`);
      if (p) plan.claves.push(`i:${p.id}`);

      // Catálogos
      for (const [campo, titulo, nombres, nuevos, actual] of [
        ['categoria', 'Categoría', nombresCat, categoriasNuevas, p?.categoria?.nombre ?? null],
        ['marca', 'Marca', nombresMarca, marcasNuevas, p?.marca?.nombre ?? null],
      ] as const) {
        const v = mayus(texto(datos[campo] ?? null));
        if (v === null || (p && v === (actual ?? null))) continue;
        const sinNada = v === 'SIN MARCA' || v === 'SIN FAMILIA' || v === 'SIN CATEGORIA' || v === 'SIN CATEGORÍA';
        if (sinNada && !actual) continue;
        plan[campo] = sinNada ? null : v;
        if (!sinNada && !nombres.has(v)) nuevos.add(v);
        if (p) rev.cambios.push(`${titulo}: ${actual ?? '—'} → ${sinNada ? '—' : v}`);
      }

      const unidad = mayus(texto(datos.unidad ?? null));
      if (unidad) cambia('unidad', 'Unidad', unidad.slice(0, 20), p?.unidad);

      const costo = num('costo', 'Costo');
      if (costo != null) cambia('costo', 'Costo', r3(costo), p ? Number(p.costo) : undefined, soles);

      const precios = [num('precio1', 'Precio 1'), num('precio2', 'Precio 2'), num('precio3', 'Precio 3')];
      if (!p && precios[0] == null && !rev.errores.length) error('Falta el Precio 1 para crear el producto');
      if (!p && precios[0] != null) {
        // Producto nuevo: los precios 2 y 3 vacíos toman el precio 1, como en el formulario.
        precios[1] ??= precios[0];
        precios[2] ??= precios[0];
      }
      precios.forEach((v, i) => v != null && cambia(`precio${i + 1}`, `Precio ${i + 1}`, r2(v), p ? Number(p[`precio${i + 1}` as 'precio1']) : undefined, soles));
      if (precios[0] === 0) rev.avisos.push('Precio 1 en cero');
      const costoFinal = costo ?? (p ? Number(p.costo) : 0);
      const precioFinal = precios[0] ?? (p ? Number(p.precio1) : 0);
      if (costoFinal > 0 && precioFinal > 0 && precioFinal < costoFinal) rev.avisos.push(`Se vende (S/ ${precioFinal.toFixed(2)}) por debajo del costo (S/ ${costoFinal.toFixed(2)})`);

      const minimo = num('stockMinimo', 'Stock mínimo');
      if (minimo != null) cambia('stockMinimo', 'Stock mínimo', r3(minimo), p ? Number(p.stockMinimo) : undefined);

      const activo = siNo(datos.activo ?? null);
      if (activo === undefined) error(`Activo: "${datos.activo}" no se entiende (usa SI o NO)`);
      else if (activo !== null) cambia('activo', 'Activo', activo, p?.activo, (x) => (x ? 'SI' : 'NO'));

      let vence = siNo(datos.controlaVencimiento ?? null);
      if (vence === undefined) error(`Controla vencimiento: "${datos.controlaVencimiento}" no se entiende (usa SI o NO)`);
      const fv = fecha(datos.fechaVencimiento ?? null);
      if (fv === undefined) error(`Fecha de vencimiento: "${texto(datos.fechaVencimiento ?? null)}" no es una fecha (usa dd/mm/aaaa)`);
      // Si trae fecha de vencimiento, el producto pasa a controlar vencimientos.
      if (fv) vence = true;
      if (vence != null) cambia('controlaVencimiento', 'Controla vencimiento', vence, p?.controlaVencimiento, (x) => (x ? 'SI' : 'NO'));

      // Stock
      const stock = num('stock', 'Stock', modoStock === 'reemplazar' ? 0 : -Infinity);
      const actual = p ? Number(p.stock) : 0;
      if (stock != null) {
        plan.movimiento = r3(modoStock === 'reemplazar' || !p ? stock - actual : stock);
        if (modoStock === 'sumar' && stock < 0) error('En modo "sumar" el stock que ingresa no puede ser negativo');
      }
      plan.costoMovimiento = costoFinal;
      if (Math.abs(plan.movimiento) >= 0.0005) {
        const final = r3(actual + plan.movimiento);
        const signo = plan.movimiento > 0 ? '+' : '';
        rev.cambios.push(p ? `Stock: ${actual} → ${final} (${signo}${plan.movimiento})` : `Stock inicial: ${final}`);
        if (final < 0) rev.avisos.push(`El stock queda en negativo (${final})`);
      }
      if (fv) {
        if (plan.movimiento > 0) {
          plan.lote = { codigo: texto(datos.lote ?? null), fechaVencimiento: fv };
          rev.cambios.push(`Lote que vence el ${fmtFecha(fv)} con ${plan.movimiento} unidades`);
        } else rev.avisos.push('Trae fecha de vencimiento pero no entra stock: no se crea lote');
      } else if (texto(datos.lote ?? null)) rev.avisos.push('Trae lote sin fecha de vencimiento: se ignora');

      if (!p) {
        plan.data.unidad ??= 'UND';
        plan.data.precio1 ??= 0;
        rev.cambios.unshift(`Precio 1: ${soles(plan.data.precio1)} · Costo: ${soles(plan.data.costo)}`);
      }
      rev.estado = rev.errores.length ? 'error' : !p ? 'nuevo' : rev.cambios.length ? 'actualiza' : 'igual';
      // El aviso de precio bajo el costo solo importa si la fila crea o cambia algo.
      if (rev.estado === 'igual') rev.avisos = rev.avisos.filter((a) => !a.startsWith('Se vende'));
    }

    // Presentaciones: el producto puede venir en este mismo archivo.
    const enArchivo = new Map<string, PlanProducto>();
    for (const pl of planes) {
      for (const c of pl.claves) if (!enArchivo.has(c) || enArchivo.get(c)!.revisada.estado === 'error') enArchivo.set(c, pl);
    }
    const presPorProducto = new Map<number, PresentacionBd[]>();
    for (const pr of presentacionesBd) presPorProducto.set(pr.productoId, [...(presPorProducto.get(pr.productoId) ?? []), pr]);
    const presTocadas = new Set<number>();
    const planesPres: PlanPresentacion[] = [];

    for (const { fila, datos } of leido.presentaciones) {
      const rev: FilaRevisada = { hoja: 'Presentaciones', fila, estado: 'igual', nombre: '', codigo: null, cambios: [], errores: [], avisos: [] };
      const error = (m: string) => rev.errores.push(m);
      const idTxt = texto(datos.productoId ?? null);
      const codProd = texto(datos.productoCodigo ?? null);
      const nomProd = mayus(texto(datos.productoNombre ?? null));
      const nombre = mayus(texto(datos.nombre ?? null));
      const codigo = texto(datos.codigo ?? null);
      rev.codigo = codigo;

      let producto: PlanProducto | ProductoBd | undefined;
      if (idTxt) producto = enArchivo.get(`i:${idTxt}`) ?? (/^\d+$/.test(idTxt) ? porId.get(Number(idTxt)) : undefined);
      else if (codProd) producto = enArchivo.get(`c:${codProd}`) ?? porCodigo.get(codProd);
      else if (nomProd) {
        const mismos = porNombre.get(nomProd) ?? [];
        producto = enArchivo.get(`n:${nomProd}`) ?? (mismos.length === 1 ? mismos[0] : undefined);
        if (!producto && mismos.length > 1) error(`Hay ${mismos.length} productos llamados "${nomProd}"; usa el código del producto`);
      }
      const nombreProd = producto ? ('revisada' in producto ? producto.revisada.nombre : producto.nombre) : (nomProd ?? codProd ?? idTxt ?? '');
      rev.nombre = `${nombreProd} – ${nombre ?? '?'}`;
      if (!producto && !rev.errores.length) error(idTxt || codProd || nomProd ? `No se encontró el producto ${idTxt ?? codProd ?? nomProd}` : 'Falta el producto (ID, código o nombre)');
      if (!nombre) error('Falta el nombre de la presentación (ej. CAJETILLA X20)');
      if (!producto || rev.errores.length) {
        rev.estado = 'error';
        planesPres.push({ revisada: rev, producto: producto ?? ({} as ProductoBd), data: {} });
        continue;
      }

      const productoId = 'revisada' in producto ? producto.existente?.id : producto.id;
      const existentes = productoId ? (presPorProducto.get(productoId) ?? []) : [];
      const existente = (codigo && existentes.find((x) => x.codigoBarra === codigo)) || existentes.find((x) => x.nombre === nombre);
      if (existente) {
        if (presTocadas.has(existente.id)) error('Esta presentación ya aparece en otra fila');
        presTocadas.add(existente.id);
      }
      const plan: PlanPresentacion = { revisada: rev, producto, existente, data: {} };
      planesPres.push(plan);

      const cambia = (campo: string, titulo: string, nuevo: unknown, actual: unknown, mostrar = (x: unknown) => String(x ?? '—')) => {
        if (nuevo === undefined) return;
        const igual = typeof nuevo === 'number' ? Number(actual ?? 0) === nuevo : (actual ?? null) === (nuevo ?? null);
        if (existente && igual) return;
        plan.data[campo] = nuevo;
        if (existente) rev.cambios.push(`${titulo}: ${mostrar(actual)} → ${mostrar(nuevo)}`);
      };
      const soles = (x: unknown) => `S/ ${Number(x ?? 0).toFixed(2)}`;
      const num = (v: Valor | undefined, titulo: string) => {
        const n = numero(v ?? null);
        if (n === undefined) return error(`${titulo}: "${v}" no es un número`), undefined;
        if (n !== null && n < 0) return error(`${titulo} no puede ser negativo`), undefined;
        return n;
      };

      cambia('nombre', 'Nombre', nombre, existente?.nombre);
      const factor = num(datos.factor, 'Unidades que trae');
      if (factor === null && !existente) error('Falta cuántas unidades trae');
      if (factor != null && factor <= 1) error('Una presentación trae más de 1 unidad (la unidad es el producto mismo)');
      if (factor != null) cambia('factor', 'Unidades', r3(factor), existente ? Number(existente.factor) : undefined);

      if (codigo) {
        const otra = codigosArchivo.get(codigo);
        if (otra) error(`El código ${codigo} se repite (también está en ${otra})`);
        codigosArchivo.set(codigo, `la fila ${fila} de Presentaciones`);
        const dueno = porCodigo.get(codigo);
        if (dueno) error(`El código ${codigo} ya lo usa el producto "${dueno.nombre}"`);
        const otraPres = presPorCodigo.get(codigo);
        if (otraPres && otraPres.id !== existente?.id) error(`El código ${codigo} ya lo usa la presentación "${otraPres.nombre}"`);
        cambia('codigoBarra', 'Código', codigo, existente?.codigoBarra);
      }

      const precios = [num(datos.precio1, 'Precio 1'), num(datos.precio2, 'Precio 2'), num(datos.precio3, 'Precio 3')];
      if (!existente && precios[0] == null) error('Falta el Precio 1 de la presentación');
      if (!existente && precios[0] != null) {
        precios[1] ??= precios[0];
        precios[2] ??= precios[0];
      }
      precios.forEach((v, i) => v != null && cambia(`precio${i + 1}`, `Precio ${i + 1}`, r2(v), existente ? Number(existente[`precio${i + 1}` as 'precio1']) : undefined, soles));

      rev.estado = rev.errores.length ? 'error' : !existente ? 'nuevo' : rev.cambios.length ? 'actualiza' : 'igual';
    }

    // Una presentación de un producto con error no se puede crear.
    for (const pr of planesPres) {
      if (pr.revisada.estado !== 'error' && 'revisada' in pr.producto && pr.producto.revisada.estado === 'error') {
        pr.revisada.errores.push(`El producto tiene errores (fila ${pr.producto.revisada.fila} de Productos)`);
        pr.revisada.estado = 'error';
      }
    }

    for (const f of [...planes, ...planesPres]) if (f.revisada.estado === 'error') f.revisada.cambios = [];

    // Solo se crean los catálogos que usen filas válidas.
    const usados = (campo: 'categoria' | 'marca') => new Set(planes.filter((p) => p.revisada.estado !== 'error' && p[campo]).map((p) => p[campo]!));
    const todas = [...planes.map((p) => p.revisada), ...planesPres.map((p) => p.revisada)];
    const cuenta = (hoja: FilaRevisada['hoja'], estado: FilaRevisada['estado']) => todas.filter((f) => f.hoja === hoja && f.estado === estado).length;
    const validos = planes.filter((p) => p.revisada.estado === 'nuevo' || p.revisada.estado === 'actualiza');
    const revision: Revision = {
      archivo,
      modoStock,
      resumen: {
        productosNuevos: cuenta('Productos', 'nuevo'),
        productosActualizados: cuenta('Productos', 'actualiza'),
        presentacionesNuevas: cuenta('Presentaciones', 'nuevo'),
        presentacionesActualizadas: cuenta('Presentaciones', 'actualiza'),
        sinCambios: todas.filter((f) => f.estado === 'igual').length,
        conError: todas.filter((f) => f.estado === 'error').length,
        unidadesEntran: r3(validos.reduce((s, p) => s + Math.max(0, p.movimiento), 0)),
        unidadesSalen: r3(validos.reduce((s, p) => s - Math.min(0, p.movimiento), 0)),
        categoriasNuevas: [...categoriasNuevas].filter((c) => usados('categoria').has(c)).sort(),
        marcasNuevas: [...marcasNuevas].filter((c) => usados('marca').has(c)).sort(),
      },
      columnasIgnoradas: leido.ignoradas,
      filas: todas.filter((f) => f.estado !== 'igual' || f.avisos.length),
    };
    return { revision, productos: planes, presentaciones: planesPres };
  }

  /** Plantilla para llenar: vacía o con todos los productos actuales para editarlos. */
  async plantilla(conProductos: boolean): Promise<Buffer> {
    const libro = new ExcelJS.Workbook();
    const cabecera = (hoja: ExcelJS.Worksheet, columnas: { titulo: string; ancho: number; formato?: string; nota?: string }[]) => {
      hoja.columns = columnas.map((c) => ({ header: c.titulo, width: c.ancho, style: c.formato ? { numFmt: c.formato } : {} }));
      const fila = hoja.getRow(1);
      fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      fila.eachCell((c, i) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2255C' } };
        const nota = columnas[i - 1].nota;
        if (nota) c.note = nota;
      });
      hoja.views = [{ state: 'frozen', ySplit: 1 }];
    };

    const productos = libro.addWorksheet('Productos');
    cabecera(productos, [
      { titulo: 'ID sistema', ancho: 10, nota: 'No lo cambies. Vacío = producto nuevo.' },
      { titulo: 'Código de barras', ancho: 16, formato: '@' },
      { titulo: 'Nombre', ancho: 42 },
      { titulo: 'Categoría', ancho: 16 },
      { titulo: 'Marca', ancho: 16 },
      { titulo: 'Unidad', ancho: 8 },
      { titulo: 'Costo', ancho: 10, formato: '0.00##' },
      { titulo: 'Precio 1', ancho: 10, formato: '0.00' },
      { titulo: 'Precio 2', ancho: 10, formato: '0.00' },
      { titulo: 'Precio 3', ancho: 10, formato: '0.00' },
      { titulo: 'Stock', ancho: 9, nota: 'En unidades. Según lo que elijas al importar: stock contado (reemplaza) o lo que ingresa (se suma).' },
      { titulo: 'Stock mínimo', ancho: 12 },
      { titulo: 'Controla vencimiento', ancho: 12, nota: 'SI o NO' },
      { titulo: 'Fecha de vencimiento', ancho: 14, formato: 'dd/mm/yyyy', nota: 'Opcional. Crea un lote con las unidades que entran.' },
      { titulo: 'Lote', ancho: 12 },
      { titulo: 'Activo', ancho: 8, nota: 'SI o NO. NO oculta el producto de la venta.' },
    ]);
    const presentaciones = libro.addWorksheet('Presentaciones');
    cabecera(presentaciones, [
      { titulo: 'ID producto', ancho: 10, nota: 'ID sistema del producto (o usa el código o el nombre del producto).' },
      { titulo: 'Código del producto', ancho: 16, formato: '@' },
      { titulo: 'Producto', ancho: 36 },
      { titulo: 'Presentación', ancho: 18, nota: 'Ej. CAJETILLA X20, PAQUETE X6' },
      { titulo: 'Unidades que trae', ancho: 10 },
      { titulo: 'Código de barras', ancho: 16, formato: '@' },
      { titulo: 'Precio 1', ancho: 10, formato: '0.00' },
      { titulo: 'Precio 2', ancho: 10, formato: '0.00' },
      { titulo: 'Precio 3', ancho: 10, formato: '0.00' },
    ]);

    if (conProductos) {
      const lista = await this.prisma.producto.findMany({
        include: { categoria: true, marca: true, presentaciones: { where: { activo: true }, orderBy: { factor: 'asc' } } },
        orderBy: { nombre: 'asc' },
      });
      for (const p of lista) {
        productos.addRow([
          p.id, p.codigoBarra, p.nombre, p.categoria?.nombre ?? null, p.marca?.nombre ?? null, p.unidad,
          Number(p.costo), Number(p.precio1), Number(p.precio2), Number(p.precio3), Number(p.stock), Number(p.stockMinimo),
          p.controlaVencimiento ? 'SI' : 'NO', null, null, p.activo ? 'SI' : 'NO',
        ]);
        for (const pr of p.presentaciones) {
          presentaciones.addRow([p.id, p.codigoBarra, p.nombre, pr.nombre, Number(pr.factor), pr.codigoBarra, Number(pr.precio1), Number(pr.precio2), Number(pr.precio3)]);
        }
      }
    } else {
      productos.addRow([null, '7750000000017', 'GASEOSA EJEMPLO 500 ML', 'BEBIDAS', 'MARCA EJEMPLO', 'UND', 1.6, 2.5, 2.4, 2.3, 24, 6, 'NO', null, null, 'SI']);
      productos.addRow([null, null, 'GALLETA EJEMPLO SIN CÓDIGO', 'GALLETAS', null, 'UND', 0.45, 0.7, null, null, 50, 10, 'SI', new Date(Date.UTC(2027, 2, 31)), 'L-123', 'SI']);
      presentaciones.addRow([null, '7750000000017', 'GASEOSA EJEMPLO 500 ML', 'PAQUETE X6', 6, '7750000000024', 14, 13.5, 13]);
    }

    const ayuda = libro.addWorksheet('Instrucciones');
    ayuda.getColumn(1).width = 110;
    [
      ['Cómo llenar este archivo', true],
      [''],
      ['Hoja Productos: una fila por producto. Hoja Presentaciones (opcional): cajetillas, paquetes, cajas…', false],
      ['Para saber si un producto ya existe, el sistema busca en este orden: ID sistema, código de barras y, si no tiene código, el nombre exacto.'],
      ['Si no lo encuentra, lo crea. Para crear un producto hacen falta al menos Nombre y Precio 1.'],
      ['Una celda vacía no cambia nada. Para borrar la categoría o la marca escribe SIN CATEGORIA o SIN MARCA.'],
      ['Stock: siempre en unidades. Al importar eliges si es el stock contado (reemplaza el actual) o lo que ingresa (se suma). Queda en el kardex como "Importación".'],
      ['Precio 2 y Precio 3 vacíos en un producto nuevo toman el Precio 1.'],
      ['Fecha de vencimiento (dd/mm/aaaa) y Lote son opcionales: crean un lote con las unidades que entran y activan "Controla vencimiento".'],
      ['Presentaciones: indica el producto por su ID, su código o su nombre; "Unidades que trae" es cuántas unidades del producto descuenta al venderla.'],
      ['Antes de guardar, el sistema muestra qué va a crear o cambiar y qué filas tienen errores. Nada se guarda hasta que confirmes.'],
      ['También puedes subir un Excel propio: las columnas se reconocen por su título (Código, Producto, Precio, Stock, Costo…).'],
    ].forEach(([t, negrita], i) => {
      const fila = ayuda.addRow([t]);
      if (negrita || i === 0) fila.font = { bold: true, size: 13 };
      fila.alignment = { wrapText: true };
    });

    return Buffer.from(await libro.xlsx.writeBuffer());
  }
}
