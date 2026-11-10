import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TipoMovimiento } from '@prisma/client';

export interface MovimientoInput {
  productoId: number;
  tipo: TipoMovimiento;
  /** Positivo entra, negativo sale. */
  cantidad: number;
  costoUnitario?: number;
  usuarioId?: number;
  loteId?: number;
  referencia?: string;
  motivo?: string;
  /** Si es false, una salida no puede dejar el stock en negativo. */
  permitirNegativo?: boolean;
}

/**
 * Único punto donde cambia el stock. Siempre se usa dentro de una transacción
 * y deja un registro en MovimientoStock (kardex).
 */
@Injectable()
export class StockService {
  async mover(tx: Prisma.TransactionClient, m: MovimientoInput) {
    if (!m.cantidad) throw new BadRequestException('La cantidad no puede ser cero');

    // Bloquea la fila del producto para que dos operaciones no pisen el stock.
    const [fila] = await tx.$queryRaw<{ stock: Prisma.Decimal; nombre: string }[]>`
      SELECT stock, nombre FROM "Producto" WHERE id = ${m.productoId} FOR UPDATE`;
    if (!fila) throw new BadRequestException(`Producto ${m.productoId} no existe`);

    const nuevo = new Prisma.Decimal(fila.stock).plus(m.cantidad);
    if (m.cantidad < 0 && nuevo.isNegative() && !m.permitirNegativo) {
      throw new BadRequestException(`Stock insuficiente de ${fila.nombre} (hay ${Number(fila.stock)})`);
    }

    if (m.loteId) {
      const lote = await tx.lote.update({
        where: { id: m.loteId },
        data: { cantidad: { increment: m.cantidad } },
      });
      if (lote.cantidad.isNegative()) throw new BadRequestException('El lote no tiene esa cantidad');
    }

    await tx.producto.update({ where: { id: m.productoId }, data: { stock: nuevo } });
    return tx.movimientoStock.create({
      data: {
        productoId: m.productoId,
        tipo: m.tipo,
        cantidad: m.cantidad,
        stockResultante: nuevo,
        costoUnitario: m.costoUnitario ?? 0,
        usuarioId: m.usuarioId,
        loteId: m.loteId,
        referencia: m.referencia,
        motivo: m.motivo,
      },
    });
  }

  /**
   * Un solo vencimiento por producto: todo el stock que queda vence en esa fecha.
   * Los lotes anteriores quedan en cero y se crea uno nuevo con el stock actual.
   */
  async fijarVencimiento(tx: Prisma.TransactionClient, productoId: number, fecha: Date, codigo: string) {
    const p = await tx.producto.findUniqueOrThrow({ where: { id: productoId }, select: { stock: true } });
    await tx.lote.updateMany({ where: { productoId, cantidad: { not: 0 } }, data: { cantidad: 0 } });
    await tx.producto.update({ where: { id: productoId }, data: { controlaVencimiento: true } });
    if (p.stock.greaterThan(0)) {
      await tx.lote.create({ data: { productoId, fechaVencimiento: fecha, cantidad: p.stock, codigo } });
    }
  }

  /**
   * Inventario con fechas: los lotes que había al contar se reemplazan por los
   * contados. Los lotes creados después del conteo (compras) se respetan, y lo
   * vendido desde entonces se descuenta de los lotes contados que vencen antes.
   * Se llama después de ajustar el stock.
   */
  async reemplazarLotes(tx: Prisma.TransactionClient, productoId: number, contados: { fecha: string; cantidad: number }[], contadoEn: Date) {
    const p = await tx.producto.findUniqueOrThrow({ where: { id: productoId }, select: { stock: true } });
    const posteriores = await tx.lote.aggregate({ where: { productoId, createdAt: { gt: contadoEn }, cantidad: { gt: 0 } }, _sum: { cantidad: true } });
    await tx.lote.updateMany({ where: { productoId, createdAt: { lte: contadoEn }, cantidad: { not: 0 } }, data: { cantidad: 0 } });
    const total = contados.reduce((s, l) => s + l.cantidad, 0);
    const caben = Math.max(0, Number(p.stock) - Number(posteriores._sum.cantidad ?? 0));
    let quitar = Math.max(0, total - caben);
    for (const l of [...contados].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      const t = Math.min(l.cantidad, quitar);
      quitar -= t;
      const queda = Math.round((l.cantidad - t) * 1000) / 1000;
      if (queda > 0) {
        await tx.lote.create({ data: { productoId, fechaVencimiento: new Date(`${l.fecha}T00:00:00Z`), cantidad: queda, codigo: 'INVENTARIO' } });
      }
    }
    if (contados.length) await tx.producto.update({ where: { id: productoId }, data: { controlaVencimiento: true } });
  }
}
