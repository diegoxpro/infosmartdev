import { Body, Controller, ForbiddenException, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { OrigenGasto } from '@prisma/client';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { PermisosService } from '../auth/permisos.service';
import { AnularGastoDto, CategoriaDto, EditarGastoDto, GastoDto, GastoFijoDto } from './gastos.dto';
import { GastosService } from './gastos.service';

@Controller('gastos')
export class GastosController {
  constructor(
    private readonly gastos: GastosService,
    private readonly permisos: PermisosService,
  ) {}

  @Permiso('gastos.registrar', 'gastos.configurar', 'ventas.caja')
  @Get('categorias')
  categorias() {
    return this.gastos.categorias();
  }

  @Permiso('gastos.configurar')
  @Post('categorias')
  crearCategoria(@Body() dto: CategoriaDto) {
    return this.gastos.crearCategoria(dto);
  }

  @Permiso('gastos.configurar')
  @Put('categorias/:id')
  editarCategoria(@Param('id', ParseIntPipe) id: number, @Body() dto: CategoriaDto) {
    return this.gastos.editarCategoria(id, dto);
  }

  @Permiso('gastos.configurar')
  @Delete('categorias/:id')
  eliminarCategoria(@Param('id', ParseIntPipe) id: number) {
    return this.gastos.eliminarCategoria(id);
  }

  @Permiso('gastos.registrar', 'gastos.configurar')
  @Get('fijos')
  fijos() {
    return this.gastos.gastosFijos();
  }

  /** Lo ve cualquiera con sesión: el aviso de Inicio. */
  @Get('fijos/avisos')
  avisos() {
    return this.gastos.avisos();
  }

  @Permiso('gastos.configurar')
  @Post('fijos')
  crearFijo(@Body() dto: GastoFijoDto) {
    return this.gastos.guardarGastoFijo(dto);
  }

  @Permiso('gastos.configurar')
  @Put('fijos/:id')
  editarFijo(@Param('id', ParseIntPipe) id: number, @Body() dto: GastoFijoDto) {
    return this.gastos.guardarGastoFijo(dto, id);
  }

  @Permiso('gastos.configurar')
  @Delete('fijos/:id')
  eliminarFijo(@Param('id', ParseIntPipe) id: number) {
    return this.gastos.eliminarGastoFijo(id);
  }

  @Permiso('gastos.registrar', 'ventas.caja')
  @Get('trabajadores')
  trabajadores() {
    return this.gastos.trabajadores();
  }

  @Permiso('gastos.registrar', 'gastos.anular')
  @Get()
  listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('anulados') anulados?: string,
  ) {
    return this.gastos.listar({ desde, hasta, categoriaId: categoriaId ? Number(categoriaId) : undefined, anulados: anulados === '1' });
  }

  /** Gastos del acumulado: gastos.registrar. Gasto de emergencia desde la caja del día: también ventas.caja. */
  @Permiso('gastos.registrar', 'ventas.caja')
  @Post()
  async registrar(@Body() dto: GastoDto, @UsuarioActual() u: UsuarioSesion) {
    const necesita = dto.origen === OrigenGasto.CAJA ? 'ventas.caja' : 'gastos.registrar';
    if (!(await this.permisos.tiene(u, necesita))) {
      throw new ForbiddenException(dto.origen === OrigenGasto.CAJA ? 'No tienes permiso para sacar gastos de la caja' : 'No tienes permiso para registrar gastos del acumulado');
    }
    return this.gastos.registrar(dto, u.id);
  }

  @Permiso('gastos.anular')
  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarGastoDto) {
    return this.gastos.editar(id, dto);
  }

  @Permiso('gastos.anular')
  @Post(':id/anular')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularGastoDto, @UsuarioActual() u: UsuarioSesion) {
    return this.gastos.anular(id, dto, u.id);
  }
}
