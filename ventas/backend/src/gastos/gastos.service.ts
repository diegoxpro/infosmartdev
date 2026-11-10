import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCaja, EstadoGasto, MedioPago, OrigenGasto, Prisma, TipoMovimientoCaja, TipoMovimientoFondo } from '@prisma/client';
import { CajaService } from '../caja/caja.service';
import { cuentaDe, FondoService } from '../fondo/fondo.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnularGastoDto, CategoriaDto, EditarGastoDto, GastoDto, GastoFijoDto } from './gastos.dto';
import { pendientesGastoFijo } from './gastos-fijos';

/** Fecha de calendario en Lima (UTC-5, sin horario de verano). */
const enLima = (f: Date) => {
  const l = new Date(f.getTime() - 5 * 3_600_000);
  return { anio: l.getUTCFullYear(), mes: l.getUTCMonth() + 1, dia: l.getUTCDate() };
};
const limpio = (s?: string | null) => s?.trim() || null;

export interface FiltroGastos {
  desde?: string;
  hasta?: string;
  categoriaId?: number;
  anulados?: boolean;
}

const INCLUDE = {
  categoria: { select: { id: true, nombre: true, pideTrabajador: true } },
  gastoFijo: { select: { id: true, nombre: true } },
  usuario: { select: { nombre: true } },
  anuladoPor: { select: { nombre: true } },
} satisfies Prisma.GastoInclude;

@Injectable()
export class GastosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fondo: FondoService,
    private readonly caja: CajaService,
  ) {}

  // ------------------------------------------------------------ Categorías

  categorias() {
    return this.prisma.categoriaGasto.findMany({
      include: { _count: { select: { gastos: true, gastosFijos: true } } },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
  }

  async crearCategoria(dto: CategoriaDto) {
    const nombre = dto.nombre.trim();
    await this.nombreLibre(nombre);
    return this.prisma.categoriaGasto.create({ data: { nombre, pideTrabajador: dto.pideTrabajador ?? false } });
  }

  async editarCategoria(id: number, dto: CategoriaDto) {
    const nombre = dto.nombre.trim();
    await this.nombreLibre(nombre, id);
    return this.prisma.categoriaGasto.update({
      where: { id },
      data: { nombre, pideTrabajador: dto.pideTrabajador, activo: dto.activo },
    });
  }

  /** Solo se borra si nunca se usó; si tiene gastos, se desactiva para no perder el historial. */
  async eliminarCategoria(id: number) {
    const c = await this.prisma.categoriaGasto.findUnique({ where: { id }, include: { _count: { select: { gastos: true, gastosFijos: true } } } });
    if (!c) throw new NotFoundException('Categoría no encontrada');
    if (c._count.gastos || c._count.gastosFijos) {
      throw new BadRequestException('La categoría ya tiene gastos registrados: desactívala en lugar de eliminarla');
    }
    await this.prisma.categoriaGasto.delete({ where: { id } });
    return { ok: true };
  }

  private async nombreLibre(nombre: string, id?: number) {
    const otra = await this.prisma.categoriaGasto.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, NOT: id ? { id } : undefined } });
    if (otra) throw new BadRequestException(`Ya existe la categoría «${otra.nombre}»`);
  }

  // ------------------------------------------------------------ Gastos fijos

  async gastosFijos() {
    const fijos = await this.prisma.gastoFijo.findMany({
      include: { categoria: { select: { id: true, nombre: true, pideTrabajador: true } } },
      orderBy: [{ activo: 'desc' }, { diaPago: 'asc' }],
    });
    const pagos = await this.prisma.gasto.findMany({
      where: { gastoFijoId: { in: fijos.map((f) => f.id) }, estado: EstadoGasto.REGISTRADO, periodo: { not: null } },
      select: { gastoFijoId: true, periodo: true },
    });
    const hoy = enLima(new Date());
    return fijos.map((f) => {
      const pagados = new Set(pagos.filter((p) => p.gastoFijoId === f.id).map((p) => p.periodo!));
      return { ...f, meses: f.activo ? pendientesGastoFijo(f.diaPago, hoy, pagados, enLima(f.createdAt)) : [] };
    });
  }

  /** Gastos fijos por pagar en los próximos días o ya vencidos (para Inicio). */
  async avisos() {
    const fijos = await this.gastosFijos();
    return fijos.flatMap((f) =>
      f.meses
        .filter((m) => m.estado === 'VENCIDO' || m.estado === 'HOY' || m.estado === 'PROXIMO')
        .map((m) => ({ gastoFijoId: f.id, nombre: f.nombre, categoria: f.categoria, monto: f.monto, trabajador: f.trabajador, ...m })),
    );
  }

  async guardarGastoFijo(dto: GastoFijoDto, id?: number) {
    await this.categoriaActiva(dto.categoriaId);
    const data = {
      nombre: dto.nombre.trim(),
      categoriaId: dto.categoriaId,
      diaPago: dto.diaPago,
      monto: dto.monto ?? null,
      trabajador: limpio(dto.trabajador),
      activo: dto.activo ?? true,
    };
    return id ? this.prisma.gastoFijo.update({ where: { id }, data }) : this.prisma.gastoFijo.create({ data });
  }

  async eliminarGastoFijo(id: number) {
    const usado = await this.prisma.gasto.count({ where: { gastoFijoId: id } });
    if (usado) {
      await this.prisma.gastoFijo.update({ where: { id }, data: { activo: false } });
      return { ok: true, desactivado: true };
    }
    await this.prisma.gastoFijo.delete({ where: { id } });
    return { ok: true, desactivado: false };
  }

  private async categoriaActiva(id: number) {
    const c = await this.prisma.categoriaGasto.findUnique({ where: { id } });
    if (!c) throw new BadRequestException('Elige una categoría');
    if (!c.activo) throw new BadRequestException(`La categoría «${c.nombre}» está desactivada`);
    return c;
  }

  // ------------------------------------------------------------ Gastos

  listar(f: FiltroGastos) {
    const where: Prisma.GastoWhereInput = {};
    if (f.desde || f.hasta) {
      where.fecha = {
        gte: f.desde ? new Date(`${f.desde}T00:00:00`) : undefined,
        lt: f.hasta ? new Date(new Date(`${f.hasta}T00:00:00`).getTime() + 86_400_000) : undefined,
      };
    }
    if (f.categoriaId) where.categoriaId = f.categoriaId;
    if (!f.anulados) where.estado = EstadoGasto.REGISTRADO;
    return this.prisma.gasto.findMany({ where, include: INCLUDE, orderBy: { id: 'desc' }, take: 500 });
  }

  async registrar(dto: GastoDto, usuarioId: number) {
    const cat = await this.categoriaActiva(dto.categoriaId);
    const concepto = dto.concepto.trim();
    if (concepto.length < 3) throw new BadRequestException('Escribe el concepto (mínimo 3 letras)');
    const trabajador = limpio(dto.trabajador);
    if (cat.pideTrabajador && !trabajador) throw new BadRequestException(`Indica a qué trabajador se le pagó (${cat.nombre})`);
    const medioPago = dto.medioPago ?? MedioPago.EFECTIVO;
    if (dto.origen === OrigenGasto.CAJA && medioPago !== MedioPago.EFECTIVO) {
      throw new BadRequestException('De la caja del día solo se paga en efectivo');
    }
    if (dto.gastoFijoId && !dto.periodo) throw new BadRequestException('Indica el mes que se paga');
    if (dto.gastoFijoId) {
      const ya = await this.prisma.gasto.findFirst({ where: { gastoFijoId: dto.gastoFijoId, periodo: dto.periodo, estado: EstadoGasto.REGISTRADO } });
      if (ya) throw new BadRequestException(`Ese gasto fijo ya se pagó para ${dto.periodo}`);
    }
    const texto = `${cat.nombre}: ${concepto}${trabajador ? ` (${trabajador})` : ''}`;

    const id = await this.prisma.$transaction(async (tx) => {
      let movimientoCajaId: number | undefined;
      if (dto.origen === OrigenGasto.CAJA) {
        const c = await this.caja.exigirAbierta(tx);
        const { efectivoEsperado } = await this.caja.resumen(c.id, tx);
        if (dto.monto > efectivoEsperado + 0.005) {
          throw new BadRequestException(`No hay suficiente efectivo en la caja del día (S/ ${efectivoEsperado.toFixed(2)})`);
        }
        const m = await tx.movimientoCaja.create({
          data: { cajaId: c.id, usuarioId, tipo: TipoMovimientoCaja.EGRESO, concepto: texto, monto: dto.monto },
        });
        movimientoCajaId = m.id;
      }
      const g = await tx.gasto.create({
        data: {
          categoriaId: cat.id,
          concepto,
          monto: dto.monto,
          origen: dto.origen,
          medioPago,
          numeroOperacion: medioPago === MedioPago.EFECTIVO ? null : limpio(dto.numeroOperacion),
          trabajador,
          nota: limpio(dto.nota),
          gastoFijoId: dto.gastoFijoId ?? null,
          periodo: dto.gastoFijoId ? dto.periodo : null,
          usuarioId,
          movimientoCajaId,
        },
      });
      if (dto.origen === OrigenGasto.ACUMULADO) {
        await this.fondo.registrar(tx, {
          usuarioId,
          tipo: TipoMovimientoFondo.GASTO,
          cuenta: cuentaDe(medioPago),
          monto: -dto.monto,
          concepto: texto,
          gastoId: g.id,
        });
      }
      return g.id;
    });
    return this.obtener(id);
  }

  async obtener(id: number) {
    const g = await this.prisma.gasto.findUnique({ where: { id }, include: INCLUDE });
    if (!g) throw new NotFoundException('Gasto no encontrado');
    return g;
  }

  async editar(id: number, dto: EditarGastoDto) {
    const g = await this.obtener(id);
    if (g.estado === EstadoGasto.ANULADO) throw new BadRequestException('El gasto está anulado');
    const cat = dto.categoriaId ? await this.categoriaActiva(dto.categoriaId) : g.categoria;
    const concepto = dto.concepto !== undefined ? dto.concepto.trim() : g.concepto;
    if (concepto.length < 3) throw new BadRequestException('Escribe el concepto (mínimo 3 letras)');
    const trabajador = dto.trabajador !== undefined ? limpio(dto.trabajador) : g.trabajador;
    if (cat.pideTrabajador && !trabajador) throw new BadRequestException(`Indica a qué trabajador se le pagó (${cat.nombre})`);
    await this.prisma.gasto.update({
      where: { id },
      data: { categoriaId: cat.id, concepto, trabajador, nota: dto.nota !== undefined ? limpio(dto.nota) : undefined },
    });
    return this.obtener(id);
  }

  /**
   * Anula un gasto y devuelve el dinero a donde salió: al acumulado con un
   * movimiento de anulación, o a la caja del día si sigue abierta.
   */
  async anular(id: number, dto: AnularGastoDto, usuarioId: number) {
    await this.prisma.$transaction(async (tx) => {
      const g = await tx.gasto.findUnique({ where: { id }, include: { movimientoCaja: { include: { caja: true } }, categoria: true } });
      if (!g) throw new NotFoundException('Gasto no encontrado');
      if (g.estado === EstadoGasto.ANULADO) throw new BadRequestException('El gasto ya está anulado');
      if (g.origen === OrigenGasto.CAJA && g.movimientoCaja) {
        if (g.movimientoCaja.caja.estado !== EstadoCaja.ABIERTA) {
          throw new BadRequestException('El gasto salió de una caja que ya se cerró; no se puede anular');
        }
        await tx.gasto.update({ where: { id }, data: { movimientoCajaId: null } });
        await tx.movimientoCaja.delete({ where: { id: g.movimientoCaja.id } });
      } else if (g.origen === OrigenGasto.ACUMULADO) {
        await this.fondo.registrar(tx, {
          usuarioId,
          tipo: TipoMovimientoFondo.ANULACION,
          cuenta: cuentaDe(g.medioPago),
          monto: Number(g.monto),
          concepto: `Anula gasto #${g.id} ${g.categoria.nombre}: ${dto.motivo.trim()}`,
          gastoId: g.id,
        });
      }
      await tx.gasto.update({
        where: { id },
        data: { estado: EstadoGasto.ANULADO, anuladoPorId: usuarioId, fechaAnulacion: new Date(), motivoAnulacion: dto.motivo.trim() },
      });
    });
    return this.obtener(id);
  }

  /** Nombres de trabajadores ya usados más el personal del sistema, para sugerirlos. */
  async trabajadores() {
    const [usados, usuarios] = await Promise.all([
      this.prisma.gasto.findMany({ where: { trabajador: { not: null } }, distinct: ['trabajador'], select: { trabajador: true } }),
      this.prisma.usuario.findMany({ where: { activo: true }, select: { nombre: true } }),
    ]);
    return [...new Set([...usuarios.map((u) => u.nombre), ...usados.map((u) => u.trabajador!)])].sort((a, b) => a.localeCompare(b));
  }
}
