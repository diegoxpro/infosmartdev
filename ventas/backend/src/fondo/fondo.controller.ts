import { Body, Controller, Get, Post } from '@nestjs/common';
import { CuentaFondo } from '@prisma/client';
import { IsEnum, IsNumber, IsObject, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { DENOMINACIONES_FONDO, FondoService } from './fondo.service';

class RetiroDto {
  @IsEnum(CuentaFondo) cuenta: CuentaFondo;
  @IsNumber() @IsPositive() monto: number;
  @IsString() concepto: string;
}

class TraspasoDto {
  /** Cuenta de la que sale; entra a la otra. */
  @IsEnum(CuentaFondo) desde: CuentaFondo;
  @IsNumber() @IsPositive() monto: number;
  @IsOptional() @IsString() concepto?: string;
}

class ConteoDto {
  /** Cantidad de billetes/monedas por denominación: { "200": 1, "0.5": 4 }. */
  @IsObject() conteo: Record<string, number>;
  /** Saldo que muestra la app de Yape. */
  @IsNumber() @Min(0) yape: number;
  @IsOptional() @IsString() observacion?: string;
}

@Controller('acumulado')
export class FondoController {
  constructor(private readonly fondo: FondoService) {}

  @Permiso('gastos.registrar', 'acumulado.contar', 'acumulado.retirar', 'compras.pagar')
  @Get()
  resumen() {
    return this.fondo.resumen();
  }

  @Permiso('gastos.registrar', 'acumulado.contar', 'acumulado.retirar', 'compras.pagar', 'compras.registrar')
  @Get('saldos')
  saldos() {
    return this.fondo.saldos();
  }

  @Get('denominaciones')
  denominaciones() {
    return DENOMINACIONES_FONDO;
  }

  @Permiso('gastos.registrar', 'acumulado.contar', 'acumulado.retirar')
  @Get('conteos')
  conteos() {
    return this.fondo.conteos();
  }

  @Permiso('acumulado.contar')
  @Post('conteos')
  contar(@Body() dto: ConteoDto, @UsuarioActual() u: UsuarioSesion) {
    return this.fondo.contar(u.id, dto.conteo, dto.yape, dto.observacion);
  }

  @Permiso('acumulado.retirar')
  @Post('retiros')
  retiro(@Body() dto: RetiroDto, @UsuarioActual() u: UsuarioSesion) {
    return this.fondo.retiro(u.id, dto.cuenta, dto.monto, dto.concepto);
  }

  @Permiso('acumulado.retirar')
  @Post('traspasos')
  traspaso(@Body() dto: TraspasoDto, @UsuarioActual() u: UsuarioSesion) {
    return this.fondo.traspaso(u.id, dto.desde, dto.monto, dto.concepto);
  }
}
