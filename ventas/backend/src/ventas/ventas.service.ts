import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCaja, EstadoSunat, EstadoVenta, MedioPago, Prisma, TipoComprobante, TipoMovimiento } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { UsuarioSesion } from '../auth/decorators';
import { PermisosService } from '../auth/permisos.service';
import { CajaService } from '../caja/caja.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { StockService } from '../inventario/stock.service';
import { SunatService } from '../sunat/sunat.service';
import { PrismaService } from '../prisma/prisma.service';
import { calcularPagos, calcularTotales, r2 } from './calculos';
import { AnularVentaDto, CrearVentaDto, EditarVentaDto } from './ventas.dto';

export interface FiltroVentas {
  desde?: string;
  hasta?: string;
  cajaId?: number;
  tipo?: TipoComprobante;
  estado?: EstadoVenta;
}

const detalle = {
  cliente: true,
  usuario: { select: { nombre: true } },
  autorizadoPor: { select: { nombre: true } },
  anuladaPor: { select: { nombre: true } },
  items: { include: { producto: { select: { codigoBarra: true, unidad: true } } } },
  pagos: true,
  caja: { select: { estado: true } },
  ediciones: { include: { usuario: { select: { nombre: true } } }, orderBy: { id: 'asc' } },
  envios: { orderBy: { id: 'asc' } },
} satisfies Prisma.VentaInclude;

const MEDIO: Record<MedioPago, string> = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', YAPE: 'Yape', PLIN: 'Plin', TRANSFERENCIA: 'Transferencia' };
const correlativo = (v: { serie: string; numero: number }) => `${v.serie}-${String(v.numero).padStart(8, '0')}`;
const textoPagos = (pagos: { medioPago: MedioPago; monto: Prisma.Decimal | number }[]) =>
  pagos.map((p) => `${MEDIO[p.medioPago]} S/ ${Number(p.monto).toFixed(2)}`).join(' + ') || 'sin pago';

/** Estados en los que la boleta todavía no llegó a SUNAT. */
const SIN_ENVIAR: EstadoSunat[] = [EstadoSunat.NO_APLICA, EstadoSunat.PENDIENTE];

@Injectable()
export class VentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly caja: CajaService,
    private readonly config: ConfiguracionService,
    private readonly auth: AuthService,
    private readonly permisos: PermisosService,
    private readonly sunat: SunatService,
  ) {}

  async crear(dto: CrearVentaDto, user: UsuarioSesion) {
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: dto.items.map((i) => i.productoId) } },
      include: { presentaciones: { where: { activo: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    const lineas = dto.items.map((i) => {
      const p = porId.get(i.productoId);
      if (!p || !p.activo) throw new BadRequestException(`Producto ${i.productoId} no disponible`);
      const pres = i.presentacionId ? p.presentaciones.find((x) => x.id === i.presentacionId) : null;
      if (i.presentacionId && !pres) throw new BadRequestException(`La presentación ya no está disponible en ${p.nombre}`);
      // Una presentación tiene sus propios precios; el stock y el costo se llevan en unidades.
      const factor = pres ? Number(pres.factor) : 1;
      const lista = Number((pres ?? p)[`precio${dto.nivelPrecio as 1 | 2 | 3}`]);
      const precio = i.precioUnitario ?? lista;
      return {
        producto: p,
        presentacion: pres,
        factor,
        descripcion: pres ? `${p.nombre} - ${pres.nombre}` : p.nombre,
        cantidad: i.cantidad,
        unidades: i.cantidad * factor,
        costoUnitario: Number(p.costo) * factor,
        precioUnitario: r2(precio),
        lista,
        descuento: r2(i.descuento ?? 0),
        afectacionIgv: p.afectacionIgv,
      };
    });

    // Descuentos y precios distintos al de lista los autoriza un administrador.
    const requiereAutorizacion = (dto.descuento ?? 0) > 0 || lineas.some((l) => l.descuento > 0 || l.precioUnitario < l.lista);
    if (requiereAutorizacion && !(await this.permisos.tiene(user, 'ventas.descuento'))) {
      throw new ForbiddenException('No tienes permiso para dar descuentos ni cambiar precios');
    }
    const autorizadoPorId = requiereAutorizacion ? await this.auth.autorizarAdmin(user, dto.autorizacion) : null;

    let totales: ReturnType<typeof calcularTotales>;
    let pagos: ReturnType<typeof calcularPagos>;
    try {
      totales = calcularTotales(lineas, r2(dto.descuento ?? 0));
      if (totales.total <= 0) throw new Error('El total debe ser mayor a cero');
      pagos = calcularPagos(totales.total, dto.pagos);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    if (dto.tipoComprobante === TipoComprobante.BOLETA && totales.total >= 700) {
      const cliente = dto.clienteId ? await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } }) : null;
      if (!cliente?.numeroDoc) throw new BadRequestException('Una boleta de S/ 700 o más necesita el DNI o RUC del cliente');
    }

    const cfg = await this.config.obtener();
    const electronica = dto.tipoComprobante === TipoComprobante.BOLETA && cfg.sunatModo !== 'DESACTIVADO';
    const id = await this.prisma.$transaction(async (tx) => {
      const caja = await this.caja.exigirAbierta(tx);

      const serie = await this.siguienteNumero(tx, dto.tipoComprobante);

      const costoTotal = r2(lineas.reduce((s, l) => s + l.cantidad * l.costoUnitario, 0));
      const venta = await tx.venta.create({
        data: {
          cajaId: caja.id,
          usuarioId: user.id,
          serieId: serie.id,
          tipoComprobante: dto.tipoComprobante,
          serie: serie.serie,
          numero: serie.ultimoNumero,
          clienteId: dto.clienteId,
          nivelPrecio: dto.nivelPrecio,
          subtotal: totales.subtotal,
          descuento: r2(dto.descuento ?? 0),
          total: totales.total,
          opExonerada: totales.opExonerada,
          opGravada: totales.opGravada,
          opInafecta: totales.opInafecta,
          igv: totales.igv,
          costoTotal,
          efectivoRecibido: pagos.efectivoRecibido || null,
          vuelto: pagos.vuelto,
          autorizadoPorId,
          estadoSunat: electronica ? 'PENDIENTE' : 'NO_APLICA',
          items: {
            create: lineas.map((l, i) => ({
              productoId: l.producto.id,
              presentacionId: l.presentacion?.id,
              factor: l.factor,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              descuento: l.descuento,
              subtotal: totales.subtotales[i],
              costoUnitario: l.costoUnitario,
              afectacionIgv: l.afectacionIgv,
            })),
          },
          pagos: {
            create: [
              ...(pagos.efectivoAplicado > 0 ? [{ medioPago: MedioPago.EFECTIVO, monto: pagos.efectivoAplicado }] : []),
              ...dto.pagos
                .filter((p) => p.medioPago !== MedioPago.EFECTIVO)
                .map((p) => ({ medioPago: p.medioPago, monto: p.monto, numeroOperacion: p.numeroOperacion?.trim() || null })),
            ],
          },
        },
      });

      const referencia = correlativo({ serie: serie.serie, numero: serie.ultimoNumero });
      for (const l of lineas) {
        await this.descontar(tx, l.producto, l.unidades, {
          ventaId: venta.id,
          usuarioId: user.id,
          referencia,
          motivo: l.presentacion ? `${l.cantidad} ${l.presentacion.nombre} (x${l.factor})` : undefined,
          permitirNegativo: cfg.permitirVentaSinStock,
        });
      }
      return venta.id;
    });
    if (electronica) {
      // Se firma al momento para imprimir el hash y el QR; el envío no hace esperar al cajero.
      await this.sunat.firmarVenta(id).catch((e) => console.warn(`Firma pendiente de venta ${id}: ${(e as Error).message}`));
      void this.sunat.enviarVenta(id).catch(() => undefined);
    }
    return this.obtener(id);
  }

  /** Correlativo atómico: dos ventas a la vez nunca toman el mismo número. */
  private async siguienteNumero(tx: Prisma.TransactionClient, tipo: TipoComprobante) {
    const [serie] = await tx.$queryRaw<{ id: number; serie: string; ultimoNumero: number }[]>`
      UPDATE "Serie" SET "ultimoNumero" = "ultimoNumero" + 1
      WHERE id = (SELECT id FROM "Serie" WHERE tipo = ${tipo}::"TipoComprobante" AND activa ORDER BY id LIMIT 1)
      RETURNING id, serie, "ultimoNumero"`;
    if (!serie) throw new BadRequestException('No hay una serie activa para este comprobante');
    return serie;
  }

  /**
   * Corrige una venta que aún no llegó a SUNAT: tipo de comprobante, cliente y pago.
   *
   * Numeración: al cambiar de comprobante la venta toma el siguiente número de la serie destino.
   * El número que deja se devuelve a su serie solo si era el último (la próxima venta lo reutiliza),
   * así B001 nunca queda con huecos: una boleta que no es la última no puede pasar a boleta libre
   * (se anula, para que vaya a SUNAT como anulada). En la boleta libre, que es interna, sí puede quedar un hueco.
   */
  async editar(id: number, dto: EditarVentaDto, user: UsuarioSesion) {
    const editadaPorId = await this.auth.autorizarAdmin(user, dto.autorizacion);
    const cfg = await this.config.obtener();
    const { refirmar } = await this.sunat.sinEnvios(() =>
      this.prisma.$transaction(async (tx) => {
        // Bloquea la venta: dos correcciones a la vez no se pisan.
        await tx.$queryRaw`SELECT id FROM "Venta" WHERE id = ${id} FOR UPDATE`;
        const v = await tx.venta.findUnique({ where: { id }, include: { caja: true, cliente: true, pagos: true } });
        if (!v) throw new NotFoundException('Venta no encontrada');
        if (v.estado !== EstadoVenta.EMITIDA) throw new BadRequestException('La venta está anulada');
        if (v.caja.estado !== EstadoCaja.ABIERTA) {
          throw new BadRequestException('Solo se corrigen ventas de la caja abierta; esta caja ya se cerró');
        }
        if (!SIN_ENVIAR.includes(v.estadoSunat) || v.sunatEnviadoEn) {
          throw new BadRequestException('Esta boleta ya se envió a SUNAT y no se puede corregir. Anúlala y emite una nueva.');
        }

        const cambios: string[] = [];
        const data: Prisma.VentaUncheckedUpdateInput = {};
        const tipo = dto.tipoComprobante ?? v.tipoComprobante;
        const clienteId = dto.clienteId === undefined ? v.clienteId : dto.clienteId;
        let numero = { serieId: v.serieId, serie: v.serie, numero: v.numero };

        if (tipo !== v.tipoComprobante) {
          const devuelto = await tx.$executeRaw`
            UPDATE "Serie" SET "ultimoNumero" = "ultimoNumero" - 1 WHERE id = ${v.serieId} AND "ultimoNumero" = ${v.numero}`;
          if (!devuelto && v.tipoComprobante === TipoComprobante.BOLETA) {
            const ultima = await tx.serie.findUniqueOrThrow({ where: { id: v.serieId } });
            throw new BadRequestException(
              `Solo la última boleta (${correlativo({ serie: v.serie, numero: ultima.ultimoNumero })}) puede pasar a boleta libre; ` +
                `si no, ${v.serie} quedaría con un número saltado ante SUNAT. Anula esta venta y vuelve a emitirla.`,
            );
          }
          const s = await this.siguienteNumero(tx, tipo);
          numero = { serieId: s.id, serie: s.serie, numero: s.ultimoNumero };
          const electronica = tipo === TipoComprobante.BOLETA && cfg.sunatModo !== 'DESACTIVADO';
          Object.assign(data, numero, {
            tipoComprobante: tipo,
            estadoSunat: electronica ? EstadoSunat.PENDIENTE : EstadoSunat.NO_APLICA,
            sunatIntentos: 0,
            sunatError: null,
          });
          cambios.push(`Comprobante: ${correlativo(v)} → ${correlativo(numero)}`);
          await tx.movimientoStock.updateMany({
            where: { ventaId: id, tipo: TipoMovimiento.VENTA },
            data: { referencia: correlativo(numero) },
          });
        }

        if (clienteId !== v.clienteId) {
          const cliente = clienteId ? await tx.cliente.findUnique({ where: { id: clienteId } }) : null;
          if (clienteId && !cliente) throw new BadRequestException('Cliente no encontrado');
          data.clienteId = clienteId;
          cambios.push(`Cliente: ${v.cliente?.nombre ?? 'Público general'} → ${cliente?.nombre ?? 'Público general'}`);
        }

        if (tipo === TipoComprobante.BOLETA && Number(v.total) >= 700) {
          const cliente = clienteId ? await tx.cliente.findUnique({ where: { id: clienteId } }) : null;
          if (!cliente?.numeroDoc) throw new BadRequestException('Una boleta de S/ 700 o más necesita el DNI o RUC del cliente');
        }

        if (dto.pagos) {
          let pagos: ReturnType<typeof calcularPagos>;
          try {
            pagos = calcularPagos(Number(v.total), dto.pagos);
          } catch (e) {
            throw new BadRequestException((e as Error).message);
          }
          const nuevos = [
            ...(pagos.efectivoAplicado > 0 ? [{ medioPago: MedioPago.EFECTIVO, monto: pagos.efectivoAplicado, numeroOperacion: null }] : []),
            ...dto.pagos
              .filter((p) => p.medioPago !== MedioPago.EFECTIVO)
              .map((p) => ({ medioPago: p.medioPago, monto: r2(p.monto), numeroOperacion: p.numeroOperacion?.trim() || null })),
          ];
          const igual = (a: { medioPago: MedioPago; monto: number | Prisma.Decimal; numeroOperacion: string | null }[]) =>
            a.map((p) => `${p.medioPago}:${Number(p.monto).toFixed(2)}:${p.numeroOperacion ?? ''}`).sort().join('|');
          if (igual(nuevos) !== igual(v.pagos) || Number(v.vuelto) !== pagos.vuelto) {
            // El balance de caja se calcula de estos pagos, así que se corrige solo.
            await tx.ventaPago.deleteMany({ where: { ventaId: id } });
            await tx.ventaPago.createMany({ data: nuevos.map((p) => ({ ...p, ventaId: id })) });
            data.efectivoRecibido = pagos.efectivoRecibido || null;
            data.vuelto = pagos.vuelto;
            if (igual(nuevos) !== igual(v.pagos)) cambios.push(`Pago: ${textoPagos(v.pagos)} → ${textoPagos(nuevos)}`);
            else cambios.push(`Efectivo recibido: S/ ${Number(v.efectivoRecibido ?? 0).toFixed(2)} → S/ ${pagos.efectivoRecibido.toFixed(2)}`);
          }
        }

        if (!cambios.length) throw new BadRequestException('No hay cambios que guardar');

        // Una boleta electrónica corregida se vuelve a firmar con los datos nuevos (hash y QR nuevos).
        const refirmar = tipo === TipoComprobante.BOLETA && (data.tipoComprobante !== undefined || data.clienteId !== undefined);
        if (refirmar || data.tipoComprobante !== undefined) Object.assign(data, { xmlFirmado: null, hashCpe: null });
        await tx.venta.update({ where: { id }, data });
        await tx.ventaEdicion.create({ data: { ventaId: id, usuarioId: editadaPorId, detalle: cambios.join('. ') } });
        const final = await tx.venta.findUniqueOrThrow({ where: { id } });
        return { refirmar: refirmar && final.estadoSunat === EstadoSunat.PENDIENTE };
      }),
    );
    if (refirmar) {
      await this.sunat.firmarVenta(id).catch((e) => console.warn(`Firma pendiente de venta ${id}: ${(e as Error).message}`));
      void this.sunat.enviarVenta(id).catch(() => undefined);
    }
    return this.obtener(id);
  }

  /** Descuenta stock; si el producto controla vencimiento, primero de los lotes que vencen antes. */
  private async descontar(
    tx: Prisma.TransactionClient,
    producto: { id: number; costo: Prisma.Decimal; controlaVencimiento: boolean },
    cantidad: number,
    extra: { ventaId: number; usuarioId: number; referencia: string; motivo?: string; permitirNegativo: boolean },
  ) {
    let pendiente = cantidad;
    const base = {
      productoId: producto.id,
      tipo: TipoMovimiento.VENTA,
      costoUnitario: Number(producto.costo),
      usuarioId: extra.usuarioId,
      referencia: extra.referencia,
      motivo: extra.motivo,
      permitirNegativo: extra.permitirNegativo,
    };
    if (producto.controlaVencimiento) {
      const lotes = await tx.lote.findMany({
        where: { productoId: producto.id, cantidad: { gt: 0 } },
        orderBy: [{ fechaVencimiento: 'asc' }, { id: 'asc' }],
      });
      for (const lote of lotes) {
        if (pendiente <= 0) break;
        const tomar = Math.min(pendiente, Number(lote.cantidad));
        const m = await this.stock.mover(tx, { ...base, cantidad: -tomar, loteId: lote.id });
        await tx.movimientoStock.update({ where: { id: m.id }, data: { ventaId: extra.ventaId } });
        pendiente = Math.round((pendiente - tomar) * 1000) / 1000;
      }
    }
    if (pendiente > 0) {
      const m = await this.stock.mover(tx, { ...base, cantidad: -pendiente });
      await tx.movimientoStock.update({ where: { id: m.id }, data: { ventaId: extra.ventaId } });
    }
  }

  async anular(id: number, dto: AnularVentaDto, user: UsuarioSesion) {
    const anuladaPorId = await this.auth.autorizarAdmin(user, dto.autorizacion);
    await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findUnique({ where: { id }, include: { caja: true, movimientos: true } });
      if (!venta) throw new NotFoundException('Venta no encontrada');
      if (venta.estado === EstadoVenta.ANULADA) throw new BadRequestException('La venta ya está anulada');
      if (venta.caja.estado !== EstadoCaja.ABIERTA) {
        throw new BadRequestException('Solo se anulan ventas de la caja abierta; esta caja ya se cerró');
      }
      const referencia = `Anula ${correlativo(venta)}`;
      for (const m of venta.movimientos.filter((x) => x.tipo === TipoMovimiento.VENTA)) {
        const r = await this.stock.mover(tx, {
          productoId: m.productoId,
          tipo: TipoMovimiento.ANULACION_VENTA,
          cantidad: -Number(m.cantidad),
          costoUnitario: Number(m.costoUnitario),
          usuarioId: anuladaPorId,
          loteId: m.loteId ?? undefined,
          referencia,
          motivo: dto.motivo,
          permitirNegativo: true,
        });
        await tx.movimientoStock.update({ where: { id: r.id }, data: { ventaId: venta.id } });
      }
      await tx.venta.update({
        where: { id },
        data: { estado: EstadoVenta.ANULADA, anuladaPorId, fechaAnulacion: new Date(), motivoAnulacion: dto.motivo },
      });
      await this.sunat.marcarBaja(tx, id);
    });
    return this.obtener(id);
  }

  async obtener(id: number) {
    const v = await this.prisma.venta.findUnique({ where: { id }, include: detalle, omit: { xmlFirmado: true } });
    if (!v) throw new NotFoundException('Venta no encontrada');
    return v;
  }

  async listar(f: FiltroVentas) {
    const where: Prisma.VentaWhereInput = {};
    if (f.cajaId) where.cajaId = f.cajaId;
    if (f.tipo && f.tipo in TipoComprobante) where.tipoComprobante = f.tipo;
    if (f.estado && f.estado in EstadoVenta) where.estado = f.estado;
    if (f.desde || f.hasta) {
      where.fecha = {
        ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00`) } : {}),
        ...(f.hasta ? { lt: new Date(new Date(`${f.hasta}T00:00:00`).getTime() + 86_400_000) } : {}),
      };
    }
    return this.prisma.venta.findMany({
      where,
      omit: { xmlFirmado: true },
      include: { cliente: { select: { nombre: true } }, usuario: { select: { nombre: true } }, pagos: true },
      orderBy: { id: 'desc' },
      take: 1000,
    });
  }
}
