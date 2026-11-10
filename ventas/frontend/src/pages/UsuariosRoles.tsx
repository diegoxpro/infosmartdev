import { Fragment, useMemo, useState } from 'react';
import { api } from '../api';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { fechaHora, venceTexto } from '../format';
import { ClavePermiso, Perfil, PermisoCatalogo, PermisoEfectivo, Rol, Usuario } from '../types';

interface UsuarioFila extends Usuario {
  activo: boolean;
  /** Permisos dados o quitados aparte de su rol (vigentes). */
  cambios: number;
}

interface Cambio {
  permiso: ClavePermiso;
  concedido: boolean;
  hasta: string | null;
  desde: string;
  dadoPor: string;
}

interface DetallePermisos {
  usuario: UsuarioFila;
  catalogo: PermisoCatalogo[];
  delRol: ClavePermiso[];
  cambios: Cambio[];
  efectivos: PermisoEfectivo[];
}

interface Historial {
  id: number;
  fecha: string;
  accion: 'DAR' | 'QUITAR' | 'RESTABLECER' | 'CAMBIAR_ROL';
  permiso: string | null;
  nombrePermiso: string | null;
  hasta: string | null;
  detalle: string | null;
  hechoPor: string;
}

const nombreRol = (u: Pick<Usuario, 'rol' | 'perfil'>) => (u.rol === 'ADMIN' ? 'Administrador' : (u.perfil?.nombre ?? 'Sin rol'));

/** Agrupa el catálogo como el menú: Ventas, Clientes, Compras… */
function agrupar(catalogo: PermisoCatalogo[]) {
  const grupos = new Map<string, PermisoCatalogo[]>();
  for (const p of catalogo) grupos.set(p.grupo, [...(grupos.get(p.grupo) ?? []), p]);
  return [...grupos.entries()];
}

/** Valor para <input type="datetime-local"> en hora local. */
function localInput(d: Date) {
  const z = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

function finDeHoy() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return localInput(d);
}

// ---------------------------------------------------------------------------
// Usuarios

export function Usuarios() {
  const { data, recargar } = useCarga(() => api<UsuarioFila[]>('/usuarios'), []);
  const { data: roles } = useCarga(() => api<Perfil[]>('/roles'), []);
  const [editar, setEditar] = useState<UsuarioFila | 'nuevo' | null>(null);
  const [permisos, setPermisos] = useState<UsuarioFila | null>(null);
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="card-head">
        <h2>Usuarios</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditar('nuevo')}>Nuevo usuario</button>
      </div>
      <table>
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {data?.map((u) => (
            <tr key={u.id} className="clickable" onClick={() => setEditar(u)}>
              <td className="mono">{u.usuario}</td>
              <td>{u.nombre}</td>
              <td>
                <span className={`badge ${u.rol === 'ADMIN' ? 'accent' : ''}`}>{nombreRol(u)}</span>
                {u.cambios > 0 && <> <span className="badge info" title="Tiene permisos dados o quitados aparte de su rol">+{u.cambios} propio{u.cambios > 1 ? 's' : ''}</span></>}
              </td>
              <td>{u.activo ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
              <td className="actions">
                {u.rol !== 'ADMIN' && (
                  <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), setPermisos(u))}>Permisos</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editar && (
        <UsuarioForm
          usuario={editar === 'nuevo' ? undefined : editar}
          roles={roles ?? []}
          onClose={() => setEditar(null)}
          onListo={() => (setEditar(null), recargar())}
        />
      )}
      {permisos && <PermisosUsuario usuario={permisos} onClose={() => (setPermisos(null), recargar())} />}
    </div>
  );
}

function UsuarioForm({ usuario, roles, onClose, onListo }: { usuario?: UsuarioFila; roles: Perfil[]; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  // El select junta el rol fijo "Administrador" con los roles del personal.
  const inicial = usuario ? (usuario.rol === 'ADMIN' ? 'ADMIN' : String(usuario.perfil?.id ?? '')) : String(roles.find((r) => r.nombre === 'Cajero')?.id ?? roles[0]?.id ?? '');
  const [f, setF] = useState({ usuario: usuario?.usuario ?? '', nombre: usuario?.nombre ?? '', password: '', rol: inicial, activo: usuario?.activo ?? true });
  const guardar = async () => {
    const rol: Rol = f.rol === 'ADMIN' ? 'ADMIN' : 'CAJERO';
    const perfilId = f.rol === 'ADMIN' ? undefined : Number(f.rol);
    try {
      if (usuario) {
        await api(`/usuarios/${usuario.id}`, { method: 'PATCH', body: { nombre: f.nombre, rol, perfilId, activo: f.activo, password: f.password || undefined } });
      } else {
        await api('/usuarios', { body: { usuario: f.usuario, nombre: f.nombre, password: f.password, rol, perfilId } });
      }
      avisar('Usuario guardado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo={usuario ? `Editar ${usuario.usuario}` : 'Nuevo usuario'}
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={f.nombre.length < 2 || !f.rol || (!usuario && (f.usuario.length < 3 || f.password.length < 6))}>Guardar</button>
        </>
      }
    >
      <div className="grid-2">
        <Campo label="Usuario"><input className="mono" value={f.usuario} disabled={!!usuario} onChange={(e) => setF({ ...f, usuario: e.target.value.toLowerCase() })} autoFocus /></Campo>
        <Campo label="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <Campo label={usuario ? 'Nueva contraseña' : 'Contraseña'} ayuda={usuario ? 'Déjala vacía para no cambiarla' : 'Mínimo 6 caracteres'}>
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Campo>
        <Campo label="Rol" ayuda="Los roles se crean en la pestaña Roles">
          <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            <option value="ADMIN">Administrador (todo)</option>
          </select>
        </Campo>
        {usuario && <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo</label>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Permisos de un usuario

interface Edicion {
  permiso: ClavePermiso;
  /** Lo que el admin marcó: habilitado o no. */
  habilitado: boolean;
  temporal: boolean;
  hasta: string;
}

function PermisosUsuario({ usuario, onClose }: { usuario: UsuarioFila; onClose: () => void }) {
  const avisar = useToast();
  const { data, setData } = useCarga(() => api<DetallePermisos>(`/usuarios/${usuario.id}/permisos`), [usuario.id]);
  const [ver, setVer] = useState<'permisos' | 'historial'>('permisos');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);

  const efectivos = useMemo(() => new Map((data?.efectivos ?? []).map((p) => [p.permiso, p])), [data]);
  const cambios = useMemo(() => new Map((data?.cambios ?? []).map((c) => [c.permiso, c])), [data]);
  const delRol = useMemo(() => new Set(data?.delRol ?? []), [data]);

  const tocar = (permiso: ClavePermiso, habilitado: boolean) => {
    const c = cambios.get(permiso);
    setEdicion({ permiso, habilitado, temporal: !!c?.hasta, hasta: c?.hasta ? localInput(new Date(c.hasta)) : finDeHoy() });
  };

  const aplicar = async () => {
    if (!edicion) return;
    const igualAlRol = edicion.habilitado === delRol.has(edicion.permiso);
    const estado = igualAlRol ? 'ROL' : edicion.habilitado ? 'DAR' : 'QUITAR';
    if (estado !== 'ROL' && edicion.temporal && !(new Date(edicion.hasta) > new Date())) {
      return avisar('Elige una fecha y hora que aún no haya pasado', true);
    }
    setGuardando(true);
    try {
      const r = await api<DetallePermisos>(`/usuarios/${usuario.id}/permisos/${edicion.permiso}`, {
        method: 'PUT',
        body: { estado, hasta: estado !== 'ROL' && edicion.temporal ? new Date(edicion.hasta).toISOString() : undefined },
      });
      setData(r);
      setEdicion(null);
      avisar('Permiso actualizado');
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  const restablecer = async (permiso: ClavePermiso) => {
    try {
      setData(await api<DetallePermisos>(`/usuarios/${usuario.id}/permisos/${permiso}`, { method: 'PUT', body: { estado: 'ROL' } }));
      setEdicion(null);
      avisar('Vuelve a lo que dice su rol');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <Modal ancho titulo={<>Permisos de {usuario.nombre} <span className="badge">{nombreRol(usuario)}</span></>} onClose={onClose} pie={<button className="btn" onClick={onClose}>Cerrar</button>}>
      <div className="tabs">
        <button className={ver === 'permisos' ? 'active' : ''} onClick={() => setVer('permisos')}>Permisos</button>
        <button className={ver === 'historial' ? 'active' : ''} onClick={() => setVer('historial')}>Historial</button>
      </div>
      {ver === 'historial' ? (
        <HistorialPermisos usuarioId={usuario.id} />
      ) : !data ? (
        <Vacio>Cargando…</Vacio>
      ) : (
        <div className="stack">
          <p className="muted small">
            Marca o desmarca para habilitar o deshabilitar una función solo a {usuario.nombre}. Si marcas «Temporal», eliges hasta qué fecha y hora vale; al vencer vuelve sola a lo que dice su rol.
          </p>
          <table>
            <tbody>
              {agrupar(data.catalogo).map(([grupo, lista]) => (
                <Fragment key={grupo}>
                  <tr><td colSpan={3} className="grupo-permisos">{grupo}</td></tr>
                  {lista.map((p) => {
                    const tiene = efectivos.has(p.clave);
                    const c = cambios.get(p.clave);
                    const abierto = edicion?.permiso === p.clave;
                    const marcado = abierto ? edicion.habilitado : tiene;
                    return (
                      <Fragment key={p.clave}>
                        <tr>
                          <td style={{ width: '55%' }}>
                            <label className="check">
                              <input type="checkbox" checked={marcado} onChange={(e) => tocar(p.clave, e.target.checked)} />
                              {p.nombre}
                            </label>
                          </td>
                          <td>
                            {!c ? (
                              <span className="muted small">{delRol.has(p.clave) ? 'Del rol' : ''}</span>
                            ) : c.concedido ? (
                              <span className="badge info" title={`Dado por ${c.dadoPor} el ${fechaHora(c.desde)}`}>Habilitado aparte{c.hasta ? ` · ${venceTexto(c.hasta)}` : ''}</span>
                            ) : (
                              <span className="badge warn" title={`Quitado por ${c.dadoPor} el ${fechaHora(c.desde)}`}>Deshabilitado{c.hasta ? ` · ${venceTexto(c.hasta)}` : ''}</span>
                            )}
                          </td>
                          <td className="actions">
                            {c && !abierto && <button className="btn btn-ghost btn-sm" onClick={() => restablecer(p.clave)}>Volver al rol</button>}
                          </td>
                        </tr>
                        {abierto && (
                          <tr>
                            <td colSpan={3}>
                              <EditorPermiso
                                edicion={edicion}
                                igualAlRol={edicion.habilitado === delRol.has(p.clave)}
                                guardando={guardando}
                                onCambio={setEdicion}
                                onAplicar={aplicar}
                                onCancelar={() => setEdicion(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function EditorPermiso({
  edicion,
  igualAlRol,
  guardando,
  onCambio,
  onAplicar,
  onCancelar,
}: {
  edicion: Edicion;
  igualAlRol: boolean;
  guardando: boolean;
  onCambio: (e: Edicion) => void;
  onAplicar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="aviso aviso-info row" style={{ flexWrap: 'wrap', gap: 12 }}>
      {igualAlRol ? (
        <span className="grow">Queda como dice su rol ({edicion.habilitado ? 'habilitado' : 'deshabilitado'}).</span>
      ) : (
        <>
          <b>{edicion.habilitado ? 'Habilitar' : 'Deshabilitar'}</b>
          <label className="check">
            <input type="checkbox" checked={edicion.temporal} onChange={(e) => onCambio({ ...edicion, temporal: e.target.checked })} /> Temporal
          </label>
          {edicion.temporal ? (
            <>
              <span>hasta</span>
              <input type="datetime-local" value={edicion.hasta} min={localInput(new Date())} onChange={(e) => onCambio({ ...edicion, hasta: e.target.value })} style={{ width: 220 }} />
              <button className="btn btn-sm" onClick={() => onCambio({ ...edicion, hasta: finDeHoy() })}>Hoy 11:59 p. m.</button>
            </>
          ) : (
            <span className="muted">permanente</span>
          )}
          <span className="grow" />
        </>
      )}
      <button className="btn btn-sm" onClick={onCancelar}>Cancelar</button>
      <button className="btn btn-primary btn-sm" onClick={onAplicar} disabled={guardando || (edicion.temporal && !edicion.hasta)}>{guardando ? 'Guardando…' : 'Aplicar'}</button>
    </div>
  );
}

const ACCION: Record<Historial['accion'], string> = {
  DAR: 'Habilitó',
  QUITAR: 'Deshabilitó',
  RESTABLECER: 'Volvió al rol',
  CAMBIAR_ROL: 'Cambió el rol',
};

function HistorialPermisos({ usuarioId }: { usuarioId: number }) {
  const { data } = useCarga(() => api<Historial[]>(`/usuarios/${usuarioId}/historial-permisos`), [usuarioId]);
  if (!data) return <Vacio>Cargando…</Vacio>;
  if (!data.length) return <Vacio>Todavía no se han cambiado sus permisos.</Vacio>;
  return (
    <table>
      <thead><tr><th>Fecha</th><th>Quién</th><th>Qué hizo</th><th>Permiso</th><th>Vence</th></tr></thead>
      <tbody>
        {data.map((h) => (
          <tr key={h.id}>
            <td className="nowrap">{fechaHora(h.fecha)}</td>
            <td>{h.hechoPor}</td>
            <td>{ACCION[h.accion] ?? h.accion}</td>
            <td>{h.nombrePermiso ?? h.detalle}</td>
            <td className="nowrap">{h.hasta ? fechaHora(h.hasta) : h.accion === 'DAR' || h.accion === 'QUITAR' ? 'Permanente' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Roles

export function Roles() {
  const { data, recargar } = useCarga(() => api<Perfil[]>('/roles'), []);
  const { data: catalogo } = useCarga(() => api<PermisoCatalogo[]>('/roles/catalogo'), []);
  const [editar, setEditar] = useState<Perfil | 'nuevo' | null>(null);
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="card-head">
        <h2>Roles</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditar('nuevo')}>Nuevo rol</button>
      </div>
      <table>
        <thead><tr><th>Rol</th><th>Permisos</th><th>Usuarios</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="badge accent">Administrador</span></td>
            <td className="muted">Todo (rol fijo, no se puede cambiar)</td>
            <td />
          </tr>
          {data?.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => setEditar(r)}>
              <td><b>{r.nombre}</b></td>
              <td>{r.permisos.length} de {catalogo?.length ?? '…'}</td>
              <td>{r.usuarios.map((u) => u.nombre).join(', ') || <span className="muted">Nadie</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editar && catalogo && (
        <RolForm rol={editar === 'nuevo' ? undefined : editar} catalogo={catalogo} onClose={() => setEditar(null)} onListo={() => (setEditar(null), recargar())} />
      )}
    </div>
  );
}

function RolForm({ rol, catalogo, onClose, onListo }: { rol?: Perfil; catalogo: PermisoCatalogo[]; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [nombre, setNombre] = useState(rol?.nombre ?? '');
  const [marcados, setMarcados] = useState(new Set<ClavePermiso>(rol?.permisos ?? []));
  const alternar = (p: ClavePermiso, si: boolean) => {
    const s = new Set(marcados);
    if (si) s.add(p);
    else s.delete(p);
    setMarcados(s);
  };
  const guardar = async () => {
    const body = { nombre, permisos: catalogo.map((p) => p.clave).filter((p) => marcados.has(p)) };
    try {
      if (rol) await api(`/roles/${rol.id}`, { method: 'PATCH', body });
      else await api('/roles', { body });
      avisar('Rol guardado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  const eliminar = async () => {
    if (!rol || !window.confirm(`¿Eliminar el rol ${rol.nombre}?`)) return;
    try {
      await api(`/roles/${rol.id}`, { method: 'DELETE' });
      avisar('Rol eliminado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      ancho
      titulo={rol ? `Rol ${rol.nombre}` : 'Nuevo rol'}
      onClose={onClose}
      pie={
        <>
          {rol && <button className="btn btn-danger" onClick={eliminar} disabled={rol.usuarios.length > 0} title={rol.usuarios.length ? 'Primero cambia de rol a sus usuarios' : undefined}>Eliminar</button>}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={nombre.trim().length < 2}>Guardar</button>
        </>
      }
    >
      <div className="stack">
        <Campo label="Nombre del rol"><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Almacenero" autoFocus={!rol} /></Campo>
        {rol && rol.usuarios.length > 0 && (
          <div className="aviso aviso-info">Los cambios aplican al momento a: {rol.usuarios.map((u) => u.nombre).join(', ')}.</div>
        )}
        <div className="grid-2">
          {agrupar(catalogo).map(([grupo, lista]) => (
            <div key={grupo} className="stack" style={{ gap: 6 }}>
              <b>{grupo}</b>
              {lista.map((p) => (
                <label key={p.clave} className="check">
                  <input type="checkbox" checked={marcados.has(p.clave)} onChange={(e) => alternar(p.clave, e.target.checked)} /> {p.nombre}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
