import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { MedioPago, TipoMovimientoCaja } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { UsuarioActual, UsuarioSesion, Permiso } from '../auth/decorators';
import { CajaService, DENOMINACIONES } from './caja.service';

class AbrirDto {
  @IsOptional() @IsNumber() @Min(0) montoInicial?: number;
}

class MovimientoDto {
  @IsEnum(TipoMovimientoCaja) tipo: TipoMovimientoCaja;
  @IsOptional() @IsString() concepto?: string;
  @IsNumber() @IsPositive() monto: number;
  /** Solo para ventas sin comprobante; por defecto efectivo. */
  @IsOptional() @IsEnum(MedioPago) medioPago?: MedioPago;
}

class CerrarDto {
  /** Cantidad de billetes/monedas por denominación: { "200": 1, "0.5": 4 }. */
  @IsObject() conteo: Record<string, number>;
  /** Total que muestra la app o el voucher de cada medio digital: { "YAPE": 45.5 }. */
  @IsOptional() @IsObject() digital?: Record<string, number>;
  @IsOptional() @IsString() observacion?: string;
  /** Cerrar aunque no cuadre: guarda la diferencia y exige una observación. */
  @IsOptional() @IsBoolean() sinCuadrar?: boolean;
}

@Controller('caja')
export class CajaController {
  constructor(private readonly caja: CajaService) {}

  @Get('actual')
  actual() {
    return this.caja.actual();
  }

  @Get('denominaciones')
  denominaciones() {
    return DENOMINACIONES;
  }

  @Get('historial')
  historial() {
    return this.caja.historial();
  }

  @Get(':id')
  detalle(@Param('id', ParseIntPipe) id: number) {
    return this.caja.detalle(id);
  }

  @Permiso('ventas.caja')
  @Post('abrir')
  abrir(@Body() dto: AbrirDto, @UsuarioActual() u: UsuarioSesion) {
    return this.caja.abrir(u.id, dto.montoInicial);
  }

  @Permiso('ventas.caja')
  @Post('movimientos')
  movimiento(@Body() dto: MovimientoDto, @UsuarioActual() u: UsuarioSesion) {
    return this.caja.movimiento(u.id, dto.tipo, dto.concepto, dto.monto, dto.medioPago);
  }

  @Permiso('ventas.caja')
  @Post('cerrar')
  cerrar(@Body() dto: CerrarDto, @UsuarioActual() u: UsuarioSesion) {
    return this.caja.cerrar(u.id, dto.conteo, dto.digital, dto.observacion, dto.sinCuadrar === true);
  }
}
