import {
  Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Logger, NotFoundException, Param,
  ParseEnumPipe, Post, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Producto } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AjustesService } from '../ajustes/ajustes.service';
import { config } from '../config';
import { accesoEmpresa } from '../empresas/reglas';
import { PrismaService } from '../prisma/prisma.service';
import { RespaldosService } from '../respaldos/respaldos.service';

@Injectable()
class ClaveInternaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const recibida = Buffer.from(String(ctx.switchToHttp().getRequest().headers['x-infosmart-clave'] ?? ''));
    const esperada = Buffer.from(config.claveInterna);
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw new UnauthorizedException();
    return true;
  }
}

class ReporteDto {
  @IsOptional() @IsBoolean() aprovisionado?: boolean;
  // El administrador ya cambió la clave temporal en el producto
  @IsOptional() @IsBoolean() claveCambiada?: boolean;
}

class RespaldarDto {
  @IsOptional() @IsString() @MaxLength(40) motivo?: string;
}

// API que consultan los backends de ventas y lavadero para saber, a partir del subdominio,
// qué base de datos usar, si la empresa puede entrar, con qué administrador aprovisionarla
// y sus credenciales (SUNAT, consulta DNI/RUC), que solo se administran desde el panel.
@Controller('interno')
@UseGuards(ClaveInternaGuard)
export class InternoController {
  private readonly log = new Logger('Interno');

  constructor(private prisma: PrismaService, private ajustes: AjustesService, private respaldos: RespaldosService) {}

  private async buscar(subdominio: string, producto: Producto) {
    const pe = await this.prisma.productoEmpresa.findFirst({
      where: { producto, empresa: { subdominio: subdominio.toLowerCase() } },
      include: { empresa: { include: { plan: true } }, ajustes: true },
    });
    if (!pe) throw new NotFoundException('Empresa o producto no encontrado');
    return pe;
  }

  @Get('empresas/:subdominio/:producto')
  async resolver(
    @Param('subdominio') subdominio: string,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
  ) {
    const pe = await this.buscar(subdominio, producto);
    const e = pe.empresa;
    return {
      empresa: { id: e.id, razonSocial: e.razonSocial, ruc: e.ruc, subdominio: e.subdominio, estado: e.estado, venceEl: e.venceEl },
      plan: { codigo: e.plan.codigo, maxUsuarios: e.plan.maxUsuarios },
      acceso: accesoEmpresa(e.estado, e.venceEl),
      baseDatos: pe.baseDatos,
      aprovisionado: pe.aprovisionado,
      admin: { usuario: pe.adminUsuario, claveHash: pe.adminClaveHash, claveTemporal: pe.adminClaveTemporal },
      ajustes: this.ajustes.privado(pe.ajustes),
    };
  }

  /** Empresas con este producto que pueden entrar hoy (para las tareas programadas del producto). */
  @Get('productos/:producto/empresas')
  async activas(@Param('producto', new ParseEnumPipe(Producto)) producto: Producto) {
    const pes = await this.prisma.productoEmpresa.findMany({
      where: { producto, aprovisionado: true, empresa: { estado: { not: 'SUSPENDIDA' }, venceEl: { gte: new Date() } } },
      select: { empresa: { select: { subdominio: true } } },
    });
    return pes.map((p) => ({ subdominio: p.empresa.subdominio }));
  }

  @Post('empresas/:subdominio/:producto/reporte')
  async reporte(
    @Param('subdominio') subdominio: string,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
    @Body() dto: ReporteDto,
  ) {
    const pe = await this.buscar(subdominio, producto);
    await this.prisma.productoEmpresa.update({
      where: { id: pe.id },
      data: {
        ...(dto.aprovisionado !== undefined && { aprovisionado: dto.aprovisionado }),
        ...(dto.claveCambiada && { adminClaveTemporal: false }),
      },
    });
    if (dto.aprovisionado && !pe.aprovisionado) {
      await this.prisma.evento.create({ data: { empresaId: pe.empresaId, tipo: 'APROVISIONADA', detalle: producto } });
    }
    return { ok: true };
  }

  /** El producto pide un backup (p. ej. al cerrar caja). Responde enseguida; el backup corre en la cola. */
  @Post('empresas/:subdominio/:producto/respaldar')
  async respaldar(
    @Param('subdominio') subdominio: string,
    @Param('producto', new ParseEnumPipe(Producto)) producto: Producto,
    @Body() dto: RespaldarDto,
  ) {
    const pe = await this.buscar(subdominio, producto);
    if (!pe.aprovisionado) return { ok: false };
    this.respaldos.encolar(pe.id, (dto.motivo ?? 'producto').slice(0, 40)).catch((e) => this.log.error(e.message));
    return { ok: true };
  }
}
