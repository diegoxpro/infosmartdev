import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma, TipoDocIdentidad } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Permiso } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultaDocService } from './consulta-doc.service';

class ClienteDto {
  @IsEnum(TipoDocIdentidad) tipoDoc: TipoDocIdentidad;
  @IsOptional() @IsString() numeroDoc?: string;
  @IsString() @MinLength(2) nombre: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsEmail({}, { message: 'El correo no es válido' }) email?: string;
  @IsOptional() @IsString() notas?: string;
  @IsOptional() @IsBoolean() activo?: boolean;
}

const LARGO: Partial<Record<TipoDocIdentidad, number>> = { DNI: 8, RUC: 11 };
const vacio = (v?: string) => v?.trim() || null;

@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consulta: ConsultaDocService,
  ) {}

  /** Búsqueda por documento, nombre o teléfono. `todos=1` incluye inactivos (pantalla Clientes). */
  @Get()
  buscar(@Query('q') q?: string, @Query('todos') todos?: string, @Query('limite') limite?: string) {
    const t = q?.trim();
    const where: Prisma.ClienteWhereInput = todos ? {} : { activo: true };
    if (t) {
      where.OR = [
        { numeroDoc: { startsWith: t } },
        { nombre: { contains: t, mode: 'insensitive' } },
        { telefono: { contains: t.replace(/\s/g, '') } },
      ];
    }
    return this.prisma.cliente.findMany({
      where,
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      take: Math.min(Number(limite) || 20, 500),
    });
  }

  /**
   * Busca un DNI/RUC: primero entre los clientes guardados (funciona sin internet)
   * y, si no está, en el servicio externo configurado.
   */
  @Get('consulta/:tipo/:numero')
  async consultar(@Param('tipo') tipo: string, @Param('numero') numero: string) {
    if (tipo !== 'DNI' && tipo !== 'RUC') throw new BadRequestException('Solo se consulta DNI o RUC');
    const largo = LARGO[tipo]!;
    if (!new RegExp(`^\\d{${largo}}$`).test(numero)) throw new BadRequestException(`El ${tipo} debe tener ${largo} dígitos`);
    const cliente = await this.prisma.cliente.findUnique({ where: { numeroDoc: numero } });
    if (cliente) return { fuente: 'local' as const, cliente };
    return this.consulta.consultar(tipo, numero);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.cliente.findUniqueOrThrow({ where: { id } });
  }

  @Permiso('clientes.editar')
  @Post()
  async crear(@Body() dto: ClienteDto) {
    const data = this.datos(dto);
    if (data.numeroDoc) {
      const existe = await this.prisma.cliente.findUnique({ where: { numeroDoc: data.numeroDoc } });
      // Desde la venta se reutiliza el existente (y se reactiva si estaba inactivo).
      if (existe) return existe.activo ? existe : this.prisma.cliente.update({ where: { id: existe.id }, data: { activo: true } });
    }
    return this.prisma.cliente.create({ data });
  }

  @Permiso('clientes.editar')
  @Patch(':id')
  async editar(@Param('id', ParseIntPipe) id: number, @Body() dto: ClienteDto) {
    const data = this.datos(dto);
    if (data.numeroDoc) {
      const otro = await this.prisma.cliente.findUnique({ where: { numeroDoc: data.numeroDoc } });
      if (otro && otro.id !== id) throw new BadRequestException(`El documento ${data.numeroDoc} ya es de ${otro.nombre}`);
    }
    return this.prisma.cliente.update({ where: { id }, data });
  }

  /** Borra el cliente; si ya tiene ventas solo lo deja inactivo para no perder el historial. */
  @Permiso('clientes.eliminar')
  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    const ventas = await this.prisma.venta.count({ where: { clienteId: id } });
    if (ventas > 0) {
      await this.prisma.cliente.update({ where: { id }, data: { activo: false } });
      return { eliminado: false, inactivado: true, ventas };
    }
    await this.prisma.cliente.delete({ where: { id } });
    return { eliminado: true, inactivado: false, ventas: 0 };
  }

  private datos(dto: ClienteDto) {
    const n = vacio(dto.numeroDoc);
    const largo = LARGO[dto.tipoDoc];
    if (largo && (!n || !new RegExp(`^\\d{${largo}}$`).test(n))) {
      throw new BadRequestException(`El ${dto.tipoDoc} debe tener ${largo} dígitos`);
    }
    return {
      tipoDoc: dto.tipoDoc,
      numeroDoc: dto.tipoDoc === 'SIN_DOCUMENTO' ? null : n,
      nombre: dto.nombre.trim().toUpperCase(),
      direccion: vacio(dto.direccion),
      telefono: vacio(dto.telefono),
      email: vacio(dto.email)?.toLowerCase() ?? null,
      notas: vacio(dto.notas),
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
    };
  }
}
