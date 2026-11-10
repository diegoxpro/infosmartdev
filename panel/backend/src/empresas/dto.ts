import { Producto } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const minusculas = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CrearEmpresaDto {
  @Transform(recortar) @IsString() @Length(2, 200) razonSocial: string;
  @Transform(recortar) @IsString() ruc: string;
  @Transform(minusculas) @IsString() subdominio: string;
  @IsArray() @ArrayMinSize(1) @IsEnum(Producto, { each: true }) productos: Producto[];
  @IsString() plan: string;
  @Transform(minusculas) @Matches(/^[a-z0-9._-]{3,30}$/, { message: 'Usuario admin: 3 a 30 letras, números, punto o guion' })
  adminUsuario: string;
  @IsOptional() @Transform(recortar) @IsString() contacto?: string;
  @IsOptional() @Transform(recortar) @IsString() telefono?: string;
  @IsOptional() @Transform(recortar) @IsEmail() correo?: string;
  @IsOptional() @IsString() notas?: string;
}

export class EditarEmpresaDto {
  @IsOptional() @Transform(recortar) @IsString() @Length(2, 200) razonSocial?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @Transform(recortar) @IsString() contacto?: string;
  @IsOptional() @Transform(recortar) @IsString() telefono?: string;
  @IsOptional() @Transform(recortar) @IsEmail() correo?: string;
  @IsOptional() @IsString() notas?: string;
}

export class CambiarEstadoDto {
  @IsIn(['PRUEBA', 'ACTIVA', 'SUSPENDIDA']) estado: 'PRUEBA' | 'ACTIVA' | 'SUSPENDIDA';
  @IsOptional() @IsString() motivo?: string;
}

export class RenovarDto {
  // Meses a sumar desde el vencimiento actual (o desde hoy si ya venció)
  @IsOptional() @IsInt() @Min(1) meses?: number;
  // O una fecha exacta
  @IsOptional() @IsDateString() hasta?: string;
}

export class AgregarProductoDto {
  @IsEnum(Producto) producto: Producto;
  @Transform(minusculas) @Matches(/^[a-z0-9._-]{3,30}$/) adminUsuario: string;
}
