import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Permiso } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { SunatService } from './sunat.service';

class CertificadoDto {
  /** Archivo .pfx en base64 (se envía desde la pantalla de configuración). */
  @IsString() @MaxLength(200_000) archivo: string;
  @IsString() clave: string;
}

class SolDto {
  @IsOptional() @IsString() usuario?: string;
  @IsOptional() @IsString() clave?: string;
}

@Controller('sunat')
export class SunatController {
  constructor(
    private readonly sunat: SunatService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('estado')
  estado() {
    return this.sunat.estado();
  }

  @Permiso('config.sunat')
  @Post('certificado')
  async certificado(@Body() dto: CertificadoDto) {
    try {
      return await this.sunat.cargarCertificado(Buffer.from(dto.archivo, 'base64'), dto.clave);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Permiso('config.sunat')
  @Post('sol')
  sol(@Body() dto: SolDto) {
    return this.sunat.guardarSol(dto.usuario, dto.clave);
  }

  @Permiso('config.sunat')
  @Post('probar-beta')
  async probarBeta() {
    try {
      return await this.sunat.probarBeta();
    } catch (e) {
      throw new BadRequestException(`SUNAT beta: ${(e as Error).message}`);
    }
  }

  /** Envía ya lo pendiente (también corre solo cada 2 minutos). */
  @Post('enviar')
  async enviar() {
    await this.sunat.procesar();
    return this.sunat.estado();
  }

  @Permiso('ventas.sunat')
  @Post('ventas/:id/reenviar')
  async reenviar(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.venta.update({ where: { id }, data: { xmlFirmado: null } });
    await this.sunat.firmarVenta(id);
    await this.sunat.enviarVenta(id);
    return this.prisma.venta.findUniqueOrThrow({ where: { id } });
  }

  @Get('ventas/:id/xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async xml(@Param('id', ParseIntPipe) id: number) {
    const v = await this.prisma.venta.findUniqueOrThrow({ where: { id } });
    if (!v.xmlFirmado) throw new BadRequestException('Esta venta no tiene XML');
    return v.xmlFirmado;
  }
}
