import { AfectacionIgv } from '@prisma/client';
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

export class PresentacionDto {
  /** Sin id se crea; con id se actualiza. */
  @IsOptional() @IsInt() id?: number;
  @IsString() @MinLength(1) nombre: string;
  /** Unidades del producto que trae (cajetilla x20 = 20). */
  @IsNumber() @IsPositive() factor: number;
  @IsOptional() @IsString() codigoBarra?: string | null;
  @IsNumber() @Min(0) precio1: number;
  @IsOptional() @IsNumber() @Min(0) precio2?: number;
  @IsOptional() @IsNumber() @Min(0) precio3?: number;
}

export class ProductoDto {
  @IsOptional() @IsString() codigoBarra?: string | null;
  @IsString() @MinLength(2) nombre: string;
  @IsOptional() @IsInt() categoriaId?: number | null;
  @IsOptional() @IsInt() marcaId?: number | null;
  @IsOptional() @IsString() unidad?: string;
  @IsOptional() @IsNumber() @Min(0) costo?: number;
  @IsNumber() @Min(0) precio1: number;
  @IsOptional() @IsNumber() @Min(0) precio2?: number;
  @IsOptional() @IsNumber() @Min(0) precio3?: number;
  @IsOptional() @IsNumber() @Min(0) margen1?: number | null;
  @IsOptional() @IsNumber() @Min(0) margen2?: number | null;
  @IsOptional() @IsNumber() @Min(0) margen3?: number | null;
  @IsOptional() @IsNumber() @Min(0) stockMinimo?: number;
  @IsOptional() @IsEnum(AfectacionIgv) afectacionIgv?: AfectacionIgv;
  @IsOptional() @IsBoolean() controlaVencimiento?: boolean;
  /** Fecha en que vence el stock del producto (aaaa-mm-dd). Solo si controla vencimiento. */
  @IsOptional() @IsDateString() fechaVencimiento?: string | null;
  @IsOptional() @IsBoolean() activo?: boolean;
  /** Lista completa: las que no vengan se desactivan. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PresentacionDto)
  presentaciones?: PresentacionDto[];
}

export class CrearProductoDto extends ProductoDto {
  @IsOptional() @IsNumber() @Min(0) stockInicial?: number;
}

export class EditarProductoDto extends ProductoDto {
  @IsOptional() @IsString() @MinLength(2) declare nombre: string;
  @IsOptional() @IsNumber() @Min(0) declare precio1: number;
  /** Al guardar se borra la marca de revisión de la importación. */
  @IsOptional() @IsBoolean() revisado?: boolean;
}

export class PrecioItemDto {
  @IsInt() productoId: number;
  /** Si viene, los precios son de esa presentación. */
  @IsOptional() @IsInt() presentacionId?: number;
  @IsOptional() @IsNumber() @Min(0) precio1?: number;
  @IsOptional() @IsNumber() @Min(0) precio2?: number;
  @IsOptional() @IsNumber() @Min(0) precio3?: number;
}

export class ActualizarPreciosDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PrecioItemDto)
  items: PrecioItemDto[];
}
