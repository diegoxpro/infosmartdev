import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ModoSunat } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Permiso } from '../auth/decorators';
import { ConfiguracionService } from './configuracion.service';

class ActualizarConfiguracionDto {
  @IsOptional() @IsString() empresaNombre?: string;
  @IsOptional() @Matches(/^\d{11}$/, { message: 'El RUC tiene 11 dígitos' }) empresaRuc?: string;
  @IsOptional() @IsString() empresaDireccion?: string;
  @IsOptional() @IsBoolean() permitirVentaSinStock?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) margen1?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) margen2?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) margen3?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10) redondeoPrecio?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) diasAvisoVencimiento?: number;
  @IsOptional() @IsNumber() @Min(0) montoInicialCaja?: number;
  @IsOptional() @IsString() mensajeTicket?: string;
  @IsOptional() @IsString() backupCarpeta?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Hora en formato HH:MM' }) backupHora?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) backupConservar?: number;
  @IsOptional() @IsString() pgDumpRuta?: string;
  @IsOptional() @IsString() empresaRazonSocial?: string;
  @IsOptional() @Matches(/^\d{6}$/, { message: 'El ubigeo tiene 6 dígitos' }) empresaUbigeo?: string;
  @IsOptional() @IsString() empresaDepartamento?: string;
  @IsOptional() @IsString() empresaProvincia?: string;
  @IsOptional() @IsString() empresaDistrito?: string;
  @IsOptional() @Matches(/^\d{4}$/, { message: 'Código de establecimiento de 4 dígitos' }) codigoEstablecimiento?: string;
  @IsOptional() @IsEnum(ModoSunat) sunatModo?: ModoSunat;
  /** Texto vacío lo borra. */
  @IsOptional() @IsString() consultaDocToken?: string;
}

/** El token de consulta DNI/RUC no sale del servidor: solo se informa si está puesto. */
function publica<T extends { consultaDocToken: string | null }>({ consultaDocToken, ...resto }: T) {
  return { ...resto, consultaDocConfigurada: !!consultaDocToken };
}

@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly config: ConfiguracionService) {}

  @Get()
  async obtener() {
    return publica(await this.config.obtener());
  }

  @Permiso('config.preferencias')
  @Patch()
  async actualizar(@Body() dto: ActualizarConfiguracionDto) {
    if (dto.consultaDocToken !== undefined) dto.consultaDocToken = (dto.consultaDocToken.trim() || null) as string;
    return publica(await this.config.actualizar(dto));
  }
}
