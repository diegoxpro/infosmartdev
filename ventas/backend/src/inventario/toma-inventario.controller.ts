import { Body, Controller, Get, Headers, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Publico, Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { urlEntrada } from '../red/servidor-red';
import { AccionConteo, TomaInventarioService } from './toma-inventario.service';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

class ResolverDto {
  @IsIn(['SUMAR', 'REEMPLAZAR', 'DESCARTAR']) accion: AccionConteo;
}

class LoteDto {
  @Matches(FECHA) fecha: string;
  @IsNumber() @Min(0) cantidad: number;
}

class EditarItemDto {
  @IsNumber() @Min(0) cantidad: number;
  /** Detalle por fecha; la suma reemplaza a cantidad. Vacío = sin fechas. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => LoteDto) lotes?: LoteDto[];
}

class InhabilitarDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(5000) @IsInt({ each: true }) productoIds: number[];
}

class EntrarDto {
  @IsString() @MinLength(10) token: string;
  @IsString() @MinLength(2) @MaxLength(40) nombre: string;
}

class ConteoDto {
  @IsString() @MinLength(8) @MaxLength(64) clienteId: string;
  @Type(() => Number) @IsInt() productoId: number;
  @IsNumber() @Min(0) cantidad: number;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => LoteDto) lotes?: LoteDto[];
}

/** Pantalla "Realizar inventario" de la PC: contar, validar y cerrar. */
@Permiso('inventario.realizar')
@Controller('toma-inventario')
export class TomaInventarioController {
  constructor(private readonly svc: TomaInventarioService) {}

  @Get('actual')
  async actual() {
    const inv = await this.svc.actual();
    return { inventario: inv ? { ...inv, qr: urlEntrada(`/i/${inv.token}`) } : null };
  }

  /** La cajera (o el admin) cuenta desde la PC como un operador más. */
  @Post('contar-pc')
  contarPc(@UsuarioActual() user: UsuarioSesion) {
    return this.svc.operadorPc(user.id, user.nombre);
  }

  @Get('historial')
  historial() {
    return this.svc.historial();
  }

  @Post()
  async iniciar(@UsuarioActual() user: UsuarioSesion) {
    const inv = await this.svc.iniciar(user.id);
    return { ...inv, qr: urlEntrada(`/i/${inv.token}`) };
  }

  @Get(':id')
  detalle(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detalle(id);
  }

  @Get(':id/version')
  version(@Param('id', ParseIntPipe) id: number) {
    return this.svc.version(id);
  }

  @Get(':id/no-contados')
  noContados(@Param('id', ParseIntPipe) id: number) {
    return this.svc.noContados(id);
  }

  @Post(':id/finalizar')
  finalizar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.finalizar(id);
  }

  @Post(':id/reabrir')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  @Post(':id/cancelar')
  cancelar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.cancelar(id);
  }

  @Post(':id/validar')
  validar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() user: UsuarioSesion) {
    return this.svc.validar(id, user.id);
  }

  @Post('conteos/:id/resolver')
  resolver(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolverDto) {
    return this.svc.resolver(id, dto.accion);
  }

  @Patch('items/:id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarItemDto) {
    return this.svc.editarItem(id, dto.cantidad, dto.lotes);
  }

  @Post('inhabilitar')
  inhabilitar(@Body() dto: InhabilitarDto) {
    return this.svc.inhabilitar(dto.productoIds);
  }
}

/** Página del celular: entra con el token del QR, sin usuario del sistema. */
@Publico()
@Controller('inventario-movil')
export class InventarioMovilController {
  constructor(private readonly svc: TomaInventarioService) {}

  @Post('entrar')
  async entrar(@Body() dto: EntrarDto) {
    const op = await this.svc.entrar(dto.token, dto.nombre);
    return { token: op.token, nombre: op.nombre };
  }

  @Get('sesion')
  sesion(@Headers('x-operador') op?: string) {
    return this.svc.sesionMovil(op);
  }

  @Get('codigo/:codigo')
  porCodigo(@Headers('x-operador') op: string | undefined, @Param('codigo') codigo: string) {
    return this.svc.porCodigo(op, codigo);
  }

  @Get('buscar')
  buscar(@Headers('x-operador') op: string | undefined, @Query('q') q = '') {
    return this.svc.buscar(op, q);
  }

  @Get('producto/:id')
  producto(@Headers('x-operador') op: string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.svc.producto(op, id);
  }

  @Post('conteos')
  conteo(@Headers('x-operador') op: string | undefined, @Body() dto: ConteoDto) {
    return this.svc.registrarConteo(op, dto);
  }
}
