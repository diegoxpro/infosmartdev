import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClavePermiso, esPermiso, PERMISOS, PERMISOS_ASIGNABLES, TODOS_LOS_PERMISOS } from './permisos';

export interface PermisoEfectivo {
  permiso: ClavePermiso;
  /** De dónde sale: del rol, o dado aparte al usuario. */
  origen: 'ROL' | 'USUARIO';
  /** Si es temporal, hasta cuándo vale. */
  hasta: Date | null;
}

export interface CambioUsuario {
  permiso: string;
  concedido: boolean;
  hasta: Date | null;
}

const vigente = (hasta: Date | null, ahora: Date) => !hasta || hasta > ahora;

/**
 * Resuelve qué puede hacer cada usuario: el administrador tiene todo; el resto,
 * lo de su rol más los permisos que se le dieron y menos los que se le quitaron
 * (los temporales dejan de contar al vencer). Se consulta en cada pedido para que
 * un cambio o un vencimiento se note al instante.
 */
@Injectable()
export class PermisosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Combina rol y cambios del usuario. Exportada para probarla sin base de datos. */
  static combinar(esAdmin: boolean, delRol: string[], cambios: CambioUsuario[], ahora = new Date()): PermisoEfectivo[] {
    if (esAdmin) return TODOS_LOS_PERMISOS.map((permiso) => ({ permiso, origen: 'ROL', hasta: null }));
    const mapa = new Map<ClavePermiso, PermisoEfectivo>();
    for (const p of delRol) {
      if (esPermiso(p) && PERMISOS_ASIGNABLES.includes(p)) mapa.set(p, { permiso: p, origen: 'ROL', hasta: null });
    }
    for (const c of cambios) {
      if (!esPermiso(c.permiso) || !PERMISOS_ASIGNABLES.includes(c.permiso) || !vigente(c.hasta, ahora)) continue;
      if (c.concedido) {
        if (!mapa.has(c.permiso)) mapa.set(c.permiso, { permiso: c.permiso, origen: 'USUARIO', hasta: c.hasta });
      } else {
        mapa.delete(c.permiso);
      }
    }
    return TODOS_LOS_PERMISOS.filter((p) => mapa.has(p)).map((p) => mapa.get(p)!);
  }

  async efectivos(usuarioId: number): Promise<PermisoEfectivo[]> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rol: true, activo: true, perfil: { select: { permisos: true } }, permisos: { select: { permiso: true, concedido: true, hasta: true } } },
    });
    if (!u || !u.activo) return [];
    return PermisosService.combinar(u.rol === 'ADMIN', u.perfil?.permisos ?? [], u.permisos);
  }

  async permisosDe(user: { id: number }): Promise<Set<ClavePermiso>> {
    return new Set((await this.efectivos(user.id)).map((p) => p.permiso));
  }

  async tiene(user: { id: number }, permiso: ClavePermiso) {
    return (await this.permisosDe(user)).has(permiso);
  }

  async tieneAlguno(user: { id: number }, permisos: ClavePermiso[]) {
    const mios = await this.permisosDe(user);
    return permisos.some((p) => mios.has(p));
  }

  /** Catálogo para la pantalla de roles y permisos. */
  catalogo() {
    return PERMISOS_ASIGNABLES.map((clave) => ({ clave, grupo: PERMISOS[clave].grupo, nombre: PERMISOS[clave].nombre }));
  }
}
