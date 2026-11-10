import { Body, Controller, Get, Header, Post, Query, StreamableFile } from '@nestjs/common';
import { IsBase64, IsIn, IsString, MaxLength } from 'class-validator';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { ImportacionService, ModoStock } from './importacion.service';

class ArchivoDto {
  @IsString() @MaxLength(200) nombre: string;
  /** Contenido del .xlsx o .csv en base64. */
  @IsBase64() archivo: string;
  @IsIn(['reemplazar', 'sumar']) modoStock: ModoStock;
}

@Permiso('productos.importar')
@Controller('importacion')
export class ImportacionController {
  constructor(private readonly importacion: ImportacionService) {}

  @Get('plantilla')
  @Header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async plantilla(@Query('conProductos') conProductos?: string) {
    const vacia = conProductos !== '1' && conProductos !== 'true';
    const nombre = vacia ? 'plantilla_productos.xlsx' : `productos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new StreamableFile(await this.importacion.plantilla(!vacia), { disposition: `attachment; filename="${nombre}"` });
  }

  /** Muestra qué se crearía o cambiaría, sin guardar nada. */
  @Post('revisar')
  revisar(@Body() dto: ArchivoDto) {
    return this.importacion.revisar(Buffer.from(dto.archivo, 'base64'), dto.nombre, dto.modoStock);
  }

  /** Guarda las filas sin error. Vuelve a revisar el archivo en el servidor. */
  @Post('importar')
  importar(@Body() dto: ArchivoDto, @UsuarioActual() user: UsuarioSesion) {
    return this.importacion.importar(Buffer.from(dto.archivo, 'base64'), dto.nombre, dto.modoStock, user.id);
  }
}
