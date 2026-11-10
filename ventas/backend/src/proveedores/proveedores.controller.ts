import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { Permiso } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultaDocService } from '../ventas/consulta-doc.service';

class ProveedorDto {
  @IsOptional() @ValidateIf((_, v) => v !== '' && v !== null) @Matches(/^\d{8}$|^\d{11}$/, { message: 'El RUC tiene 11 dígitos (o DNI de 8)' })
  ruc?: string | null;
  @IsString() @MinLength(2, { message: 'Escribe la razón social' }) razonSocial: string;
  @IsOptional() @IsString() nombreComercial?: string | null;
  @IsOptional() @IsString() telefono?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== '' && v !== null) @IsEmail({}, { message: 'El correo no es válido' }) email?: string | null;
  @IsOptional() @IsString() direccion?: string | null;
  @IsOptional() @IsString() contacto?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(365) diasCredito?: number | null;
  @IsOptional() @IsString() notas?: string | null;
  @IsOptional() @IsBoolean() activo?: boolean;
}

class EditarProveedorDto extends ProveedorDto {
  @IsOptional() @IsString() @MinLength(2) declare razonSocial: string;
}

const vacio = (v?: string | null) => (v === undefined ? undefined : v?.trim() || null);

@Controller('proveedores')
export class ProveedoresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consulta: ConsultaDocService,
  ) {}

  @Get()
  async listar(@Query('q') q?: string, @Query('todos') todos?: string) {
    const where: Prisma.ProveedorWhereInput = todos ? {} : { activo: true };
    const t = q?.trim();
    if (t) {
      where.OR = [
        { ruc: { startsWith: t } },
        { razonSocial: { contains: t, mode: 'insensitive' } },
        { nombreComercial: { contains: t, mode: 'insensitive' } },
        { contacto: { contains: t, mode: 'insensitive' } },
        { telefono: { contains: t.replace(/\s/g, '') } },
      ];
    }
    const proveedores = await this.prisma.proveedor.findMany({ where, orderBy: [{ activo: 'desc' }, { razonSocial: 'asc' }] });
    // Deuda pendiente por proveedor (compras al crédito con saldo).
    const deudas = await this.prisma.compra.groupBy({
      by: ['proveedorId'],
      where: { estado: 'REGISTRADA', saldo: { gt: 0 } },
      _sum: { saldo: true },
    });
    const deuda = new Map(deudas.map((d) => [d.proveedorId, d._sum.saldo]));
    return proveedores.map((p) => ({ ...p, deuda: deuda.get(p.id) ?? 0 }));
  }

  /**
   * Busca un RUC/DNI: primero entre los proveedores guardados (funciona sin internet)
   * y, si no está, en el servicio de consulta configurado (mismo token que clientes).
   */
  @Get('consulta/:tipo/:numero')
  async consultar(@Param('tipo') tipo: string, @Param('numero') numero: string) {
    if (tipo !== 'DNI' && tipo !== 'RUC') throw new BadRequestException('Solo se consulta DNI o RUC');
    const largo = tipo === 'DNI' ? 8 : 11;
    if (!new RegExp(`^\\d{${largo}}$`).test(numero)) throw new BadRequestException(`El ${tipo} debe tener ${largo} dígitos`);
    const proveedor = await this.prisma.proveedor.findUnique({ where: { ruc: numero } });
    if (proveedor) return { fuente: 'local' as const, proveedor };
    return this.consulta.consultar(tipo, numero);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.proveedor.findUniqueOrThrow({ where: { id } });
  }

  @Permiso('proveedores.editar')
  @Post()
  async crear(@Body() dto: ProveedorDto) {
    const data = this.datos(dto);
    await this.validarRuc(data.ruc);
    return this.prisma.proveedor.create({ data: { ...data, razonSocial: data.razonSocial! } });
  }

  @Permiso('proveedores.editar')
  @Patch(':id')
  async editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarProveedorDto) {
    const data = this.datos(dto);
    await this.validarRuc(data.ruc, id);
    return this.prisma.proveedor.update({ where: { id }, data });
  }

  /** Sin compras se borra; con compras queda inactivo para conservar el historial y las cuentas por pagar. */
  @Permiso('proveedores.editar')
  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    const compras = await this.prisma.compra.count({ where: { proveedorId: id } });
    if (compras > 0) {
      await this.prisma.proveedor.update({ where: { id }, data: { activo: false } });
      return { eliminado: false, inactivado: true, compras };
    }
    await this.prisma.proveedor.delete({ where: { id } });
    return { eliminado: true, inactivado: false, compras: 0 };
  }

  private datos(dto: ProveedorDto) {
    return {
      ruc: vacio(dto.ruc),
      razonSocial: dto.razonSocial === undefined ? undefined : dto.razonSocial.trim().toUpperCase(),
      nombreComercial: vacio(dto.nombreComercial),
      telefono: vacio(dto.telefono),
      email: vacio(dto.email),
      direccion: vacio(dto.direccion),
      contacto: vacio(dto.contacto),
      diasCredito: dto.diasCredito === undefined ? undefined : dto.diasCredito || null,
      notas: vacio(dto.notas),
      activo: dto.activo,
    };
  }

  private async validarRuc(ruc?: string | null, exceptoId?: number) {
    if (!ruc) return;
    const otro = await this.prisma.proveedor.findUnique({ where: { ruc } });
    if (otro && otro.id !== exceptoId) throw new BadRequestException(`El RUC ya está registrado: ${otro.razonSocial}`);
  }
}
