import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EstadoConteo, EstadoInventario, Prisma, TipoMovimiento } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { exigirLotes, juntarLotes, LoteContado, leerLotes, lotesJson, normalizarLotes, sumaLotes } from './lotes-inventario';
import { StockService } from './stock.service';

export type AccionConteo = 'SUMAR' | 'REEMPLAZAR' | 'DESCARTAR';

export interface ConteoMovil {
  clienteId: string;
  productoId: number;
  cantidad: number;
  lotes?: LoteContado[];
}

const ACTIVOS = [EstadoInventario.EN_CURSO, EstadoInventario.REVISION];
const productoBasico = { select: { id: true, nombre: true, codigoBarra: true, unidad: true, stock: true, costo: true, controlaVencimiento: true } };
const token = () => randomBytes(24).toString('base64url');

/**
 * Inventario físico con celulares: el administrador lo inicia en la PC, los
 * operadores entran escaneando un QR y cada conteo llega a la PC. Al terminar
 * el administrador revisa, resuelve los productos contados dos veces y valida.
 */
@Injectable()
export class TomaInventarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ---------- Administrador (PC) ----------

  actual() {
    return this.prisma.inventario.findFirst({ where: { estado: { in: ACTIVOS } }, orderBy: { id: 'desc' } });
  }

  historial() {
    return this.prisma.inventario.findMany({
      where: { estado: { in: [EstadoInventario.VALIDADO, EstadoInventario.CANCELADO] } },
      include: { usuario: { select: { nombre: true } }, _count: { select: { items: true, operadores: true } } },
      orderBy: { id: 'desc' },
      take: 30,
    });
  }

  async iniciar(usuarioId: number) {
    if (await this.actual()) throw new ConflictException('Ya hay un inventario en curso');
    return this.prisma.inventario.create({ data: { token: token(), usuarioId } });
  }

  /** Cambia cada vez que llega un conteo o se toca un producto: la PC recarga solo entonces. */
  async version(id: number) {
    const inv = await this.obtener(id);
    const [c, i, o] = await Promise.all([
      this.prisma.inventarioConteo.aggregate({ where: { inventarioId: id }, _max: { id: true }, _count: true }),
      this.prisma.inventarioItem.aggregate({ where: { inventarioId: id }, _max: { actualizado: true } }),
      this.prisma.inventarioOperador.count({ where: { inventarioId: id } }),
    ]);
    return { estado: inv.estado, version: `${inv.estado}.${c._max.id ?? 0}.${c._count}.${i._max.actualizado?.getTime() ?? 0}.${o}` };
  }

  async detalle(id: number) {
    const inv = await this.prisma.inventario.findUnique({
      where: { id },
      include: {
        usuario: { select: { nombre: true } },
        operadores: { orderBy: { id: 'asc' }, include: { _count: { select: { conteos: true } } } },
        items: {
          include: {
            producto: productoBasico,
            conteos: { orderBy: { id: 'asc' }, include: { operador: { select: { nombre: true } } } },
          },
          orderBy: { actualizado: 'desc' },
        },
      },
    });
    if (!inv) throw new NotFoundException('Inventario no encontrado');
    const totalProductos = await this.prisma.producto.count({ where: { activo: true } });
    return { ...inv, totalProductos };
  }

  /** El administrador decide qué hacer con un segundo conteo del mismo producto. */
  async resolver(conteoId: number, accion: AccionConteo) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.inventarioConteo.findUnique({ where: { id: conteoId }, include: { inventario: true, item: true } });
      if (!c) throw new NotFoundException('Conteo no encontrado');
      this.exigirAbierto(c.inventario.estado);
      if (c.estado !== EstadoConteo.PENDIENTE) throw new BadRequestException('Ese conteo ya fue resuelto');
      if (accion === 'DESCARTAR') {
        return tx.inventarioConteo.update({ where: { id: c.id }, data: { estado: EstadoConteo.DESCARTADO } });
      }
      const sumar = accion === 'SUMAR';
      const cantidad = sumar ? c.item.cantidad.plus(c.cantidad) : c.cantidad;
      // Sumar junta los lotes de los dos conteos (misma fecha se suma).
      const lotes = sumar ? juntarLotes(leerLotes(c.item.lotes), leerLotes(c.lotes)) : leerLotes(c.lotes);
      await tx.inventarioItem.update({
        where: { id: c.itemId },
        data: {
          cantidad,
          lotes: lotesJson(lotes),
          // Las ventas hechas antes de este conteo ya están reflejadas en él.
          stockReferencia: c.stockAlContar,
          contadoEn: c.fecha,
          actualizado: new Date(),
        },
      });
      return tx.inventarioConteo.update({
        where: { id: c.id },
        data: { estado: accion === 'SUMAR' ? EstadoConteo.SUMADO : EstadoConteo.REEMPLAZADO },
      });
    });
  }

  /** Corrección manual desde la PC al revisar. */
  async editarItem(itemId: number, cantidad: number, lotesDto?: LoteContado[]) {
    const item = await this.prisma.inventarioItem.findUnique({
      where: { id: itemId },
      include: { inventario: true, producto: { select: { controlaVencimiento: true } } },
    });
    if (!item) throw new NotFoundException('Producto no encontrado en el inventario');
    this.exigirAbierto(item.inventario.estado);
    const lotes = lotesDto ? normalizarLotes(lotesDto) : leerLotes(item.lotes);
    const total = lotes.length ? sumaLotes(lotes) : cantidad;
    exigirLotes(total, lotes, item.producto.controlaVencimiento);
    return this.prisma.inventarioItem.update({
      where: { id: itemId },
      data: {
        cantidad: total,
        lotes: lotesJson(lotes),
        actualizado: new Date(),
      },
    });
  }

  async finalizar(id: number) {
    const inv = await this.obtener(id);
    if (inv.estado !== EstadoInventario.EN_CURSO) throw new BadRequestException('El conteo ya está cerrado');
    return this.prisma.inventario.update({ where: { id }, data: { estado: EstadoInventario.REVISION, fin: new Date() } });
  }

  async reabrir(id: number) {
    const inv = await this.obtener(id);
    if (inv.estado !== EstadoInventario.REVISION) throw new BadRequestException('Solo se reabre un inventario en revisión');
    return this.prisma.inventario.update({ where: { id }, data: { estado: EstadoInventario.EN_CURSO, fin: null } });
  }

  async cancelar(id: number) {
    const inv = await this.obtener(id);
    this.exigirAbierto(inv.estado);
    return this.prisma.inventario.update({ where: { id }, data: { estado: EstadoInventario.CANCELADO, fin: inv.fin ?? new Date() } });
  }

  /** Productos activos que nadie contó. */
  async noContados(id: number) {
    await this.obtener(id);
    return this.prisma.producto.findMany({
      where: { activo: true, inventarioItems: { none: { inventarioId: id } } },
      select: { id: true, nombre: true, codigoBarra: true, unidad: true, stock: true, categoria: { select: { nombre: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  /** Oculta productos de la venta sin tocar su stock. */
  async inhabilitar(productoIds: number[]) {
    const r = await this.prisma.producto.updateMany({ where: { id: { in: productoIds } }, data: { activo: false } });
    return { inhabilitados: r.count };
  }

  /**
   * Aplica el inventario: a cada producto le suma (contado - stock al contar),
   * así lo vendido mientras se contaba no se pierde. Deja un movimiento
   * INVENTARIO en el kardex y deja los lotes (fecha y cantidad) que se contaron.
   */
  async validar(id: number, usuarioId: number) {
    const inv = await this.obtener(id);
    if (inv.estado !== EstadoInventario.REVISION) throw new BadRequestException('Primero finaliza el conteo');
    const pendientes = await this.prisma.inventarioConteo.count({ where: { inventarioId: id, estado: EstadoConteo.PENDIENTE } });
    if (pendientes) throw new BadRequestException(`Hay ${pendientes} producto(s) contados dos veces sin decidir si sumar o reemplazar`);

    const items = await this.prisma.inventarioItem.findMany({
      where: { inventarioId: id },
      include: { producto: { select: { costo: true, controlaVencimiento: true } } },
    });
    let ajustados = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const it of items) {
          const diferencia = Number(it.cantidad.minus(it.stockReferencia));
          if (Math.abs(diferencia) >= 0.0005) {
            await this.stock.mover(tx, {
              productoId: it.productoId,
              tipo: TipoMovimiento.INVENTARIO,
              cantidad: diferencia,
              costoUnitario: Number(it.producto.costo),
              usuarioId,
              referencia: `INV-${id}`,
              motivo: `Inventario #${id}: contado ${Number(it.cantidad)}`,
              permitirNegativo: true,
            });
            ajustados++;
          }
          const lotes = leerLotes(it.lotes);
          if (lotes.length || it.producto.controlaVencimiento) await this.stock.reemplazarLotes(tx, it.productoId, lotes, it.contadoEn);
        }
        await tx.inventario.update({ where: { id }, data: { estado: EstadoInventario.VALIDADO, validadoAt: new Date() } });
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
    return { productos: items.length, ajustados };
  }

  // ---------- Celular ----------

  async entrar(tokenInventario: string, nombre: string) {
    const inv = await this.prisma.inventario.findUnique({ where: { token: tokenInventario } });
    if (!inv || inv.estado !== EstadoInventario.EN_CURSO) throw new UnauthorizedException('Este inventario ya no está abierto. Escanea el QR de la PC.');
    return this.prisma.inventarioOperador.create({ data: { inventarioId: inv.id, nombre: nombre.trim(), token: token() } });
  }

  /**
   * Conteo desde la PC (cajera o administrador): cada usuario es un operador
   * más del inventario en curso, con su propio token, sin escanear el QR.
   */
  async operadorPc(usuarioId: number, nombre: string) {
    const inv = await this.prisma.inventario.findFirst({ where: { estado: { in: ACTIVOS } }, orderBy: { id: 'desc' } });
    if (!inv) return { inventario: null, operador: null };
    let op = await this.prisma.inventarioOperador.findFirst({ where: { inventarioId: inv.id, usuarioId }, orderBy: { id: 'asc' } });
    if (!op && inv.estado === EstadoInventario.EN_CURSO) {
      op = await this.prisma.inventarioOperador.create({
        data: { inventarioId: inv.id, usuarioId, nombre: `${nombre.trim().slice(0, 30)} (PC)`, token: token() },
      });
    }
    return { inventario: { id: inv.id, estado: inv.estado }, operador: op ? { token: op.token, nombre: op.nombre } : null };
  }

  async operador(tokenOperador?: string) {
    if (!tokenOperador) throw new UnauthorizedException('Escanea el QR de la PC para entrar');
    const op = await this.prisma.inventarioOperador.findUnique({ where: { token: tokenOperador }, include: { inventario: true } });
    if (!op) throw new UnauthorizedException('Escanea el QR de la PC para entrar');
    return op;
  }

  async sesionMovil(tokenOperador?: string) {
    const op = await this.operador(tokenOperador);
    await this.prisma.inventarioOperador.update({ where: { id: op.id }, data: { ultimoAcceso: new Date() } });
    const conteos = await this.prisma.inventarioConteo.findMany({
      where: { operadorId: op.id },
      include: { item: { select: { producto: { select: { nombre: true } } } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
    const total = await this.prisma.inventarioConteo.count({ where: { operadorId: op.id } });
    return {
      operador: { id: op.id, nombre: op.nombre },
      inventario: { id: op.inventario.id, estado: op.inventario.estado },
      total,
      conteos: conteos.map((c) => ({
        id: c.id,
        clienteId: c.clienteId,
        producto: c.item.producto.nombre,
        cantidad: c.cantidad,
        estado: c.estado,
        fecha: c.fecha,
      })),
    };
  }

  /** Busca por código de barras (del producto o de una presentación). */
  async porCodigo(tokenOperador: string | undefined, codigo: string) {
    const op = await this.operador(tokenOperador);
    const cod = codigo.trim();
    let producto = await this.prisma.producto.findUnique({ where: { codigoBarra: cod }, ...productoBasico });
    let presentacion: { nombre: string; factor: Prisma.Decimal } | null = null;
    if (!producto) {
      const pres = await this.prisma.presentacion.findUnique({ where: { codigoBarra: cod }, include: { producto: productoBasico } });
      if (pres) {
        producto = pres.producto;
        presentacion = { nombre: pres.nombre, factor: pres.factor };
      }
    }
    if (!producto) throw new NotFoundException(`No hay ningún producto con el código ${cod}`);
    return { producto, presentacion, lotesSistema: await this.lotesSistema(producto.id), yaContado: await this.yaContado(op.inventarioId, producto.id) };
  }

  async buscar(tokenOperador: string | undefined, q: string) {
    const op = await this.operador(tokenOperador);
    const palabras = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!palabras.length) return [];
    const productos = await this.prisma.producto.findMany({
      where: { activo: true, AND: palabras.map((p) => ({ nombre: { contains: p, mode: 'insensitive' as const } })) },
      ...productoBasico,
      orderBy: { nombre: 'asc' },
      take: 25,
    });
    const items = await this.prisma.inventarioItem.findMany({
      where: { inventarioId: op.inventarioId, productoId: { in: productos.map((p) => p.id) } },
      select: { productoId: true },
    });
    const contados = new Set(items.map((i) => i.productoId));
    return productos.map((p) => ({ ...p, contado: contados.has(p.id) }));
  }

  async producto(tokenOperador: string | undefined, productoId: number) {
    const op = await this.operador(tokenOperador);
    const producto = await this.prisma.producto.findUnique({ where: { id: productoId }, ...productoBasico });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return { producto, presentacion: null, lotesSistema: await this.lotesSistema(producto.id), yaContado: await this.yaContado(op.inventarioId, producto.id) };
  }

  /** Lotes con stock que el sistema conoce, por fecha: el celular los muestra para corregirlos. */
  private async lotesSistema(productoId: number) {
    const lotes = await this.prisma.lote.findMany({ where: { productoId, cantidad: { gt: 0 } }, orderBy: { fechaVencimiento: 'asc' } });
    return normalizarLotes(lotes.map((l) => ({ fecha: l.fechaVencimiento.toISOString().slice(0, 10), cantidad: Number(l.cantidad) })));
  }

  private async yaContado(inventarioId: number, productoId: number) {
    const item = await this.prisma.inventarioItem.findUnique({
      where: { inventarioId_productoId: { inventarioId, productoId } },
      include: { conteos: { include: { operador: { select: { nombre: true } } }, orderBy: { id: 'asc' } } },
    });
    if (!item) return null;
    return {
      cantidad: item.cantidad,
      conteos: item.conteos.map((c) => ({ operador: c.operador.nombre, cantidad: c.cantidad, lotes: leerLotes(c.lotes), estado: c.estado, fecha: c.fecha })),
    };
  }

  /**
   * Guarda un conteo. Si el producto ya estaba contado queda PENDIENTE y la
   * PC avisa para elegir sumar o reemplazar. Repetir el mismo clienteId
   * (reintento por mala señal) devuelve el conteo ya guardado.
   */
  async registrarConteo(tokenOperador: string | undefined, dto: ConteoMovil) {
    const op = await this.operador(tokenOperador);
    const previo = await this.prisma.inventarioConteo.findUnique({ where: { clienteId: dto.clienteId } });
    if (previo) {
      if (previo.operadorId !== op.id) throw new BadRequestException('Conteo duplicado');
      return previo;
    }
    if (op.inventario.estado !== EstadoInventario.EN_CURSO) {
      throw new BadRequestException('El administrador ya cerró el conteo. Este dato no se guardó.');
    }
    const producto = await this.prisma.producto.findUnique({ where: { id: dto.productoId }, select: { id: true, stock: true, controlaVencimiento: true } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    const lotes = normalizarLotes(dto.lotes);
    exigirLotes(dto.cantidad, lotes, producto.controlaVencimiento);

    const intentar = () =>
      this.prisma.$transaction(async (tx) => {
        const existente = await tx.inventarioItem.findUnique({
          where: { inventarioId_productoId: { inventarioId: op.inventarioId, productoId: producto.id } },
        });
        const item =
          existente ??
          (await tx.inventarioItem.create({
            data: {
              inventarioId: op.inventarioId,
              productoId: producto.id,
              cantidad: dto.cantidad,
              stockReferencia: producto.stock,
              lotes: lotesJson(lotes),
            },
          }));
        if (existente) await tx.inventarioItem.update({ where: { id: existente.id }, data: { actualizado: new Date() } });
        return tx.inventarioConteo.create({
          data: {
            inventarioId: op.inventarioId,
            itemId: item.id,
            operadorId: op.id,
            cantidad: dto.cantidad,
            stockAlContar: producto.stock,
            lotes: lotesJson(lotes),
            estado: existente ? EstadoConteo.PENDIENTE : EstadoConteo.APLICADO,
            clienteId: dto.clienteId,
          },
        });
      });
    try {
      return await intentar();
    } catch (e) {
      // Dos celulares contaron el mismo producto a la vez: el segundo queda pendiente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ya = await this.prisma.inventarioConteo.findUnique({ where: { clienteId: dto.clienteId } });
        return ya ?? intentar();
      }
      throw e;
    }
  }

  // ---------- Ayudas ----------

  private async obtener(id: number) {
    const inv = await this.prisma.inventario.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Inventario no encontrado');
    return inv;
  }

  private exigirAbierto(estado: EstadoInventario) {
    if (!ACTIVOS.includes(estado as (typeof ACTIVOS)[number])) throw new BadRequestException('Este inventario ya terminó');
  }
}
