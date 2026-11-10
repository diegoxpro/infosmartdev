import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoMovimiento } from '@prisma/client';
import { StockService } from '../inventario/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarPreciosDto, CrearProductoDto, EditarProductoDto, PresentacionDto } from './productos.dto';

export interface FiltroProductos {
  q?: string;
  filtro?: 'stock-bajo' | 'revisar' | 'inactivos' | 'sin-stock';
  pagina?: number;
  porPagina?: number;
}

const aFecha = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);

const incluir = {
  categoria: true,
  marca: true,
  presentaciones: { where: { activo: true }, orderBy: { factor: 'asc' } },
} satisfies Prisma.ProductoInclude;

@Injectable()
export class ProductosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async listar({ q, filtro, pagina = 1, porPagina = 50 }: FiltroProductos) {
    const where: Prisma.ProductoWhereInput = { activo: filtro !== 'inactivos' };
    const texto = q?.trim();
    if (texto) {
      where.OR = [
        { codigoBarra: texto },
        { presentaciones: { some: { codigoBarra: texto, activo: true } } },
        { AND: texto.split(/\s+/).map((p) => ({ nombre: { contains: p, mode: 'insensitive' as const } })) },
        { codigoBarra: { startsWith: texto } },
      ];
    }
    if (filtro === 'revisar') where.revisar = { not: null };
    if (filtro === 'sin-stock') where.stock = { lte: 0 };

    if (filtro === 'stock-bajo') {
      // Prisma no compara dos columnas; se filtra por id con SQL.
      const ids = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Producto" WHERE activo AND "stockMinimo" > 0 AND stock <= "stockMinimo"`;
      where.id = { in: ids.map((r) => r.id) };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        include: incluir,
        orderBy: { nombre: 'asc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);
    return { total, pagina, porPagina, items };
  }

  async obtener(id: number) {
    const p = await this.prisma.producto.findUnique({
      where: { id },
      include: { ...incluir, lotes: { where: { cantidad: { gt: 0 } }, orderBy: { fechaVencimiento: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  /** Busca por código del producto o de una presentación; en ese caso la devuelve en "presentacion". */
  async porCodigo(codigo: string) {
    const c = codigo.trim();
    const p = await this.prisma.producto.findUnique({ where: { codigoBarra: c }, include: incluir });
    if (p?.activo) return { ...p, presentacion: null };
    const pres = await this.prisma.presentacion.findUnique({ where: { codigoBarra: c }, include: { producto: { include: incluir } } });
    if (!pres || !pres.activo || !pres.producto.activo) throw new NotFoundException(`No hay producto con código ${codigo}`);
    const { producto, ...presentacion } = pres;
    return { ...producto, presentacion };
  }

  async crear(dto: CrearProductoDto, usuarioId: number) {
    const { stockInicial, presentaciones, fechaVencimiento, ...data } = dto;
    await this.validarCodigo(data.codigoBarra);
    await this.validarPresentaciones(presentaciones, data.codigoBarra);
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.producto.create({ data: { ...data, codigoBarra: data.codigoBarra?.trim() || null } });
      if (presentaciones) await this.guardarPresentaciones(tx, p.id, presentaciones);
      if (stockInicial) {
        // El stock inicial entra en un lote si se indicó cuándo vence.
        const lote =
          data.controlaVencimiento && fechaVencimiento
            ? await tx.lote.create({ data: { productoId: p.id, fechaVencimiento: aFecha(fechaVencimiento), cantidad: 0, codigo: 'INICIAL' } })
            : null;
        await this.stock.mover(tx, {
          productoId: p.id,
          loteId: lote?.id,
          tipo: TipoMovimiento.AJUSTE,
          cantidad: stockInicial,
          costoUnitario: data.costo,
          usuarioId,
          motivo: 'Stock inicial',
        });
      }
      return tx.producto.findUniqueOrThrow({ where: { id: p.id }, include: incluir });
    });
  }

  async editar(id: number, dto: EditarProductoDto) {
    const { revisado, presentaciones, fechaVencimiento, ...data } = dto;
    if (data.codigoBarra !== undefined) await this.validarCodigo(data.codigoBarra, id);
    if (presentaciones) {
      const actual = await this.prisma.producto.findUnique({ where: { id } });
      await this.validarPresentaciones(presentaciones, data.codigoBarra !== undefined ? data.codigoBarra : actual?.codigoBarra, id);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.producto.update({
        where: { id },
        data: {
          ...data,
          ...(data.codigoBarra !== undefined ? { codigoBarra: data.codigoBarra?.trim() || null } : {}),
          ...(revisado ? { revisar: null } : {}),
        },
      });
      if (presentaciones) await this.guardarPresentaciones(tx, id, presentaciones);
      if (fechaVencimiento && data.controlaVencimiento !== false) {
        await this.stock.fijarVencimiento(tx, id, aFecha(fechaVencimiento), 'PRODUCTO');
      }
      return tx.producto.findUniqueOrThrow({ where: { id }, include: incluir });
    });
  }

  async actualizarPrecios(dto: ActualizarPreciosDto) {
    await this.prisma.$transaction(
      dto.items.map(({ productoId, presentacionId, ...precios }) =>
        presentacionId
          ? this.prisma.presentacion.update({ where: { id: presentacionId, productoId }, data: precios })
          : this.prisma.producto.update({ where: { id: productoId }, data: precios }),
      ),
    );
    return { actualizados: dto.items.length };
  }

  /**
   * Deja las presentaciones como vienen en la lista. Las que ya no están se
   * desactivan (no se borran: las ventas y compras pasadas las nombran).
   */
  private async guardarPresentaciones(tx: Prisma.TransactionClient, productoId: number, lista: PresentacionDto[]) {
    const existentes = await tx.presentacion.findMany({ where: { productoId } });
    const ids = new Set(existentes.map((e) => e.id));
    // Primero se liberan los códigos de las que se quitan, por si otra los toma.
    const quitar = existentes.filter((e) => !lista.some((x) => x.id === e.id)).map((e) => e.id);
    if (quitar.length) await tx.presentacion.updateMany({ where: { id: { in: quitar } }, data: { activo: false, codigoBarra: null } });
    for (const { id, ...x } of lista) {
      const data = {
        nombre: x.nombre.trim().toUpperCase(),
        factor: x.factor,
        codigoBarra: x.codigoBarra?.trim() || null,
        precio1: x.precio1,
        precio2: x.precio2 || x.precio1,
        precio3: x.precio3 || x.precio1,
        activo: true,
      };
      if (id) {
        if (!ids.has(id)) throw new BadRequestException('La presentación no es de este producto');
        await tx.presentacion.update({ where: { id }, data });
      } else {
        await tx.presentacion.create({ data: { ...data, productoId } });
      }
    }
  }

  private async validarPresentaciones(lista: PresentacionDto[] | undefined, codigoProducto: string | null | undefined, productoId?: number) {
    if (!lista) return;
    const codigos = [codigoProducto?.trim(), ...lista.map((x) => x.codigoBarra?.trim())].filter(Boolean) as string[];
    const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
    if (repetido) throw new BadRequestException(`El código ${repetido} está repetido en el producto`);
    for (const x of lista) {
      if (x.factor === 1) throw new BadRequestException(`"${x.nombre}" trae 1 unidad: eso ya es el producto mismo`);
      const c = x.codigoBarra?.trim();
      if (!c) continue;
      const otro = await this.prisma.producto.findUnique({ where: { codigoBarra: c } });
      if (otro && otro.id !== productoId) throw new BadRequestException(`El código ${c} ya lo usa "${otro.nombre}"`);
      const otra = await this.prisma.presentacion.findUnique({ where: { codigoBarra: c }, include: { producto: true } });
      if (otra && otra.productoId !== productoId) {
        throw new BadRequestException(`El código ${c} ya lo usa "${otra.producto.nombre} - ${otra.nombre}"`);
      }
    }
  }

  private async validarCodigo(codigo: string | null | undefined, exceptoId?: number) {
    const c = codigo?.trim();
    if (!c) return;
    const otro = await this.prisma.producto.findUnique({ where: { codigoBarra: c } });
    if (otro && otro.id !== exceptoId) {
      throw new BadRequestException(`El código ${c} ya lo usa "${otro.nombre}"`);
    }
    const pres = await this.prisma.presentacion.findUnique({ where: { codigoBarra: c }, include: { producto: true } });
    if (pres) {
      throw new BadRequestException(`El código ${c} ya lo usa "${pres.producto.nombre} - ${pres.nombre}"`);
    }
  }
}
