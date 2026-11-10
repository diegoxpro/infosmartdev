import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISO, UsuarioSesion } from './decorators';
import { ClavePermiso, PERMISOS } from './permisos';
import { PermisosService } from './permisos.service';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const pedidos = this.reflector.getAllAndOverride<ClavePermiso[]>(PERMISO, [ctx.getHandler(), ctx.getClass()]);
    if (!pedidos?.length) return true;
    const user: UsuarioSesion | undefined = ctx.switchToHttp().getRequest().user;
    if (user && (await this.permisos.tieneAlguno(user, pedidos))) return true;
    const nombre = PERMISOS[pedidos[0]].nombre.toLowerCase();
    throw new ForbiddenException(`No tienes permiso para: ${nombre}`);
  }
}
