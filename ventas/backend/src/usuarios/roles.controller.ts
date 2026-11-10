import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { ClavePermiso, PERMISOS_ASIGNABLES } from '../auth/permisos';
import { PermisosService } from '../auth/permisos.service';
import { PrismaService } from '../prisma/prisma.service';

class RolDto {
  @IsString() @MinLength(2) @MaxLength(40) nombre: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permisos: string[];
}

class EditarRolDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) nombre?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) permisos?: string[];
}

/** Roles del personal. El administrador es fijo y no aparece aquí. */
@Permiso('config.usuarios')
@Controller('roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permisos: PermisosService,
  ) {}

  @Get('catalogo')
  catalogo() {
    return this.permisos.catalogo();
  }

  @Get()
  async listar() {
    const roles = await this.prisma.perfil.findMany({
      orderBy: { nombre: 'asc' },
      include: { usuarios: { select: { id: true, nombre: true, activo: true } } },
    });
    return roles.map((r) => ({ id: r.id, nombre: r.nombre, permisos: r.permisos, usuarios: r.usuarios }));
  }

  @Post()
  async crear(@Body() dto: RolDto, @UsuarioActual() yo: UsuarioSesion) {
    const nombre = await this.nombreLibre(dto.nombre);
    const permisos = this.validar(dto.permisos);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.perfil.create({ data: { nombre, permisos } });
      await tx.permisoHistorial.create({ data: { perfilId: r.id, accion: 'CREAR_ROL', detalle: nombre, hechoPorId: yo.id } });
      return r;
    });
  }

  @Patch(':id')
  async editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarRolDto, @UsuarioActual() yo: UsuarioSesion) {
    const antes = await this.prisma.perfil.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Rol no encontrado');
    const nombre = dto.nombre !== undefined ? await this.nombreLibre(dto.nombre, id) : antes.nombre;
    const permisos = dto.permisos !== undefined ? this.validar(dto.permisos) : (antes.permisos as ClavePermiso[]);
    const agregados = permisos.filter((p) => !antes.permisos.includes(p));
    const quitados = antes.permisos.filter((p) => !permisos.includes(p as ClavePermiso));
    const detalle = [
      nombre !== antes.nombre && `nombre: ${antes.nombre} → ${nombre}`,
      agregados.length && `agregó: ${agregados.join(', ')}`,
      quitados.length && `quitó: ${quitados.join(', ')}`,
    ].filter(Boolean).join(' · ');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.perfil.update({ where: { id }, data: { nombre, permisos } });
      if (detalle) await tx.permisoHistorial.create({ data: { perfilId: id, accion: 'EDITAR_ROL', detalle: `${nombre}: ${detalle}`, hechoPorId: yo.id } });
      return r;
    });
  }

  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() yo: UsuarioSesion) {
    const r = await this.prisma.perfil.findUnique({ where: { id }, include: { _count: { select: { usuarios: true } } } });
    if (!r) throw new NotFoundException('Rol no encontrado');
    if (r._count.usuarios > 0) throw new BadRequestException('Hay usuarios con este rol; cámbiales el rol antes de eliminarlo');
    await this.prisma.$transaction([
      this.prisma.perfil.delete({ where: { id } }),
      this.prisma.permisoHistorial.create({ data: { accion: 'ELIMINAR_ROL', detalle: r.nombre, hechoPorId: yo.id } }),
    ]);
    return { ok: true };
  }

  private validar(permisos: string[]): ClavePermiso[] {
    const malos = permisos.filter((p) => !PERMISOS_ASIGNABLES.includes(p as ClavePermiso));
    if (malos.length) throw new BadRequestException(`Permisos desconocidos: ${malos.join(', ')}`);
    return PERMISOS_ASIGNABLES.filter((p) => permisos.includes(p));
  }

  private async nombreLibre(nombre: string, id?: number) {
    const limpio = nombre.trim();
    if (/^administrador$/i.test(limpio)) throw new BadRequestException('"Administrador" es el rol fijo del sistema');
    const otro = await this.prisma.perfil.findFirst({ where: { nombre: { equals: limpio, mode: 'insensitive' }, NOT: id ? { id } : undefined } });
    if (otro) throw new BadRequestException('Ya existe un rol con ese nombre');
    return limpio;
  }
}
