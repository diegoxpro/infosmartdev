import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { ActualizarPreciosDto, CrearProductoDto, EditarProductoDto } from './productos.dto';
import { FiltroProductos, ProductosService } from './productos.service';

@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Get()
  listar(
    @Query('q') q?: string,
    @Query('filtro') filtro?: FiltroProductos['filtro'],
    @Query('pagina') pagina?: string,
    @Query('porPagina') porPagina?: string,
  ) {
    return this.productos.listar({
      q,
      filtro,
      pagina: Math.max(1, Number(pagina) || 1),
      porPagina: Math.min(200, Math.max(1, Number(porPagina) || 50)),
    });
  }

  @Get('codigo/:codigo')
  porCodigo(@Param('codigo') codigo: string) {
    return this.productos.porCodigo(codigo);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.productos.obtener(id);
  }

  @Permiso('productos.editar')
  @Post()
  crear(@Body() dto: CrearProductoDto, @UsuarioActual() user: UsuarioSesion) {
    return this.productos.crear(dto, user.id);
  }

  @Permiso('productos.editar')
  @Patch('precios')
  actualizarPrecios(@Body() dto: ActualizarPreciosDto) {
    return this.productos.actualizarPrecios(dto);
  }

  @Permiso('productos.editar')
  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarProductoDto) {
    return this.productos.editar(id, dto);
  }
}
