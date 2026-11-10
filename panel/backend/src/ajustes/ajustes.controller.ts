import { Body, Controller, Get, Param, ParseEnumPipe, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ModoSunat, Producto } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SuperadminGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AjustesService } from './ajustes.service';

class AjustesDto {
  @IsOptional() @IsEnum(ModoSunat) sunatModo?: ModoSunat;
  @IsOptional() @IsString() @MaxLength(30) solUsuario?: string;
  @IsOptional() @IsString() @MaxLength(100) solClave?: string;
  /** Texto vacío desactiva la consulta DNI/RUC */
  @IsOptional() @IsString() @MaxLength(500) consultaDocToken?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Hora en formato HH:MM' }) backupHora?: string;
  @IsOptional() @IsInt() @Min(1) @Max(90) backupConservar?: number;
}

class CertificadoDto {
  /** .pfx o .p12 en base64 */
  @IsString() @MaxLength(400_000) archivo: string;
  @IsString() clave: string;
}

@Controller('empresas/:id/productos/:producto/ajustes')
@UseGuards(SuperadminGuard)
export class AjustesController {
  constructor(private ajustes: AjustesService, private prisma: PrismaService) {}

  private evento(empresaId: number, tipo: string, detalle: string, usuario: string) {
    return this.prisma.evento.create({ data: { empresaId, tipo, detalle, usuario } });
  }

  @Get()
  obtener(@Param('id', ParseIntPipe) id: number, @Param('producto', new ParseEnumPipe(Producto)) producto: Producto) {
    return this.ajustes.obtener(id, producto);
  }

  @Patch()
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
    @Body() dto: AjustesDto,
    @Req() req: any,
  ) {
    const r = await this.ajustes.actualizar(id, producto, dto);
    // En el historial solo qué cambió, nunca los valores de las claves
    const cambios = Object.keys(dto).map((k) => (k === 'sunatModo' ? `SUNAT ${dto.sunatModo}` : k)).join(', ');
    await this.evento(id, 'AJUSTES', `${producto}: ${cambios}`, req.superadmin.usuario);
    return r;
  }

  @Post('certificado')
  async certificado(
    @Param('id', ParseIntPipe) id: number,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
    @Body() dto: CertificadoDto,
    @Req() req: any,
  ) {
    const r = await this.ajustes.cargarCertificado(id, producto, Buffer.from(dto.archivo, 'base64'), dto.clave);
    await this.evento(id, 'CERTIFICADO', `${producto}: ${r.certificado?.sujeto}`, req.superadmin.usuario);
    return r;
  }
}
