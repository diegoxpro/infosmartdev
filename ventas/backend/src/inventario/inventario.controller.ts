import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Prisma, TipoMovimiento } from '@prisma/client';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { hoy, sumarDias } from '../common/fechas';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

class MermaDto {
  @IsInt() productoId: number;
  @IsOptional() @IsInt() loteId?: number;
  @IsNumber() @IsPositive() cantidad: number;
  @IsString() @MinLength(3) motivo: string;
}

class AjusteDto {
  @IsInt() productoId: number;
  @IsNumber() @Min(0) stockReal: number;
  @IsString() @MinLength(3) motivo: string;
}

const producto = { select: { id: true, nombre: true, codigoBarra: true, unidad: true, stock: true, costo: true } };

@Controller('inventario')
export class InventarioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly config: ConfiguracionService,
  ) {}

  /** Stock bajo el mínimo, lotes vencidos y lotes por vencer. */
  @Get('alertas')
  async alertas() {
    const cfg = await this.config.obtener();
    const limite = sumarDias(hoy(), cfg.diasAvisoVencimiento);
    const [stockBajo, vencidos, porVencer] = await Promise.all([
      this.prisma.$queryRaw<{ id: number; nombre: string; codigoBarra: string | null; stock: Prisma.Decimal; stockMinimo: Prisma.Decimal }[]>`
        SELECT id, nombre, "codigoBarra", stock, "stockMinimo" FROM "Producto"
        WHERE activo AND "stockMinimo" > 0 AND stock <= "stockMinimo" ORDER BY nombre`,
      this.prisma.lote.findMany({
        where: { cantidad: { gt: 0 }, fechaVencimiento: { lte: hoy() } },
        include: { producto },
        orderBy: { fechaVencimiento: 'asc' },
      }),
      this.prisma.lote.findMany({
        where: { cantidad: { gt: 0 }, fechaVencimiento: { gt: hoy(), lte: limite } },
        include: { producto },
        orderBy: { fechaVencimiento: 'asc' },
      }),
    ]);
    return { diasAviso: cfg.diasAvisoVencimiento, stockBajo, vencidos, porVencer };
  }

  @Permiso('stock.ajustar')
  @Post('mermas')
  async merma(@Body() dto: MermaDto, @UsuarioActual() user: UsuarioSesion) {
    const p = await this.prisma.producto.findUniqueOrThrow({ where: { id: dto.productoId } });
    if (dto.loteId) {
      const lote = await this.prisma.lote.findUnique({ where: { id: dto.loteId } });
      if (!lote || lote.productoId !== p.id) throw new BadRequestException('El lote no es de este producto');
    }
    return this.prisma.$transaction((tx) =>
      this.stock.mover(tx, {
        productoId: p.id,
        tipo: TipoMovimiento.MERMA,
        cantidad: -dto.cantidad,
        costoUnitario: Number(p.costo),
        usuarioId: user.id,
        loteId: dto.loteId,
        motivo: dto.motivo,
      }),
    );
  }

  /** Mermas valorizadas al costo, para contabilizarlas. */
  @Get('mermas')
  async mermas(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    const items = await this.prisma.movimientoStock.findMany({
      where: { tipo: TipoMovimiento.MERMA, fecha: rango(desde, hasta) },
      include: { producto: { select: { nombre: true, codigoBarra: true } }, lote: true, usuario: { select: { nombre: true } } },
      orderBy: { fecha: 'desc' },
    });
    const filas = items.map((m) => ({ ...m, valor: Math.round(-Number(m.cantidad) * Number(m.costoUnitario) * 100) / 100 }));
    return { total: Math.round(filas.reduce((s, f) => s + f.valor, 0) * 100) / 100, items: filas };
  }

  /** Corrige el stock al conteo físico. */
  @Permiso('stock.ajustar')
  @Post('ajustes')
  async ajuste(@Body() dto: AjusteDto, @UsuarioActual() user: UsuarioSesion) {
    const p = await this.prisma.producto.findUniqueOrThrow({ where: { id: dto.productoId } });
    const diferencia = dto.stockReal - Number(p.stock);
    if (Math.abs(diferencia) < 0.0005) throw new BadRequestException('El stock ya coincide con el conteo');
    return this.prisma.$transaction((tx) =>
      this.stock.mover(tx, {
        productoId: p.id,
        tipo: TipoMovimiento.AJUSTE,
        cantidad: diferencia,
        costoUnitario: Number(p.costo),
        usuarioId: user.id,
        motivo: dto.motivo,
        permitirNegativo: true,
      }),
    );
  }

  /** Movimientos de stock (kardex) de un producto o de todos. */
  @Get('movimientos')
  movimientos(
    @Query('productoId') productoId?: string,
    @Query('tipo') tipo?: TipoMovimiento,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.prisma.movimientoStock.findMany({
      where: {
        ...(productoId ? { productoId: Number(productoId) } : {}),
        ...(tipo && tipo in TipoMovimiento ? { tipo } : {}),
        fecha: rango(desde, hasta),
      },
      include: { producto: { select: { nombre: true } }, usuario: { select: { nombre: true } }, lote: true },
      orderBy: { id: 'desc' },
      take: 500,
    });
  }
}

/** Rango de fechas inclusivo (hasta = fin de ese día). */
function rango(desde?: string, hasta?: string): Prisma.DateTimeFilter | undefined {
  if (!desde && !hasta) return undefined;
  return {
    ...(desde ? { gte: new Date(`${desde}T00:00:00`) } : {}),
    ...(hasta ? { lt: sumarDias(new Date(`${hasta}T00:00:00`), 1) } : {}),
  };
}
