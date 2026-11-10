import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CondicionPago, EstadoCompra, MedioPago, OrigenGasto, Prisma, TipoMovimiento, TipoMovimientoFondo } from '@prisma/client';
import { precioSugerido } from '../common/precios';
import { CajaService } from '../caja/caja.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { cuentaDe, FondoService } from '../fondo/fondo.service';
import { StockService } from '../inventario/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnularDto, CrearCompraDto, PagoDto } from './compras.dto';

export interface FiltroCompras {
  desde?: string;
  hasta?: string;
  proveedorId?: number;
  pendientes?: boolean;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;
const redondear4 = (n: number) => Math.round(n * 10000) / 10000;

@Injectable()
export class ComprasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly config: ConfiguracionService,
    private readonly caja: CajaService,
    private readonly fondo: FondoService,
  ) {}

  listar(f: FiltroCompras) {
    const where: Prisma.CompraWhereInput = {};
    if (f.desde || f.hasta) {
      where.fechaEmision = {
        ...(f.desde ? { gte: new Date(f.desde) } : {}),
        ...(f.hasta ? { lte: new Date(f.hasta) } : {}),
      };
    }
    if (f.proveedorId) where.proveedorId = f.proveedorId;
    if (f.pendientes) Object.assign(where, { estado: EstadoCompra.REGISTRADA, saldo: { gt: 0 } });
    return this.prisma.compra.findMany({
      where,
      include: { proveedor: { select: { id: true, razonSocial: true, ruc: true } }, _count: { select: { items: true } } },
      orderBy: f.pendientes ? [{ fechaVencimiento: 'asc' }, { fechaEmision: 'asc' }] : [{ fechaEmision: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  async obtener(id: number) {
    const c = await this.prisma.compra.findUnique({
      where: { id },
      include: {
        proveedor: true,
        usuario: { select: { nombre: true } },
        items: {
          include: {
            producto: { select: { id: true, nombre: true, codigoBarra: true, unidad: true } },
            presentacion: { select: { id: true, nombre: true, factor: true } },
          },
        },
        pagos: {
          include: { usuario: { select: { nombre: true } }, movimientoCaja: { select: { id: true } }, movimientoFondo: { select: { cuenta: true } } },
          orderBy: { fecha: 'asc' },
        },
      },
    });
    if (!c) throw new NotFoundException('Compra no encontrada');
    return c;
  }

  async crear(dto: CrearCompraDto, usuarioId: number) {
    if (dto.condicion === CondicionPago.CREDITO && !dto.fechaVencimiento) {
      throw new BadRequestException('Indica la fecha de vencimiento del crédito');
    }
    const serie = dto.serie.trim().toUpperCase();
    const numero = dto.numero.trim();
    const repetida = await this.prisma.compra.findUnique({
      where: {
        proveedorId_tipoDocumento_serie_numero: {
          proveedorId: dto.proveedorId,
          tipoDocumento: dto.tipoDocumento,
          serie,
          numero,
        },
      },
    });
    if (repetida) throw new BadRequestException(`Ese documento ya fue registrado (compra #${repetida.id})`);

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: dto.items.map((i) => i.productoId) } },
      include: { presentaciones: { where: { activo: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    // Presentación de cada línea: factor 1 si se compró por unidad.
    const formas = dto.items.map((i) => {
      const p = porId.get(i.productoId);
      if (!p) throw new BadRequestException(`Producto ${i.productoId} no existe`);
      if (p.controlaVencimiento && !i.fechaVencimiento) {
        throw new BadRequestException(`Falta la fecha de vencimiento de ${p.nombre}`);
      }
      if (!i.presentacionId) return { factor: 1, nombre: null };
      const pres = p.presentaciones.find((x) => x.id === i.presentacionId);
      if (!pres) throw new BadRequestException(`La presentación ya no está disponible en ${p.nombre}`);
      return { factor: Number(pres.factor), nombre: pres.nombre };
    });

    const total = redondear2(dto.items.reduce((s, i) => s + i.cantidad * i.costoUnitario, 0));
    const contado = dto.condicion === CondicionPago.CONTADO;
    const referencia = `${dto.tipoDocumento} ${serie}-${numero}`;

    const compra = await this.prisma.$transaction(async (tx) => {
      const compra = await tx.compra.create({
        data: {
          proveedorId: dto.proveedorId,
          usuarioId,
          tipoDocumento: dto.tipoDocumento,
          serie,
          numero,
          fechaEmision: new Date(dto.fechaEmision),
          condicion: dto.condicion,
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          total,
          saldo: contado ? 0 : total,
          observacion: dto.observacion,
        },
      });

      for (const [k, i] of dto.items.entries()) {
        const { factor, nombre } = formas[k];
        const costoUnidad = redondear4(i.costoUnitario / factor);
        const item = await tx.compraItem.create({
          data: {
            compraId: compra.id,
            productoId: i.productoId,
            presentacionId: i.presentacionId,
            factor,
            cantidad: i.cantidad,
            costoUnitario: i.costoUnitario,
            subtotal: redondear2(i.cantidad * i.costoUnitario),
            codigoLote: i.codigoLote,
            fechaVencimiento: i.fechaVencimiento ? new Date(i.fechaVencimiento) : null,
          },
        });
        // El lote nace en cero; StockService le suma la cantidad.
        const lote = i.fechaVencimiento
          ? await tx.lote.create({
              data: {
                productoId: i.productoId,
                codigo: i.codigoLote,
                fechaVencimiento: new Date(i.fechaVencimiento),
                cantidad: 0,
                compraItemId: item.id,
              },
            })
          : null;
        await this.stock.mover(tx, {
          productoId: i.productoId,
          tipo: TipoMovimiento.COMPRA,
          cantidad: i.cantidad * factor,
          costoUnitario: costoUnidad,
          usuarioId,
          loteId: lote?.id,
          referencia,
          motivo: nombre ? `${i.cantidad} ${nombre} (x${factor}) a S/ ${i.costoUnitario}` : undefined,
        });
        // Se guarda el último costo de compra, siempre por unidad. Si la línea trae
        // vencimiento, el producto pasa a controlarlo ("Añadir venc." en la compra).
        await tx.producto.update({
          where: { id: i.productoId },
          data: { costo: costoUnidad, ...(i.fechaVencimiento ? { controlaVencimiento: true } : {}) },
        });
      }

      if (contado && total > 0) {
        const medioPago = dto.medioPago ?? MedioPago.EFECTIVO;
        const pago = await tx.pagoProveedor.create({ data: { compraId: compra.id, usuarioId, monto: total, medioPago } });
        await this.salidaPago(tx, pago.id, compra.id, dto.origenPago ?? OrigenGasto.ACUMULADO, medioPago, total, usuarioId);
      }
      return compra;
    });

    return { compra: await this.obtener(compra.id), sugerencias: await this.sugerencias(compra.id, productos) };
  }

  /**
   * Precios sugeridos para los productos de una compra, según su margen
   * (o el de la configuración). Solo lista los que cambiarían. Si el producto
   * tiene presentaciones, también sugiere el precio de cada una (costo × factor).
   */
  async sugerencias(compraId: number, antes?: { id: number; costo: Prisma.Decimal }[]) {
    const cfg = await this.config.obtener();
    const items = await this.prisma.compraItem.findMany({
      where: { compraId },
      include: { producto: { include: { presentaciones: { where: { activo: true }, orderBy: { factor: 'asc' } } } } },
    });
    const costoAnterior = new Map(antes?.map((p) => [p.id, Number(p.costo)]));
    const vistos = new Set<number>();
    const res = [];
    for (const { producto: p, costoUnitario, factor } of items) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      const margenes = [p.margen1 ?? cfg.margen1, p.margen2 ?? cfg.margen2, p.margen3 ?? cfg.margen3].map(Number);
      const costoUnidad = redondear4(Number(costoUnitario) / Number(factor));
      const anterior = costoAnterior.get(p.id) ?? null;
      const formas = [
        { presentacionId: null as number | null, nombre: p.nombre, factor: 1, precios: p },
        ...p.presentaciones.map((x) => ({ presentacionId: x.id, nombre: `${p.nombre} - ${x.nombre}`, factor: Number(x.factor), precios: x })),
      ];
      for (const f of formas) {
        const costo = redondear4(costoUnidad * f.factor);
        const actuales = [f.precios.precio1, f.precios.precio2, f.precios.precio3].map(Number);
        const sugeridos = margenes.map((m) => precioSugerido(costo, m, cfg.redondeoPrecio));
        if (sugeridos.every((s, k) => s === actuales[k])) continue;
        res.push({
          productoId: p.id,
          presentacionId: f.presentacionId,
          nombre: f.nombre,
          costoAnterior: anterior != null ? redondear4(anterior * f.factor) : null,
          costoNuevo: costo,
          margenes,
          actuales,
          sugeridos,
        });
      }
    }
    return res;
  }

  async pagar(id: number, dto: PagoDto, usuarioId: number) {
    const { desdeCaja, origen: o, ...pago } = dto;
    const origen = o ?? (desdeCaja ? OrigenGasto.CAJA : OrigenGasto.ACUMULADO);
    return this.prisma.$transaction(async (tx) => {
      const [c] = await tx.$queryRaw<{ saldo: Prisma.Decimal; estado: EstadoCompra }[]>`
        SELECT saldo, estado FROM "Compra" WHERE id = ${id} FOR UPDATE`;
      if (!c) throw new NotFoundException('Compra no encontrada');
      if (c.estado === EstadoCompra.ANULADA) throw new BadRequestException('La compra está anulada');
      if (new Prisma.Decimal(dto.monto).greaterThan(c.saldo)) {
        throw new BadRequestException(`El pago supera el saldo pendiente (S/ ${Number(c.saldo).toFixed(2)})`);
      }
      const registrado = await tx.pagoProveedor.create({ data: { compraId: id, usuarioId, ...pago } });
      await this.salidaPago(tx, registrado.id, id, origen, dto.medioPago, dto.monto, usuarioId);
      return tx.compra.update({ where: { id }, data: { saldo: { decrement: dto.monto } } });
    });
  }

  /**
   * Saca el dinero de un pago al proveedor: del acumulado (efectivo o Yape según
   * el medio) o, si falta ahí, de la caja del día (solo efectivo).
   */
  private async salidaPago(tx: Prisma.TransactionClient, pagoId: number, compraId: number, origen: OrigenGasto, medioPago: MedioPago, monto: number, usuarioId: number) {
    const compra = await tx.compra.findUniqueOrThrow({ where: { id: compraId }, include: { proveedor: true } });
    const concepto = `Pago a ${compra.proveedor.nombreComercial || compra.proveedor.razonSocial} ${compra.serie}-${compra.numero}`;
    if (origen === OrigenGasto.CAJA) {
      if (medioPago !== MedioPago.EFECTIVO) throw new BadRequestException('De la caja del día solo se paga en efectivo');
      const caja = await this.caja.exigirAbierta(tx);
      const { efectivoEsperado } = await this.caja.resumen(caja.id, tx);
      if (monto > efectivoEsperado + 0.005) {
        throw new BadRequestException(`No hay suficiente efectivo en la caja del día (S/ ${efectivoEsperado.toFixed(2)})`);
      }
      await tx.movimientoCaja.create({
        data: { cajaId: caja.id, usuarioId, tipo: 'EGRESO', concepto, monto, pagoProveedorId: pagoId },
      });
      return;
    }
    await this.fondo.registrar(tx, {
      usuarioId,
      tipo: TipoMovimientoFondo.PAGO_PROVEEDOR,
      cuenta: cuentaDe(medioPago),
      monto: -monto,
      concepto,
      pagoProveedorId: pagoId,
    });
  }

  async anular(id: number, dto: AnularDto, usuarioId: number) {
    const compra = await this.obtener(id);
    if (compra.estado === EstadoCompra.ANULADA) throw new BadRequestException('La compra ya está anulada');
    const referencia = `Anula ${compra.tipoDocumento} ${compra.serie}-${compra.numero}`;
    await this.prisma.$transaction(async (tx) => {
      for (const i of compra.items) {
        // Si parte del lote ya salió (merma), se descuenta del lote lo que queda
        // y el resto solo del stock general.
        const lote = await tx.lote.findUnique({ where: { compraItemId: i.id } });
        // Las presentaciones entraron como cantidad × factor unidades.
        const total = Number(i.cantidad) * Number(i.factor);
        const delLote = lote ? Math.min(total, Number(lote.cantidad)) : 0;
        const partes = [
          { cantidad: delLote, loteId: lote?.id },
          { cantidad: total - delLote, loteId: undefined },
        ].filter((p) => p.cantidad > 0);
        for (const parte of partes) {
          await this.stock.mover(tx, {
            productoId: i.productoId,
            tipo: TipoMovimiento.ANULACION_COMPRA,
            cantidad: -parte.cantidad,
            costoUnitario: redondear4(Number(i.costoUnitario) / Number(i.factor)),
            usuarioId,
            loteId: parte.loteId,
            referencia,
            motivo: dto.motivo,
          });
        }
      }
      await tx.compra.update({
        where: { id },
        data: {
          estado: EstadoCompra.ANULADA,
          saldo: 0,
          observacion: [compra.observacion, `ANULADA: ${dto.motivo}`].filter(Boolean).join(' | '),
        },
      });
    });
    return this.obtener(id);
  }
}
