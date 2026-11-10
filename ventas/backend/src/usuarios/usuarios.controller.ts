import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { Rol } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { esPermiso, PERMISOS, PERMISOS_ASIGNABLES } from '../auth/permisos';
import { PermisosService } from '../auth/permisos.service';
import { PrismaService } from '../prisma/prisma.service';

class CrearUsuarioDto {
  @IsString() @Matches(/^[a-z0-9._-]{3,30}$/i, { message: 'Usuario: 3 a 30 letras o números, sin espacios' })
  usuario: string;
  @IsString() @MinLength(2) nombre: string;
  @IsString() @MinLength(6) password: string;
  @IsEnum(Rol) rol: Rol;
  /** Rol del personal (obligatorio si no es administrador). */
  @ValidateIf((o) => o.rol !== Rol.ADMIN) @IsInt() perfilId?: number;
}

class EditarUsuarioDto {
  @IsOptional() @IsString() @MinLength(2) nombre?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsEnum(Rol) rol?: Rol;
  @IsOptional() @IsInt() perfilId?: number;
  @IsOptional() @IsBoolean() activo?: boolean;
}

class CambiarPermisoDto {
  /** ROL = lo que diga su rol; DAR = se le da; QUITAR = se le quita. */
  @IsIn(['ROL', 'DAR', 'QUITAR']) estado: 'ROL' | 'DAR' | 'QUITAR';
  /** Fecha y hora en que vence. Sin valor = permanente. */
  @IsOptional() @IsDateString() hasta?: string;
}

const campos = {
  id: true,
  usuario: true,
  nombre: true,
  rol: true,
  activo: true,
  createdAt: true,
  perfil: { select: { id: true, nombre: true } },
};

const ACCION = { DAR: 'DAR', QUITAR: 'QUITAR', ROL: 'RESTABLECER' } as const;

@Permiso('config.usuarios')
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permisos: PermisosService,
  ) {}

  @Get()
  async listar() {
    const ahora = new Date();
    const usuarios = await this.prisma.usuario.findMany({
      select: { ...campos, permisos: { select: { permiso: true, concedido: true, hasta: true } } },
      orderBy: { id: 'asc' },
    });
    // Cuántos cambios propios siguen vigentes, para mostrarlos en la lista.
    return usuarios.map(({ permisos, ...u }) => ({
      ...u,
      cambios: permisos.filter((p) => !p.hasta || p.hasta > ahora).length,
    }));
  }

  @Post()
  async crear(@Body() dto: CrearUsuarioDto) {
    const usuario = dto.usuario.toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { usuario } })) {
      throw new BadRequestException('Ese usuario ya existe');
    }
    const perfilId = dto.rol === Rol.ADMIN ? null : await this.perfilValido(dto.perfilId);
    return this.prisma.usuario.create({
      data: { usuario, nombre: dto.nombre, rol: dto.rol, perfilId, passwordHash: await bcrypt.hash(dto.password, 10) },
      select: campos,
    });
  }

  @Patch(':id')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarUsuarioDto,
    @UsuarioActual() yo: UsuarioSesion,
  ) {
    if (id === yo.id && (dto.activo === false || (dto.rol && dto.rol !== Rol.ADMIN))) {
      throw new BadRequestException('No puedes desactivarte ni quitarte el rol de administrador');
    }
    const antes = await this.prisma.usuario.findUnique({ where: { id }, select: { rol: true, perfilId: true, perfil: { select: { nombre: true } } } });
    if (!antes) throw new NotFoundException('Usuario no encontrado');
    const { password, perfilId: pedido, ...resto } = dto;
    const rol = dto.rol ?? antes.rol;
    const perfilId = rol === Rol.ADMIN ? null : await this.perfilValido(pedido ?? antes.perfilId ?? undefined);

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.usuario.update({
        where: { id },
        data: { ...resto, perfilId, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
        select: campos,
      });
      if (rol !== antes.rol || perfilId !== antes.perfilId) {
        const nombre = (r: Rol, p?: string | null) => (r === Rol.ADMIN ? 'Administrador' : (p ?? 'sin rol'));
        await tx.permisoHistorial.create({
          data: {
            usuarioId: id,
            accion: 'CAMBIAR_ROL',
            detalle: `${nombre(antes.rol, antes.perfil?.nombre)} → ${nombre(rol, u.perfil?.nombre)}`,
            hechoPorId: yo.id,
          },
        });
      }
      return u;
    });
  }

  /** Permisos de un usuario: los de su rol, sus cambios y el resultado. */
  @Get(':id/permisos')
  async permisosDe(@Param('id', ParseIntPipe) id: number) {
    const u = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        ...campos,
        perfil: { select: { id: true, nombre: true, permisos: true } },
        permisos: { select: { permiso: true, concedido: true, hasta: true, createdAt: true, dadoPor: { select: { nombre: true } } } },
      },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    const ahora = new Date();
    const { permisos, ...usuario } = u;
    return {
      usuario,
      catalogo: this.permisos.catalogo(),
      delRol: u.rol === Rol.ADMIN ? PERMISOS_ASIGNABLES : (u.perfil?.permisos ?? []).filter(esPermiso),
      cambios: permisos
        .filter((p) => !p.hasta || p.hasta > ahora)
        .map((p) => ({ permiso: p.permiso, concedido: p.concedido, hasta: p.hasta, desde: p.createdAt, dadoPor: p.dadoPor.nombre })),
      efectivos: await this.permisos.efectivos(id),
    };
  }

  /** Da, quita o devuelve a lo del rol un permiso del usuario. */
  @Put(':id/permisos/:permiso')
  async cambiarPermiso(
    @Param('id', ParseIntPipe) id: number,
    @Param('permiso') permiso: string,
    @Body() dto: CambiarPermisoDto,
    @UsuarioActual() yo: UsuarioSesion,
  ) {
    if (!esPermiso(permiso) || !PERMISOS_ASIGNABLES.includes(permiso)) throw new BadRequestException('Permiso desconocido');
    const u = await this.prisma.usuario.findUnique({ where: { id }, select: { rol: true } });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    if (u.rol === Rol.ADMIN) throw new BadRequestException('El administrador siempre tiene todos los permisos');
    const hasta = dto.estado !== 'ROL' && dto.hasta ? new Date(dto.hasta) : null;
    if (hasta && hasta <= new Date()) throw new BadRequestException('La fecha y hora de vencimiento ya pasó');

    await this.prisma.$transaction(async (tx) => {
      if (dto.estado === 'ROL') {
        await tx.permisoUsuario.deleteMany({ where: { usuarioId: id, permiso } });
      } else {
        const data = { concedido: dto.estado === 'DAR', hasta, dadoPorId: yo.id, createdAt: new Date() };
        await tx.permisoUsuario.upsert({
          where: { usuarioId_permiso: { usuarioId: id, permiso } },
          create: { usuarioId: id, permiso, ...data },
          update: data,
        });
      }
      await tx.permisoHistorial.create({
        data: { usuarioId: id, permiso, accion: ACCION[dto.estado], hasta, hechoPorId: yo.id },
      });
    });
    return this.permisosDe(id);
  }

  /** Quién dio o quitó permisos a este usuario, y cuándo. */
  @Get(':id/historial-permisos')
  async historial(@Param('id', ParseIntPipe) id: number) {
    const filas = await this.prisma.permisoHistorial.findMany({
      where: { usuarioId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { hechoPor: { select: { nombre: true } } },
    });
    return filas.map((h) => ({
      id: h.id,
      fecha: h.createdAt,
      accion: h.accion,
      permiso: h.permiso,
      nombrePermiso: h.permiso && esPermiso(h.permiso) ? PERMISOS[h.permiso].nombre : h.permiso,
      hasta: h.hasta,
      detalle: h.detalle,
      hechoPor: h.hechoPor.nombre,
    }));
  }

  private async perfilValido(perfilId?: number) {
    if (!perfilId) throw new BadRequestException('Elige el rol del usuario');
    if (!(await this.prisma.perfil.findUnique({ where: { id: perfilId } }))) throw new BadRequestException('Ese rol no existe');
    return perfilId;
  }
}
