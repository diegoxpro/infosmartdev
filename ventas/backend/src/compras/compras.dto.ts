import { CondicionPago, MedioPago, OrigenGasto, TipoDocumentoCompra } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CompraItemDto {
  @IsInt() productoId: number;
  /** Si viene, cantidad y costo son de esa presentación (caja, paquete…) y entran cantidad × factor unidades. */
  @IsOptional() @IsInt() presentacionId?: number;
  @IsNumber() @IsPositive() cantidad: number;
  @IsNumber() @Min(0) costoUnitario: number;
  @IsOptional() @IsString() codigoLote?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
}

export class CrearCompraDto {
  @IsInt() proveedorId: number;
  @IsEnum(TipoDocumentoCompra) tipoDocumento: TipoDocumentoCompra;
  @IsString() @MinLength(1) serie: string;
  @IsString() @MinLength(1) numero: string;
  @IsDateString() fechaEmision: string;
  @IsEnum(CondicionPago) condicion: CondicionPago;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  /** Medio con el que se pagó una compra al contado. */
  @IsOptional() @IsEnum(MedioPago) medioPago?: MedioPago;
  /** De dónde sale el pago al contado: del acumulado (por defecto) o de la caja del día. */
  @IsOptional() @IsEnum(OrigenGasto) origenPago?: OrigenGasto;
  @IsOptional() @IsString() observacion?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CompraItemDto)
  items: CompraItemDto[];
}

export class PagoDto {
  @IsNumber() @IsPositive() monto: number;
  @IsEnum(MedioPago) medioPago: MedioPago;
  @IsOptional() @IsString() numeroOperacion?: string;
  @IsOptional() @IsString() observacion?: string;
  /** De dónde sale el dinero: del acumulado (por defecto) o de la caja del día (solo efectivo). */
  @IsOptional() @IsEnum(OrigenGasto) origen?: OrigenGasto;
  /** Antiguo: equivale a origen CAJA. */
  @IsOptional() @IsBoolean() desdeCaja?: boolean;
}

export class AnularDto {
  @IsString() @MinLength(3) motivo: string;
}
