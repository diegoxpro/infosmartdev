import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { EstadoVenta, TipoComprobante } from '@prisma/client';
import { UsuarioActual, UsuarioSesion, Permiso } from '../auth/decorators';
import { AnularVentaDto, CrearVentaDto, EditarVentaDto } from './ventas.dto';
import { VentasService } from './ventas.service';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Permiso('ventas.ver')
  @Get()
  listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('cajaId') cajaId?: string,
    @Query('tipo') tipo?: TipoComprobante,
    @Query('estado') estado?: EstadoVenta,
  ) {
    return this.ventas.listar({ desde, hasta, cajaId: cajaId ? Number(cajaId) : undefined, tipo, estado });
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.ventas.obtener(id);
  }

  @Permiso('ventas.vender')
  @Post()
  crear(@Body() dto: CrearVentaDto, @UsuarioActual() u: UsuarioSesion) {
    return this.ventas.crear(dto, u);
  }

  @Permiso('ventas.editar')
  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarVentaDto, @UsuarioActual() u: UsuarioSesion) {
    return this.ventas.editar(id, dto, u);
  }

  @Permiso('ventas.anular')
  @Post(':id/anular')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularVentaDto, @UsuarioActual() u: UsuarioSesion) {
    return this.ventas.anular(id, dto, u);
  }
}
