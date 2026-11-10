import { MedioPago, OrigenGasto } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, Min, MinLength } from 'class-validator';

export class CategoriaDto {
  @IsString() @MinLength(2) nombre: string;
  @IsOptional() @IsBoolean() pideTrabajador?: boolean;
  @IsOptional() @IsBoolean() activo?: boolean;
}

export class GastoFijoDto {
  @IsString() @MinLength(2) nombre: string;
  @IsInt() categoriaId: number;
  @IsInt() @Min(1) @Max(31) diaPago: number;
  @IsOptional() @IsNumber() @Min(0) monto?: number | null;
  @IsOptional() @IsString() trabajador?: string | null;
  @IsOptional() @IsBoolean() activo?: boolean;
}

export class GastoDto {
  @IsInt() categoriaId: number;
  @IsString() concepto: string;
  @IsNumber() @IsPositive() monto: number;
  @IsEnum(OrigenGasto) origen: OrigenGasto;
  @IsOptional() @IsEnum(MedioPago) medioPago?: MedioPago;
  @IsOptional() @IsString() numeroOperacion?: string;
  @IsOptional() @IsString() trabajador?: string;
  @IsOptional() @IsString() nota?: string;
  /** Pago de un gasto fijo: qué gasto y de qué mes ("2026-11"). */
  @IsOptional() @IsInt() gastoFijoId?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) periodo?: string;
}

/** Solo se corrige lo que no mueve dinero; para cambiar el monto u origen se anula y se registra otro. */
export class EditarGastoDto {
  @IsOptional() @IsInt() categoriaId?: number;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsString() trabajador?: string | null;
  @IsOptional() @IsString() nota?: string | null;
}

export class AnularGastoDto {
  @IsString() @MinLength(3) motivo: string;
}
