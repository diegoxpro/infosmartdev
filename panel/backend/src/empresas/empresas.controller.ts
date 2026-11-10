import { Body, Controller, Get, Param, ParseEnumPipe, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Producto } from '@prisma/client';
import { SuperadminGuard } from '../auth/auth.guard';
import { AgregarProductoDto, CambiarEstadoDto, CrearEmpresaDto, EditarEmpresaDto, RenovarDto } from './dto';
import { EmpresasService } from './empresas.service';

@Controller()
@UseGuards(SuperadminGuard)
export class EmpresasController {
  constructor(private empresas: EmpresasService) {}

  @Get('resumen') resumen() { return this.empresas.resumen(); }
  @Get('planes') planes() { return this.empresas.planes(); }

  @Get('empresas')
  listar(@Query('buscar') buscar?: string) { return this.empresas.listar(buscar?.trim() || undefined); }

  @Get('empresas/:id')
  obtener(@Param('id', ParseIntPipe) id: number) { return this.empresas.obtener(id); }

  @Post('empresas')
  crear(@Body() dto: CrearEmpresaDto, @Req() req: any) { return this.empresas.crear(dto, req.superadmin.usuario); }

  @Patch('empresas/:id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarEmpresaDto, @Req() req: any) {
    return this.empresas.editar(id, dto, req.superadmin.usuario);
  }

  @Post('empresas/:id/estado')
  estado(@Param('id', ParseIntPipe) id: number, @Body() dto: CambiarEstadoDto, @Req() req: any) {
    return this.empresas.cambiarEstado(id, dto, req.superadmin.usuario);
  }

  @Post('empresas/:id/renovar')
  renovar(@Param('id', ParseIntPipe) id: number, @Body() dto: RenovarDto, @Req() req: any) {
    return this.empresas.renovar(id, dto, req.superadmin.usuario);
  }

  @Post('empresas/:id/productos')
  agregarProducto(@Param('id', ParseIntPipe) id: number, @Body() dto: AgregarProductoDto, @Req() req: any) {
    return this.empresas.agregarProducto(id, dto, req.superadmin.usuario);
  }

  @Post('empresas/:id/productos/:producto/restablecer-clave')
  restablecer(
    @Param('id', ParseIntPipe) id: number,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
    @Req() req: any,
  ) {
    return this.empresas.restablecerClave(id, producto, req.superadmin.usuario);
  }
}
