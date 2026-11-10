import { PERMISOS_ASIGNABLES, TODOS_LOS_PERMISOS } from './permisos';
import { PermisosService } from './permisos.service';

const combinar = PermisosService.combinar;
const ahora = new Date('2026-11-07T12:00:00-05:00');
const claves = (r: ReturnType<typeof combinar>) => r.map((p) => p.permiso);

describe('PermisosService.combinar', () => {
  it('el administrador tiene todo, incluso usuarios y roles', () => {
    expect(claves(combinar(true, [], [{ permiso: 'ventas.vender', concedido: false, hasta: null }], ahora))).toEqual(TODOS_LOS_PERMISOS);
  });

  it('usa los permisos del rol', () => {
    expect(claves(combinar(false, ['ventas.ver', 'ventas.vender'], [], ahora))).toEqual(['ventas.vender', 'ventas.ver']);
  });

  it('da un permiso temporal mientras está vigente y lo quita al vencer', () => {
    const hasta = new Date('2026-11-07T23:59:00-05:00');
    const cambio = [{ permiso: 'inventario.realizar', concedido: true, hasta }];
    const hoy = combinar(false, ['ventas.vender'], cambio, ahora);
    expect(hoy.find((p) => p.permiso === 'inventario.realizar')).toEqual({ permiso: 'inventario.realizar', origen: 'USUARIO', hasta });
    expect(claves(combinar(false, ['ventas.vender'], cambio, new Date('2026-11-08T00:00:00-05:00')))).toEqual(['ventas.vender']);
  });

  it('quita a un usuario un permiso de su rol', () => {
    expect(claves(combinar(false, ['ventas.vender', 'ventas.ver'], [{ permiso: 'ventas.ver', concedido: false, hasta: null }], ahora))).toEqual(['ventas.vender']);
  });

  it('nunca da usuarios y roles a quien no es administrador, ni claves desconocidas', () => {
    const r = combinar(false, ['config.usuarios', 'cosa.rara'], [{ permiso: 'config.usuarios', concedido: true, hasta: null }], ahora);
    expect(r).toEqual([]);
    expect(PERMISOS_ASIGNABLES).not.toContain('config.usuarios');
  });
});
