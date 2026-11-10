import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { AnularDto, CrearCompraDto, PagoDto } from './compras.dto';
import { ComprasService } from './compras.service';

@Controller('compras')
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  @Permiso('compras.ver')
  @Get()
  listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('pendientes') pendientes?: string,
  ) {
    return this.compras.listar({
      desde,
      hasta,
      proveedorId: proveedorId ? Number(proveedorId) : undefined,
      pendientes: pendientes === '1' || pendientes === 'true',
    });
  }

  @Permiso('compras.ver')
  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.compras.obtener(id);
  }

  @Get(':id/sugerencias')
  sugerencias(@Param('id', ParseIntPipe) id: number) {
    return this.compras.sugerencias(id);
  }

  @Permiso('compras.registrar')
  @Post()
  crear(@Body() dto: CrearCompraDto, @UsuarioActual() user: UsuarioSesion) {
    return this.compras.crear(dto, user.id);
  }

  @Permiso('compras.pagar')
  @Post(':id/pagos')
  pagar(@Param('id', ParseIntPipe) id: number, @Body() dto: PagoDto, @UsuarioActual() user: UsuarioSesion) {
    return this.compras.pagar(id, dto, user.id);
  }

  @Permiso('compras.registrar')
  @Post(':id/anular')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularDto, @UsuarioActual() user: UsuarioSesion) {
    return this.compras.anular(id, dto, user.id);
  }
}
