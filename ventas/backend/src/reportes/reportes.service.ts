import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { Reporte } from './reporte';

export interface Filtro {
  desde: Date;
  hasta: Date; // exclusivo
  etiqueta: string;
}

const ZONA = 'America/Lima';
const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const suma = (filas: Record<string, unknown>[], ...claves: string[]) =>
  Object.fromEntries(claves.map((k) => [k, r2(filas.reduce((s, f) => s + Number(f[k] ?? 0), 0))]));
const margen = (utilidad: number, venta: number) => (venta > 0 ? Math.round((utilidad / venta) * 1000) / 10 : 0);

const MEDIO: Record<string, string> = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', YAPE: 'Yape', PLIN: 'Plin', TRANSFERENCIA: 'Transferencia' };
const ESTADO_SUNAT: Record<string, string> = {
  PENDIENTE: 'Pendiente de envío',
  ACEPTADO: 'Aceptada',
  OBSERVADO: 'Aceptada con observaciones',
  RECHAZADO: 'Rechazada',
  BAJA_PENDIENTE: 'Anulada · baja por enviar',
  BAJA_ENVIADA: 'Anulada · baja enviada',
  BAJA_ACEPTADA: 'Anulada · baja aceptada',
  NO_APLICA: 'No enviada (SUNAT desactivado)',
};
const RESULTADO: Record<string, string> = { ACEPTADO: 'Aceptada', OBSERVADO: 'Aceptada con observaciones', RECHAZADO: 'Rechazada', ERROR: 'Error de SUNAT' };
const correlativo = (serie: string, numero: number) => `${serie}-${String(numero).padStart(8, '0')}`;
const COMPROBANTE: Record<string, string> = { BOLETA: 'BOLETA DE VENTA', BOLETA_LIBRE: 'BOLETA VENTA LIBRE' };

export type CategoriaReporte = 'ventas' | 'compras' | 'kardex' | 'sunat' | 'gastos';
interface DefReporte {
  titulo: string;
  categoria: CategoriaReporte;
  /** false: no pide período (foto del momento). */
  usaFechas?: boolean;
  /** Pide elegir un producto. */
  requiereProducto?: boolean;
}

export const REPORTES = {
  'ventas-resumido': { titulo: 'Ventas resumido', categoria: 'ventas' },
  'ventas-por-producto': { titulo: 'Ventas por producto', categoria: 'ventas' },
  'ventas-por-dia': { titulo: 'Ventas por día', categoria: 'ventas' },
  'ventas-por-medio': { titulo: 'Ventas por medio de pago', categoria: 'ventas' },
  'ventas-por-cajero': { titulo: 'Ventas por cajero', categoria: 'ventas' },
  utilidad: { titulo: 'Utilidad del período', categoria: 'ventas' },
  'compras-detallado': { titulo: 'Compras por documento', categoria: 'compras' },
  compras: { titulo: 'Compras por proveedor', categoria: 'compras' },
  'compras-por-producto': { titulo: 'Compras por producto', categoria: 'compras' },
  'compras-por-dia': { titulo: 'Compras por día', categoria: 'compras' },
  'pagos-proveedores': { titulo: 'Pagos a proveedores', categoria: 'compras' },
  kardex: { titulo: 'Kardex por producto', categoria: 'kardex', requiereProducto: true },
  'kardex-resumen': { titulo: 'Kardex resumen (todos los productos)', categoria: 'kardex' },
  'stock-valorizado': { titulo: 'Stock valorizado', categoria: 'kardex', usaFechas: false },
  'boletas-sunat': { titulo: 'Boletas electrónicas (SUNAT)', categoria: 'sunat' },
  'envios-sunat': { titulo: 'Historial de envíos a SUNAT', categoria: 'sunat' },
  'gastos-detallado': { titulo: 'Gastos detallado', categoria: 'gastos' },
  'gastos-por-categoria': { titulo: 'Gastos por categoría', categoria: 'gastos' },
  'gastos-por-mes': { titulo: 'Gastos por mes', categoria: 'gastos' },
  'sueldos-por-trabajador': { titulo: 'Sueldos y adelantos por trabajador', categoria: 'gastos' },
  'movimientos-acumulado': { titulo: 'Movimientos del acumulado', categoria: 'gastos' },
  'conteos-acumulado': { titulo: 'Conteos del acumulado', categoria: 'gastos' },
} satisfies Record<string, DefReporte>;
export type NombreReporte = keyof typeof REPORTES;
export const defReporte = (n: NombreReporte): DefReporte => REPORTES[n];

const TIPO_DOC: Record<string, string> = { FACTURA: 'Factura', BOLETA: 'Boleta', GUIA: 'Guía', NOTA_VENTA: 'Nota de venta' };
const CONDICION: Record<string, string> = { CONTADO: 'Contado', CREDITO: 'Crédito' };
const MOVIMIENTO: Record<string, string> = {
  IMPORTACION: 'Stock inicial',
  COMPRA: 'Compra',
  ANULACION_COMPRA: 'Anulación de compra',
  VENTA: 'Venta',
  ANULACION_VENTA: 'Anulación de venta',
  MERMA: 'Merma',
  AJUSTE: 'Ajuste',
  INVENTARIO: 'Inventario',
};

const ORIGEN_GASTO: Record<string, string> = { ACUMULADO: 'Acumulado', CAJA: 'Caja del día' };
const TIPO_FONDO: Record<string, string> = {
  CIERRE_CAJA: 'Cierre de caja',
  GASTO: 'Gasto',
  PAGO_PROVEEDOR: 'Pago a proveedor',
  RETIRO: 'Retiro o depósito',
  TRASPASO: 'Traspaso',
  AJUSTE_CONTEO: 'Ajuste de conteo',
  ANULACION: 'Anulación',
};

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  filtro(desde?: string, hasta?: string): Filtro {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!desde || !hasta || !re.test(desde) || !re.test(hasta)) throw new BadRequestException('Indica las fechas desde y hasta');
    const d = new Date(`${desde}T00:00:00`);
    const h = new Date(new Date(`${hasta}T00:00:00`).getTime() + 86_400_000);
    if (h <= d) throw new BadRequestException('La fecha final es anterior a la inicial');
    const fmt = (s: string) => s.split('-').reverse().join('/');
    return { desde: d, hasta: h, etiqueta: `Desde ${fmt(desde)} hasta ${fmt(hasta)}` };
  }

  generar(nombre: NombreReporte, f: Filtro, productoId?: number): Promise<Reporte> {
    switch (nombre) {
      case 'ventas-resumido':
        return this.ventasResumido(f);
      case 'ventas-por-producto':
        return this.ventasPorProducto(f);
      case 'ventas-por-dia':
        return this.ventasPorDia(f);
      case 'ventas-por-medio':
        return this.ventasPorMedio(f);
      case 'ventas-por-cajero':
        return this.ventasPorCajero(f);
      case 'utilidad':
        return this.utilidad(f);
      case 'compras':
        return this.compras(f);
      case 'compras-detallado':
        return this.comprasDetallado(f);
      case 'compras-por-producto':
        return this.comprasPorProducto(f);
      case 'compras-por-dia':
        return this.comprasPorDia(f);
      case 'pagos-proveedores':
        return this.pagosProveedores(f);
      case 'kardex':
        if (!productoId) throw new BadRequestException('Elige un producto');
        return this.kardex(f, productoId);
      case 'kardex-resumen':
        return this.kardexResumen(f);
      case 'boletas-sunat':
        return this.boletasSunat(f);
      case 'envios-sunat':
        return this.enviosSunat(f);
      case 'stock-valorizado':
        return this.stockValorizado();
      case 'gastos-detallado':
        return this.gastosDetallado(f);
      case 'gastos-por-categoria':
        return this.gastosPorCategoria(f);
      case 'gastos-por-mes':
        return this.gastosPorMes(f);
      case 'sueldos-por-trabajador':
        return this.sueldosPorTrabajador(f);
      case 'movimientos-acumulado':
        return this.movimientosAcumulado(f);
      case 'conteos-acumulado':
        return this.conteosAcumulado(f);
      default:
        throw new BadRequestException('Reporte desconocido');
    }
  }

  /** Igual al "Reporte de ventas resumido" de SysVent: agrupado por comprobante. */
  private async ventasResumido(f: Filtro): Promise<Reporte> {
    const ventas = await this.prisma.venta.findMany({
      where: { fecha: { gte: f.desde, lt: f.hasta }, estado: 'EMITIDA' },
      include: { cliente: true, usuario: { select: { nombre: true } }, pagos: true },
      orderBy: [{ tipoComprobante: 'asc' }, { serie: 'asc' }, { numero: 'asc' }],
    });
    const filas = ventas.map((v) => ({
      comprobante: COMPROBANTE[v.tipoComprobante],
      correlativo: `${v.serie}-${String(v.numero).padStart(8, '0')}`,
      fecha: v.fecha,
      cliente: v.cliente?.nombre ?? 'PÚBLICO GENERAL',
      medio: v.pagos.map((p) => MEDIO[p.medioPago]).join(' + '),
      referencia: v.pagos.map((p) => p.numeroOperacion).filter(Boolean).join(', '),
      cajero: v.usuario.nombre,
      subtotal: r2(v.subtotal),
      descuento: r2(v.descuento),
      igv: r2(v.igv),
      total: r2(v.total),
    }));
    return {
      titulo: 'Reporte de ventas resumido',
      subtitulo: f.etiqueta,
      agruparPor: 'comprobante',
      columnas: [
        { clave: 'correlativo', titulo: 'Correlativo' },
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'cliente', titulo: 'Cliente' },
        { clave: 'medio', titulo: 'M. pago' },
        { clave: 'referencia', titulo: 'Ref. pago' },
        { clave: 'cajero', titulo: 'Cajero' },
        { clave: 'subtotal', titulo: 'Subtotal', tipo: 'moneda' },
        { clave: 'descuento', titulo: 'Dscto.', tipo: 'moneda' },
        { clave: 'igv', titulo: 'IGV', tipo: 'moneda' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'subtotal', 'descuento', 'igv', 'total'),
    };
  }

  private async ventasPorProducto(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ codigo: string | null; producto: string; cantidad: number; importe: number; costo: number }[]>`
      SELECT p."codigoBarra" AS codigo, p.nombre AS producto,
             SUM(i.cantidad * i.factor)::float AS cantidad, SUM(i.subtotal)::float AS importe,
             SUM(i.cantidad * i."costoUnitario")::float AS costo
      FROM "VentaItem" i JOIN "Venta" v ON v.id = i."ventaId" JOIN "Producto" p ON p.id = i."productoId"
      WHERE v.estado = 'EMITIDA' AND v.fecha >= ${f.desde} AND v.fecha < ${f.hasta}
      GROUP BY p.id ORDER BY importe DESC`;
    const filas = rows.map((r) => {
      const utilidad = r2(r.importe - r.costo);
      return { ...r, importe: r2(r.importe), costo: r2(r.costo), utilidad, margen: margen(utilidad, r.importe) };
    });
    const tot = suma(filas, 'cantidad', 'importe', 'costo', 'utilidad');
    return {
      titulo: 'Ventas por producto',
      subtitulo: `${f.etiqueta} · el importe no descuenta los descuentos globales`,
      columnas: [
        { clave: 'codigo', titulo: 'Código' },
        { clave: 'producto', titulo: 'Producto' },
        { clave: 'cantidad', titulo: 'Unidades', tipo: 'numero' },
        { clave: 'importe', titulo: 'Importe', tipo: 'moneda' },
        { clave: 'costo', titulo: 'Costo', tipo: 'moneda' },
        { clave: 'utilidad', titulo: 'Utilidad', tipo: 'moneda' },
        { clave: 'margen', titulo: 'Margen', tipo: 'porcentaje' },
      ],
      filas,
      totales: { ...tot, margen: margen(tot.utilidad, tot.importe) },
    };
  }

  private async ventasPorDia(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ dia: Date; ventas: number; boleta: number; libre: number; total: number; costo: number }[]>`
      SELECT (fecha AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA})::date AS dia,
             COUNT(*)::int AS ventas,
             COALESCE(SUM(total) FILTER (WHERE "tipoComprobante" = 'BOLETA'), 0)::float AS boleta,
             COALESCE(SUM(total) FILTER (WHERE "tipoComprobante" = 'BOLETA_LIBRE'), 0)::float AS libre,
             SUM(total)::float AS total, SUM("costoTotal")::float AS costo
      FROM "Venta" WHERE estado = 'EMITIDA' AND fecha >= ${f.desde} AND fecha < ${f.hasta}
      GROUP BY dia ORDER BY dia`;
    const filas = rows.map((r) => {
      const utilidad = r2(r.total - r.costo);
      return { ...r, dia: r.dia.toISOString().slice(0, 10), boleta: r2(r.boleta), libre: r2(r.libre), total: r2(r.total), utilidad, ticket: r.ventas ? r2(r.total / r.ventas) : 0 };
    });
    const tot = suma(filas, 'ventas', 'boleta', 'libre', 'total', 'utilidad');
    return {
      titulo: 'Ventas por día',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'dia', titulo: 'Día', tipo: 'fecha' },
        { clave: 'ventas', titulo: 'N.º ventas', tipo: 'numero' },
        { clave: 'boleta', titulo: 'Boleta', tipo: 'moneda' },
        { clave: 'libre', titulo: 'Boleta libre', tipo: 'moneda' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
        { clave: 'utilidad', titulo: 'Utilidad', tipo: 'moneda' },
        { clave: 'ticket', titulo: 'Ticket promedio', tipo: 'moneda' },
      ],
      filas,
      totales: { ...tot, ticket: tot.ventas ? r2(tot.total / tot.ventas) : 0 },
    };
  }

  private async ventasPorMedio(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.ventaPago.groupBy({
      by: ['medioPago'],
      where: { venta: { estado: 'EMITIDA', fecha: { gte: f.desde, lt: f.hasta } } },
      _sum: { monto: true },
      _count: true,
    });
    const total = rows.reduce((s, r) => s + Number(r._sum.monto ?? 0), 0);
    const filas = rows
      .map((r) => ({ medio: MEDIO[r.medioPago], pagos: r._count, monto: r2(r._sum.monto), participacion: total ? Math.round((Number(r._sum.monto) / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.monto - a.monto);
    return {
      titulo: 'Ventas por medio de pago',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'medio', titulo: 'Medio de pago' },
        { clave: 'pagos', titulo: 'N.º pagos', tipo: 'numero' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
        { clave: 'participacion', titulo: '% del total', tipo: 'porcentaje' },
      ],
      filas,
      totales: suma(filas, 'pagos', 'monto'),
    };
  }

  private async ventasPorCajero(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ cajero: string; ventas: number; total: number; descuentos: number; anuladas: number; montoAnulado: number }[]>`
      SELECT u.nombre AS cajero,
             COUNT(*) FILTER (WHERE v.estado = 'EMITIDA')::int AS ventas,
             COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'EMITIDA'), 0)::float AS total,
             COALESCE(SUM(v.descuento) FILTER (WHERE v.estado = 'EMITIDA'), 0)::float AS descuentos,
             COUNT(*) FILTER (WHERE v.estado = 'ANULADA')::int AS anuladas,
             COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'ANULADA'), 0)::float AS "montoAnulado"
      FROM "Venta" v JOIN "Usuario" u ON u.id = v."usuarioId"
      WHERE v.fecha >= ${f.desde} AND v.fecha < ${f.hasta}
      GROUP BY u.id ORDER BY total DESC`;
    const filas = rows.map((r) => ({ ...r, total: r2(r.total), descuentos: r2(r.descuentos), montoAnulado: r2(r.montoAnulado) }));
    return {
      titulo: 'Ventas por cajero',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'cajero', titulo: 'Cajero' },
        { clave: 'ventas', titulo: 'N.º ventas', tipo: 'numero' },
        { clave: 'total', titulo: 'Total vendido', tipo: 'moneda' },
        { clave: 'descuentos', titulo: 'Descuentos', tipo: 'moneda' },
        { clave: 'anuladas', titulo: 'Anuladas', tipo: 'numero' },
        { clave: 'montoAnulado', titulo: 'Monto anulado', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'ventas', 'total', 'descuentos', 'anuladas', 'montoAnulado'),
    };
  }

  private async utilidad(f: Filtro): Promise<Reporte> {
    const rango = { gte: f.desde, lt: f.hasta };
    const [ventas, mermas, gastos, compras] = await Promise.all([
      this.prisma.venta.aggregate({ where: { estado: 'EMITIDA', fecha: rango }, _sum: { total: true, costoTotal: true, descuento: true } }),
      this.prisma.$queryRaw<{ valor: number }[]>`
        SELECT COALESCE(SUM(-cantidad * "costoUnitario"), 0)::float AS valor FROM "MovimientoStock"
        WHERE tipo = 'MERMA' AND fecha >= ${f.desde} AND fecha < ${f.hasta}`,
      this.prisma.gasto.aggregate({ where: { estado: 'REGISTRADO', fecha: rango }, _sum: { monto: true } }),
      this.prisma.compra.aggregate({ where: { estado: 'REGISTRADA', fechaEmision: rango }, _sum: { total: true } }),
    ]);
    const [retirosCaja, retirosFondo] = await Promise.all([
      this.prisma.movimientoCaja.aggregate({ where: { tipo: 'RETIRO', fecha: rango }, _sum: { monto: true } }),
      this.prisma.movimientoFondo.aggregate({ where: { tipo: 'RETIRO', fecha: rango }, _sum: { monto: true } }),
    ]);
    const retiros = r2(r2(retirosCaja._sum.monto) - r2(retirosFondo._sum.monto));
    const venta = r2(ventas._sum.total);
    const costo = r2(ventas._sum.costoTotal);
    const bruta = r2(venta - costo);
    const merma = r2(mermas[0]?.valor);
    const gasto = r2(gastos._sum.monto);
    const neta = r2(bruta - merma - gasto);
    const filas = [
      { concepto: 'Ventas (después de descuentos)', monto: venta, nota: `Descuentos otorgados: S/ ${r2(ventas._sum.descuento).toFixed(2)}` },
      { concepto: 'Costo de lo vendido', monto: -costo, nota: 'Al último costo de compra de cada producto' },
      { concepto: 'Utilidad bruta', monto: bruta, nota: `Margen ${margen(bruta, venta)}%` },
      { concepto: 'Mermas', monto: -merma, nota: 'Valorizadas al costo' },
      { concepto: 'Gastos', monto: -gasto, nota: 'Del acumulado y de caja. No incluye pagos a proveedores' },
      { concepto: 'Utilidad neta aproximada', monto: neta, nota: `Margen ${margen(neta, venta)}%` },
      { concepto: 'Retiros del dueño y depósitos (referencial)', monto: retiros, nota: 'No se resta: no es gasto del negocio' },
      { concepto: 'Compras del período (referencial)', monto: r2(compras._sum.total), nota: 'No se resta: el costo ya está en lo vendido' },
    ];
    return {
      titulo: 'Utilidad del período',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'concepto', titulo: 'Concepto' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
        { clave: 'nota', titulo: 'Detalle' },
      ],
      filas,
    };
  }

  private async compras(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ ruc: string | null; proveedor: string; compras: number; total: number; saldo: number }[]>`
      SELECT p.ruc, COALESCE(p."nombreComercial", p."razonSocial") AS proveedor,
             COUNT(*)::int AS compras, SUM(c.total)::float AS total, SUM(c.saldo)::float AS saldo
      FROM "Compra" c JOIN "Proveedor" p ON p.id = c."proveedorId"
      WHERE c.estado = 'REGISTRADA' AND c."fechaEmision" >= ${f.desde} AND c."fechaEmision" < ${f.hasta}
      GROUP BY p.id ORDER BY total DESC`;
    const filas = rows.map((r) => ({ ...r, total: r2(r.total), pagado: r2(r.total - r.saldo), saldo: r2(r.saldo) }));
    return {
      titulo: 'Compras por proveedor',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'ruc', titulo: 'RUC' },
        { clave: 'proveedor', titulo: 'Proveedor' },
        { clave: 'compras', titulo: 'N.º compras', tipo: 'numero' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
        { clave: 'pagado', titulo: 'Pagado', tipo: 'moneda' },
        { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'compras', 'total', 'pagado', 'saldo'),
    };
  }

  /** Una fila por factura o documento del proveedor, incluidas las anuladas. */
  private async comprasDetallado(f: Filtro): Promise<Reporte> {
    const compras = await this.prisma.compra.findMany({
      where: { fechaEmision: { gte: f.desde, lt: f.hasta } },
      include: { proveedor: true, usuario: { select: { nombre: true } }, _count: { select: { items: true } } },
      orderBy: [{ fechaEmision: 'asc' }, { id: 'asc' }],
    });
    const filas = compras.map((c) => {
      const anulada = c.estado !== 'REGISTRADA';
      const total = anulada ? 0 : r2(c.total);
      const saldo = anulada ? 0 : r2(c.saldo);
      return {
        fecha: c.fechaEmision.toISOString().slice(0, 10),
        documento: `${TIPO_DOC[c.tipoDocumento] ?? c.tipoDocumento} ${c.serie}-${c.numero}`,
        ruc: c.proveedor.ruc,
        proveedor: c.proveedor.nombreComercial ?? c.proveedor.razonSocial,
        condicion: CONDICION[c.condicion] ?? c.condicion,
        vence: c.fechaVencimiento ? c.fechaVencimiento.toISOString().slice(0, 10) : null,
        items: c._count.items,
        estado: anulada ? 'ANULADA' : saldo > 0 ? 'Pendiente' : 'Pagada',
        registro: c.usuario.nombre,
        total,
        pagado: r2(total - saldo),
        saldo,
      };
    });
    const anuladas = filas.filter((x) => x.estado === 'ANULADA').length;
    return {
      titulo: 'Compras por documento',
      subtitulo: `${f.etiqueta} · por fecha de emisión${anuladas ? ` · ${anuladas} anuladas (no suman)` : ''}`,
      columnas: [
        { clave: 'fecha', titulo: 'Emisión', tipo: 'fecha' },
        { clave: 'documento', titulo: 'Documento' },
        { clave: 'ruc', titulo: 'RUC' },
        { clave: 'proveedor', titulo: 'Proveedor' },
        { clave: 'condicion', titulo: 'Condición' },
        { clave: 'vence', titulo: 'Vence', tipo: 'fecha' },
        { clave: 'items', titulo: 'Ítems', tipo: 'numero' },
        { clave: 'estado', titulo: 'Estado' },
        { clave: 'registro', titulo: 'Registró' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
        { clave: 'pagado', titulo: 'Pagado', tipo: 'moneda' },
        { clave: 'saldo', titulo: 'Saldo', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'total', 'pagado', 'saldo'),
    };
  }

  private async comprasPorProducto(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ codigo: string | null; producto: string; unidades: number; importe: number; compras: number; ultimo: number }[]>`
      SELECT p."codigoBarra" AS codigo, p.nombre AS producto,
             SUM(i.cantidad * i.factor)::float AS unidades, SUM(i.subtotal)::float AS importe,
             COUNT(DISTINCT c.id)::int AS compras, p.costo::float AS ultimo
      FROM "CompraItem" i JOIN "Compra" c ON c.id = i."compraId" JOIN "Producto" p ON p.id = i."productoId"
      WHERE c.estado = 'REGISTRADA' AND c."fechaEmision" >= ${f.desde} AND c."fechaEmision" < ${f.hasta}
      GROUP BY p.id ORDER BY importe DESC`;
    const filas = rows.map((r) => ({
      ...r,
      importe: r2(r.importe),
      promedio: r.unidades ? Math.round((r.importe / r.unidades) * 10000) / 10000 : 0,
    }));
    return {
      titulo: 'Compras por producto',
      subtitulo: `${f.etiqueta} · unidades y costo por unidad (las presentaciones se cuentan en unidades)`,
      columnas: [
        { clave: 'codigo', titulo: 'Código' },
        { clave: 'producto', titulo: 'Producto' },
        { clave: 'compras', titulo: 'N.º compras', tipo: 'numero' },
        { clave: 'unidades', titulo: 'Unidades', tipo: 'numero' },
        { clave: 'importe', titulo: 'Importe', tipo: 'moneda' },
        { clave: 'promedio', titulo: 'Costo prom. unidad', tipo: 'moneda' },
        { clave: 'ultimo', titulo: 'Costo actual', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'unidades', 'importe'),
    };
  }

  private async comprasPorDia(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ dia: Date; compras: number; contado: number; credito: number; total: number }[]>`
      SELECT "fechaEmision" AS dia, COUNT(*)::int AS compras,
             COALESCE(SUM(total) FILTER (WHERE condicion = 'CONTADO'), 0)::float AS contado,
             COALESCE(SUM(total) FILTER (WHERE condicion = 'CREDITO'), 0)::float AS credito,
             SUM(total)::float AS total
      FROM "Compra" WHERE estado = 'REGISTRADA' AND "fechaEmision" >= ${f.desde} AND "fechaEmision" < ${f.hasta}
      GROUP BY dia ORDER BY dia`;
    const filas = rows.map((r) => ({ ...r, dia: r.dia.toISOString().slice(0, 10), contado: r2(r.contado), credito: r2(r.credito), total: r2(r.total) }));
    return {
      titulo: 'Compras por día',
      subtitulo: `${f.etiqueta} · por fecha de emisión`,
      columnas: [
        { clave: 'dia', titulo: 'Día', tipo: 'fecha' },
        { clave: 'compras', titulo: 'N.º compras', tipo: 'numero' },
        { clave: 'contado', titulo: 'Contado', tipo: 'moneda' },
        { clave: 'credito', titulo: 'Crédito', tipo: 'moneda' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'compras', 'contado', 'credito', 'total'),
    };
  }

  private async pagosProveedores(f: Filtro): Promise<Reporte> {
    const pagos = await this.prisma.pagoProveedor.findMany({
      where: { fecha: { gte: f.desde, lt: f.hasta } },
      include: { compra: { include: { proveedor: true } }, usuario: { select: { nombre: true } } },
      orderBy: { fecha: 'asc' },
    });
    const filas = pagos.map((p) => {
      return {
        fecha: p.fecha,
        proveedor: p.compra.proveedor.nombreComercial ?? p.compra.proveedor.razonSocial,
        documento: `${TIPO_DOC[p.compra.tipoDocumento] ?? p.compra.tipoDocumento} ${p.compra.serie}-${p.compra.numero}`,
        medio: MEDIO[p.medioPago] ?? p.medioPago,
        operacion: p.numeroOperacion ?? '',
        usuario: p.usuario.nombre,
        monto: r2(p.monto),
      };
    });
    return {
      titulo: 'Pagos a proveedores',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'proveedor', titulo: 'Proveedor' },
        { clave: 'documento', titulo: 'Documento' },
        { clave: 'medio', titulo: 'Medio de pago' },
        { clave: 'operacion', titulo: 'N.º operación' },
        { clave: 'usuario', titulo: 'Usuario' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'monto'),
    };
  }

  /** Kardex en unidades de un producto: saldo inicial, cada movimiento y saldo final. */
  private async kardex(f: Filtro, productoId: number): Promise<Reporte> {
    const producto = await this.prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) throw new BadRequestException('Producto no encontrado');
    const [anterior, movs] = await Promise.all([
      this.prisma.movimientoStock.findFirst({ where: { productoId, fecha: { lt: f.desde } }, orderBy: { id: 'desc' } }),
      this.prisma.movimientoStock.findMany({
        where: { productoId, fecha: { gte: f.desde, lt: f.hasta } },
        include: { usuario: { select: { nombre: true } }, lote: { select: { codigo: true } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    // Saldo antes del período: el último saldo anterior; si no hay, se deduce del primer movimiento.
    const inicial = anterior
      ? Number(anterior.stockResultante)
      : movs.length
        ? Number(movs[0].stockResultante) - Number(movs[0].cantidad)
        : Number(producto.stock);
    const filas: Record<string, unknown>[] = [
      { fecha: f.desde, tipo: 'SALDO INICIAL', documento: '', detalle: '', usuario: '', entrada: null, salida: null, saldo: inicial, costo: null, valorEntrada: null, valorSalida: null },
    ];
    for (const m of movs) {
      const cant = Number(m.cantidad);
      const costo = Number(m.costoUnitario);
      filas.push({
        fecha: m.fecha,
        tipo: MOVIMIENTO[m.tipo] ?? m.tipo,
        documento: m.referencia ?? '',
        detalle: [m.motivo, m.lote?.codigo ? `Lote ${m.lote.codigo}` : null].filter(Boolean).join(' · '),
        usuario: m.usuario?.nombre ?? '',
        entrada: cant > 0 ? cant : null,
        salida: cant < 0 ? -cant : null,
        saldo: Number(m.stockResultante),
        costo,
        valorEntrada: cant > 0 ? r2(cant * costo) : null,
        valorSalida: cant < 0 ? r2(-cant * costo) : null,
      });
    }
    const final = movs.length ? Number(movs[movs.length - 1].stockResultante) : inicial;
    const tot = suma(filas, 'entrada', 'salida', 'valorEntrada', 'valorSalida');
    return {
      titulo: `Kardex: ${producto.nombre}`,
      subtitulo: `${f.etiqueta}${producto.codigoBarra ? ` · código ${producto.codigoBarra}` : ''} · en unidades · saldo inicial ${inicial} · saldo final ${final} · costo actual S/ ${Number(producto.costo).toFixed(2)}`,
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'tipo', titulo: 'Movimiento' },
        { clave: 'documento', titulo: 'Documento' },
        { clave: 'detalle', titulo: 'Detalle' },
        { clave: 'usuario', titulo: 'Usuario' },
        { clave: 'entrada', titulo: 'Entrada', tipo: 'numero' },
        { clave: 'salida', titulo: 'Salida', tipo: 'numero' },
        { clave: 'saldo', titulo: 'Saldo', tipo: 'numero' },
        { clave: 'costo', titulo: 'Costo unit.', tipo: 'moneda' },
        { clave: 'valorEntrada', titulo: 'Valor entrada', tipo: 'moneda' },
        { clave: 'valorSalida', titulo: 'Valor salida', tipo: 'moneda' },
      ],
      filas,
      totales: { ...tot, saldo: final },
    };
  }

  /** Por producto con movimientos en el período: saldo inicial, entradas y salidas por tipo, saldo final. */
  private async kardexResumen(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<
      { codigo: string | null; producto: string; inicial: number; compras: number; ventas: number; mermas: number; otrasEntradas: number; otrasSalidas: number; final: number; costo: number }[]
    >`
      WITH m AS (
        SELECT * FROM "MovimientoStock" WHERE fecha >= ${f.desde} AND fecha < ${f.hasta}
      ), primero AS (
        SELECT DISTINCT ON ("productoId") "productoId", "stockResultante" - cantidad AS inicial FROM m ORDER BY "productoId", id
      ), ultimo AS (
        SELECT DISTINCT ON ("productoId") "productoId", "stockResultante" AS final FROM m ORDER BY "productoId", id DESC
      ), sumas AS (
        SELECT "productoId",
               COALESCE(SUM(cantidad) FILTER (WHERE tipo IN ('COMPRA', 'ANULACION_COMPRA')), 0) AS compras,
               COALESCE(SUM(-cantidad) FILTER (WHERE tipo IN ('VENTA', 'ANULACION_VENTA')), 0) AS ventas,
               COALESCE(SUM(-cantidad) FILTER (WHERE tipo = 'MERMA'), 0) AS mermas,
               COALESCE(SUM(cantidad) FILTER (WHERE tipo IN ('AJUSTE', 'INVENTARIO', 'IMPORTACION') AND cantidad > 0), 0) AS "otrasEntradas",
               COALESCE(SUM(-cantidad) FILTER (WHERE tipo IN ('AJUSTE', 'INVENTARIO', 'IMPORTACION') AND cantidad < 0), 0) AS "otrasSalidas"
        FROM m GROUP BY "productoId"
      )
      SELECT p."codigoBarra" AS codigo, p.nombre AS producto, pr.inicial::float AS inicial,
             s.compras::float AS compras, s.ventas::float AS ventas, s.mermas::float AS mermas,
             s."otrasEntradas"::float AS "otrasEntradas", s."otrasSalidas"::float AS "otrasSalidas",
             u.final::float AS final, p.costo::float AS costo
      FROM sumas s JOIN primero pr USING ("productoId") JOIN ultimo u USING ("productoId")
      JOIN "Producto" p ON p.id = s."productoId"
      ORDER BY p.nombre`;
    const filas = rows.map((r) => ({ ...r, valor: r2(r.final * r.costo) }));
    return {
      titulo: 'Kardex resumen',
      subtitulo: `${f.etiqueta} · en unidades · solo productos con movimientos en el período · ventas y compras ya restan sus anulaciones · valor al costo actual`,
      columnas: [
        { clave: 'codigo', titulo: 'Código' },
        { clave: 'producto', titulo: 'Producto' },
        { clave: 'inicial', titulo: 'Saldo inicial', tipo: 'numero' },
        { clave: 'compras', titulo: 'Compras', tipo: 'numero' },
        { clave: 'otrasEntradas', titulo: 'Carga y ajustes +', tipo: 'numero' },
        { clave: 'ventas', titulo: 'Ventas', tipo: 'numero' },
        { clave: 'mermas', titulo: 'Mermas', tipo: 'numero' },
        { clave: 'otrasSalidas', titulo: 'Ajustes −', tipo: 'numero' },
        { clave: 'final', titulo: 'Saldo final', tipo: 'numero' },
        { clave: 'costo', titulo: 'Costo actual', tipo: 'moneda' },
        { clave: 'valor', titulo: 'Valor final', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'compras', 'otrasEntradas', 'ventas', 'mermas', 'otrasSalidas', 'valor'),
    };
  }

  /** Todas las boletas emitidas en el período, con su estado en SUNAT y cuándo se enviaron. */
  private async boletasSunat(f: Filtro): Promise<Reporte> {
    const ventas = await this.prisma.venta.findMany({
      where: { tipoComprobante: 'BOLETA', fecha: { gte: f.desde, lt: f.hasta } },
      select: {
        serie: true, numero: true, fecha: true, total: true, estado: true, estadoSunat: true, sunatEnviadoEn: true,
        sunatIntentos: true, cdrCodigo: true, cdrMensaje: true, sunatError: true,
        cliente: { select: { nombre: true } },
        envios: { select: { fecha: true }, orderBy: { id: 'desc' }, take: 1 },
      },
      orderBy: [{ serie: 'asc' }, { numero: 'asc' }],
    });
    const filas = ventas.map((v) => ({
      estado: ESTADO_SUNAT[v.estadoSunat] ?? v.estadoSunat,
      boleta: correlativo(v.serie, v.numero),
      emision: v.fecha,
      cliente: v.cliente?.nombre ?? 'PÚBLICO GENERAL',
      total: r2(v.total),
      // Fecha de la respuesta de SUNAT; si fue rechazada antes del CDR, la del último envío.
      enviado: v.sunatEnviadoEn ?? v.envios[0]?.fecha ?? null,
      intentos: v.sunatIntentos,
      respuesta: v.cdrCodigo != null ? `${v.cdrCodigo}: ${v.cdrMensaje ?? ''}` : (v.sunatError ?? ''),
      anulada: v.estado === 'ANULADA',
    }));
    const validas = filas.filter((x) => !x.anulada);
    const enviadas = filas.filter((x) => x.enviado).length;
    return {
      titulo: 'Boletas electrónicas (SUNAT)',
      subtitulo: `${f.etiqueta} · por fecha de emisión · ${filas.length} boletas, ${enviadas} enviadas, ${filas.length - enviadas} sin enviar · el total no suma las anuladas`,
      agruparPor: 'estado',
      columnas: [
        { clave: 'boleta', titulo: 'Boleta' },
        { clave: 'emision', titulo: 'Emisión', tipo: 'fechaHora' },
        { clave: 'cliente', titulo: 'Cliente' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
        { clave: 'estado', titulo: 'Estado SUNAT' },
        { clave: 'enviado', titulo: 'Enviada a SUNAT', tipo: 'fechaHora' },
        { clave: 'intentos', titulo: 'Intentos', tipo: 'numero' },
        { clave: 'respuesta', titulo: 'Respuesta de SUNAT' },
      ],
      filas: filas.map(({ anulada: _a, ...x }) => x),
      totales: suma(validas, 'total'),
    };
  }

  /** Cada envío de boleta a SUNAT con su fecha y hora y lo que respondió. */
  private async enviosSunat(f: Filtro): Promise<Reporte> {
    const envios = await this.prisma.envioSunat.findMany({
      where: { fecha: { gte: f.desde, lt: f.hasta } },
      include: { venta: { select: { serie: true, numero: true, fecha: true, total: true, cliente: { select: { nombre: true } } } } },
      orderBy: { fecha: 'asc' },
    });
    const filas = envios.map((e) => ({
      enviado: e.fecha,
      boleta: correlativo(e.venta.serie, e.venta.numero),
      emision: e.venta.fecha,
      cliente: e.venta.cliente?.nombre ?? 'PÚBLICO GENERAL',
      total: r2(e.venta.total),
      resultado: RESULTADO[e.resultado],
      respuesta: [e.codigo, e.mensaje].filter(Boolean).join(': '),
    }));
    const aceptadas = envios.filter((e) => e.resultado === 'ACEPTADO' || e.resultado === 'OBSERVADO').length;
    return {
      titulo: 'Historial de envíos a SUNAT',
      subtitulo: `${f.etiqueta} · por fecha de envío · ${envios.length} envíos, ${aceptadas} aceptados, ${envios.length - aceptadas} con problema`,
      columnas: [
        { clave: 'enviado', titulo: 'Fecha y hora de envío', tipo: 'fechaHora' },
        { clave: 'boleta', titulo: 'Boleta' },
        { clave: 'emision', titulo: 'Emisión', tipo: 'fechaHora' },
        { clave: 'cliente', titulo: 'Cliente' },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' },
        { clave: 'resultado', titulo: 'Resultado' },
        { clave: 'respuesta', titulo: 'Respuesta de SUNAT' },
      ],
      filas,
    };
  }

  private async stockValorizado(): Promise<Reporte> {
    const productos = await this.prisma.producto.findMany({
      where: { activo: true, stock: { gt: 0 } },
      include: { categoria: true },
      orderBy: { nombre: 'asc' },
    });
    const filas = productos.map((p) => ({
      codigo: p.codigoBarra,
      producto: p.nombre,
      categoria: p.categoria?.nombre ?? '',
      stock: Number(p.stock),
      costo: Number(p.costo),
      valorCosto: r2(Number(p.stock) * Number(p.costo)),
      precio1: Number(p.precio1),
      valorVenta: r2(Number(p.stock) * Number(p.precio1)),
    }));
    const sinCosto = filas.filter((x) => x.costo <= 0).length;
    return {
      titulo: 'Stock valorizado',
      subtitulo: `Al ${new Date().toLocaleDateString('es-PE')}${sinCosto ? ` · ${sinCosto} productos sin costo registrado (valen 0 al costo)` : ''}`,
      columnas: [
        { clave: 'codigo', titulo: 'Código' },
        { clave: 'producto', titulo: 'Producto' },
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'stock', titulo: 'Stock', tipo: 'numero' },
        { clave: 'costo', titulo: 'Costo', tipo: 'moneda' },
        { clave: 'valorCosto', titulo: 'Valor al costo', tipo: 'moneda' },
        { clave: 'precio1', titulo: 'Precio 1', tipo: 'moneda' },
        { clave: 'valorVenta', titulo: 'Valor a precio 1', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'stock', 'valorCosto', 'valorVenta'),
    };
  }

  // ------------------------------------------------------------ Gastos y acumulado

  private gastosDel(f: Filtro) {
    return this.prisma.gasto.findMany({
      where: { estado: 'REGISTRADO', fecha: { gte: f.desde, lt: f.hasta } },
      include: { categoria: true, usuario: { select: { nombre: true } } },
      orderBy: { fecha: 'asc' },
    });
  }

  private async gastosDetallado(f: Filtro): Promise<Reporte> {
    const gastos = await this.gastosDel(f);
    const filas = gastos.map((g) => ({
      fecha: g.fecha,
      categoria: g.categoria.nombre,
      concepto: g.concepto,
      trabajador: g.trabajador ?? '',
      origen: ORIGEN_GASTO[g.origen],
      medio: MEDIO[g.medioPago] ?? g.medioPago,
      nota: g.nota ?? '',
      usuario: g.usuario.nombre,
      monto: r2(g.monto),
    }));
    return {
      titulo: 'Gastos detallado',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'concepto', titulo: 'Concepto' },
        { clave: 'trabajador', titulo: 'Trabajador' },
        { clave: 'origen', titulo: 'Salió de' },
        { clave: 'medio', titulo: 'Medio' },
        { clave: 'nota', titulo: 'Nota' },
        { clave: 'usuario', titulo: 'Registró' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'monto'),
    };
  }

  private async gastosPorCategoria(f: Filtro): Promise<Reporte> {
    const gastos = await this.gastosDel(f);
    const total = gastos.reduce((s, g) => s + Number(g.monto), 0);
    const mapa = new Map<string, { categoria: string; cantidad: number; acumulado: number; caja: number; monto: number }>();
    for (const g of gastos) {
      const x = mapa.get(g.categoria.nombre) ?? { categoria: g.categoria.nombre, cantidad: 0, acumulado: 0, caja: 0, monto: 0 };
      x.cantidad++;
      x.monto += Number(g.monto);
      if (g.origen === 'CAJA') x.caja += Number(g.monto);
      else x.acumulado += Number(g.monto);
      mapa.set(g.categoria.nombre, x);
    }
    const filas = [...mapa.values()]
      .sort((a, b) => b.monto - a.monto)
      .map((x) => ({ ...x, acumulado: r2(x.acumulado), caja: r2(x.caja), monto: r2(x.monto), porcentaje: total ? Math.round((x.monto / total) * 1000) / 10 : 0 }));
    return {
      titulo: 'Gastos por categoría',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'cantidad', titulo: 'Gastos', tipo: 'numero' },
        { clave: 'acumulado', titulo: 'Del acumulado', tipo: 'moneda' },
        { clave: 'caja', titulo: 'De caja', tipo: 'moneda' },
        { clave: 'monto', titulo: 'Total', tipo: 'moneda' },
        { clave: 'porcentaje', titulo: '% del total', tipo: 'porcentaje' },
      ],
      filas,
      totales: suma(filas, 'cantidad', 'acumulado', 'caja', 'monto'),
    };
  }

  private async gastosPorMes(f: Filtro): Promise<Reporte> {
    const rows = await this.prisma.$queryRaw<{ mes: string; categoria: string; monto: number; cantidad: number }[]>`
      SELECT to_char(g.fecha AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA}, 'YYYY-MM') AS mes, c.nombre AS categoria,
             SUM(g.monto)::float AS monto, COUNT(*)::int AS cantidad
      FROM "Gasto" g JOIN "CategoriaGasto" c ON c.id = g."categoriaId"
      WHERE g.estado = 'REGISTRADO' AND g.fecha >= ${f.desde} AND g.fecha < ${f.hasta}
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`;
    const filas = rows.map((r) => ({ mes: r.mes, categoria: r.categoria, cantidad: r.cantidad, monto: r2(r.monto) }));
    return {
      titulo: 'Gastos por mes',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'mes', titulo: 'Mes' },
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'cantidad', titulo: 'Gastos', tipo: 'numero' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'cantidad', 'monto'),
      agruparPor: 'mes',
    };
  }

  private async sueldosPorTrabajador(f: Filtro): Promise<Reporte> {
    const gastos = (await this.gastosDel(f)).filter((g) => g.categoria.pideTrabajador || g.trabajador);
    const filas = gastos
      .map((g) => ({
        trabajador: g.trabajador ?? '(sin nombre)',
        fecha: g.fecha,
        categoria: g.categoria.nombre,
        concepto: g.concepto,
        medio: MEDIO[g.medioPago] ?? g.medioPago,
        monto: r2(g.monto),
      }))
      .sort((a, b) => a.trabajador.localeCompare(b.trabajador) || +a.fecha - +b.fecha);
    return {
      titulo: 'Sueldos y adelantos por trabajador',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'trabajador', titulo: 'Trabajador' },
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'concepto', titulo: 'Concepto' },
        { clave: 'medio', titulo: 'Medio' },
        { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas, 'monto'),
      agruparPor: 'trabajador',
    };
  }

  /** Cada movimiento del acumulado con el saldo de efectivo y Yape después de él. */
  private async movimientosAcumulado(f: Filtro): Promise<Reporte> {
    const [antes, movs] = await Promise.all([
      this.prisma.movimientoFondo.groupBy({ by: ['cuenta'], where: { fecha: { lt: f.desde } }, _sum: { monto: true } }),
      this.prisma.movimientoFondo.findMany({
        where: { fecha: { gte: f.desde, lt: f.hasta } },
        include: { usuario: { select: { nombre: true } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    let ef = r2(antes.find((a) => a.cuenta === 'EFECTIVO')?._sum.monto);
    let ya = r2(antes.find((a) => a.cuenta === 'YAPE')?._sum.monto);
    const filas: Record<string, unknown>[] = [{ fecha: f.desde, tipo: 'Saldo inicial', concepto: '', usuario: '', saldoEfectivo: ef, saldoYape: ya }];
    for (const m of movs) {
      const v = r2(m.monto);
      if (m.cuenta === 'EFECTIVO') ef = r2(ef + v);
      else ya = r2(ya + v);
      filas.push({
        fecha: m.fecha,
        tipo: TIPO_FONDO[m.tipo] ?? m.tipo,
        concepto: m.concepto,
        usuario: m.usuario.nombre,
        efectivo: m.cuenta === 'EFECTIVO' ? v : null,
        yape: m.cuenta === 'YAPE' ? v : null,
        saldoEfectivo: ef,
        saldoYape: ya,
      });
    }
    return {
      titulo: 'Movimientos del acumulado',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'tipo', titulo: 'Tipo' },
        { clave: 'concepto', titulo: 'Concepto' },
        { clave: 'usuario', titulo: 'Usuario' },
        { clave: 'efectivo', titulo: 'Efectivo', tipo: 'moneda' },
        { clave: 'yape', titulo: 'Yape', tipo: 'moneda' },
        { clave: 'saldoEfectivo', titulo: 'Saldo efectivo', tipo: 'moneda' },
        { clave: 'saldoYape', titulo: 'Saldo Yape', tipo: 'moneda' },
      ],
      filas,
      totales: suma(filas.slice(1), 'efectivo', 'yape'),
    };
  }

  private async conteosAcumulado(f: Filtro): Promise<Reporte> {
    const conteos = await this.prisma.conteoFondo.findMany({
      where: { fecha: { gte: f.desde, lt: f.hasta } },
      include: { usuario: { select: { nombre: true } } },
      orderBy: { id: 'asc' },
    });
    const filas = conteos.map((c) => ({
      fecha: c.fecha,
      usuario: c.usuario.nombre,
      efectivoEsperado: r2(c.efectivoEsperado),
      efectivoContado: r2(c.efectivoContado),
      diferenciaEfectivo: r2(c.diferenciaEfectivo),
      yapeEsperado: r2(c.yapeEsperado),
      yapeContado: r2(c.yapeContado),
      diferenciaYape: r2(c.diferenciaYape),
      observacion: c.observacion ?? '',
    }));
    return {
      titulo: 'Conteos del acumulado',
      subtitulo: f.etiqueta,
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fechaHora' },
        { clave: 'usuario', titulo: 'Contó' },
        { clave: 'efectivoEsperado', titulo: 'Efectivo según sistema', tipo: 'moneda' },
        { clave: 'efectivoContado', titulo: 'Efectivo contado', tipo: 'moneda' },
        { clave: 'diferenciaEfectivo', titulo: 'Diferencia efectivo', tipo: 'moneda' },
        { clave: 'yapeEsperado', titulo: 'Yape según sistema', tipo: 'moneda' },
        { clave: 'yapeContado', titulo: 'Yape en la app', tipo: 'moneda' },
        { clave: 'diferenciaYape', titulo: 'Diferencia Yape', tipo: 'moneda' },
        { clave: 'observacion', titulo: 'Observación' },
      ],
      filas,
      totales: suma(filas, 'diferenciaEfectivo', 'diferenciaYape'),
    };
  }
}

