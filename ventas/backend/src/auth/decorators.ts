import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { ClavePermiso } from './permisos';

export const PUBLICO = 'publico';
export const PERMISO = 'permiso';

/** La ruta no requiere iniciar sesión. */
export const Publico = () => SetMetadata(PUBLICO, true);

/** La ruta exige al menos uno de estos permisos. */
export const Permiso = (...permisos: ClavePermiso[]) => SetMetadata(PERMISO, permisos);

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioSesion => ctx.switchToHttp().getRequest().user,
);
