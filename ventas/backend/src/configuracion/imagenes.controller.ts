import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseEnumPipe, Put, Res } from '@nestjs/common';
import { TipoImagen } from '@prisma/client';
import { IsBase64 } from 'class-validator';
import { Response } from 'express';
import { Publico, Permiso } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

class SubirImagenDto {
  @IsBase64({}, { message: 'La imagen no es válida' }) archivo!: string;
}

/** El navegador ya la reduce antes de subirla; esto es solo un tope. */
const MAX_BYTES = 700 * 1024;

/** Reconoce el formato por sus primeros bytes. No se acepta SVG porque puede llevar código. */
function tipoMime(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Logotipo de la tienda, favicon y logo de la boleta. */
@Controller('configuracion/imagenes')
export class ImagenesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Nombre de la tienda y versión de cada imagen (para el login, el menú y el ticket). */
  @Publico()
  @Get()
  async marca() {
    const [cfg, imagenes] = await Promise.all([
      this.prisma.configuracion.findUnique({ where: { id: 1 }, select: { empresaNombre: true } }),
      this.prisma.imagenTienda.findMany({ select: { tipo: true, updatedAt: true } }),
    ]);
    return {
      nombre: cfg?.empresaNombre ?? "CANDY'S MARKET",
      versiones: Object.fromEntries(Object.values(TipoImagen).map((t) => [t, imagenes.find((i) => i.tipo === t)?.updatedAt.getTime() ?? null])),
    };
  }

  @Publico()
  @Get(':tipo')
  async ver(@Param('tipo', new ParseEnumPipe(TipoImagen)) tipo: TipoImagen, @Res() res: Response) {
    const img = await this.prisma.imagenTienda.findUnique({ where: { tipo } });
    if (!img) throw new NotFoundException('No hay imagen cargada');
    // La URL lleva ?v=<versión>, así que el navegador puede guardarla; al cambiarla cambia la URL.
    res.set({ 'content-type': img.mime, 'cache-control': 'public, max-age=31536000', 'x-content-type-options': 'nosniff' });
    res.send(Buffer.from(img.datos));
  }

  @Permiso('config.preferencias')
  @Put(':tipo')
  async subir(@Param('tipo', new ParseEnumPipe(TipoImagen)) tipo: TipoImagen, @Body() dto: SubirImagenDto) {
    const datos = Buffer.from(dto.archivo, 'base64');
    if (datos.length > MAX_BYTES) throw new BadRequestException('La imagen pesa demasiado (máximo 700 KB)');
    const mime = tipoMime(datos);
    if (!mime) throw new BadRequestException('Formato no admitido: usa PNG, JPG o WEBP');
    await this.prisma.imagenTienda.upsert({ where: { tipo }, create: { tipo, mime, datos }, update: { mime, datos } });
    return this.marca();
  }

  @Permiso('config.preferencias')
  @Delete(':tipo')
  async quitar(@Param('tipo', new ParseEnumPipe(TipoImagen)) tipo: TipoImagen) {
    await this.prisma.imagenTienda.deleteMany({ where: { tipo } });
    return this.marca();
  }
}
