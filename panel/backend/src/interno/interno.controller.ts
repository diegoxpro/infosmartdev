import {
  Body, CanActivate, Controller, ExecutionContext, Get, Injectable, NotFoundException, Param,
  ParseEnumPipe, Post, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Producto } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { IsBoolean, IsOptional } from 'class-validator';
import { config } from '../config';
import { accesoEmpresa } from '../empresas/reglas';
import { PrismaService } from '../prisma/prisma.service';

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

// API que consultan los backends de ventas y lavadero para saber, a partir del subdominio,
// qué base de datos usar, si la empresa puede entrar y con qué administrador aprovisionarla.
@Controller('interno/empresas')
@UseGuards(ClaveInternaGuard)
export class InternoController {
  constructor(private prisma: PrismaService) {}

  private async buscar(subdominio: string, producto: Producto) {
    const pe = await this.prisma.productoEmpresa.findFirst({
      where: { producto, empresa: { subdominio: subdominio.toLowerCase() } },
      include: { empresa: { include: { plan: true } } },
    });
    if (!pe) throw new NotFoundException('Empresa o producto no encontrado');
    return pe;
  }

  @Get(':subdominio/:producto')
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
    };
  }

  @Post(':subdominio/:producto/reporte')
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
    return { ok: true };
  }
}
