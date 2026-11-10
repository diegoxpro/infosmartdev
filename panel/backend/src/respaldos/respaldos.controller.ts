import { Controller, Get, Param, ParseEnumPipe, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common';
import { Producto } from '@prisma/client';
import type { Response } from 'express';
import { basename } from 'path';
import { SuperadminGuard } from '../auth/auth.guard';
import { AjustesService } from '../ajustes/ajustes.service';
import { RespaldosService } from './respaldos.service';

@Controller()
@UseGuards(SuperadminGuard)
export class RespaldosController {
  constructor(private respaldos: RespaldosService, private ajustes: AjustesService) {}

  @Get('empresas/:id/productos/:producto/respaldos')
  listar(@Param('id', ParseIntPipe) id: number, @Param('producto', new ParseEnumPipe(Producto)) producto: Producto) {
    return this.respaldos.listar(id, producto);
  }

  @Post('empresas/:id/productos/:producto/respaldos')
  async hacer(@Param('id', ParseIntPipe) id: number, @Param('producto', new ParseEnumPipe(Producto)) producto: Producto) {
    const pe = await this.ajustes.productoEmpresa(id, producto);
    await this.respaldos.encolar(pe.id, 'manual');
    return this.respaldos.listar(id, producto);
  }

  @Get('respaldos/:id/descargar')
  async descargar(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const archivo = await this.respaldos.archivo(id);
    res.download(archivo, basename(archivo));
  }
}
