import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Icono } from '../components/icons';
import { Kbd, useAtajos, useCarga, useDebounce, useToast, Vacio } from '../components/ui';
import { Cliente } from '../types';

type TipoDoc = Cliente['tipoDoc'];
type Form = { tipoDoc: TipoDoc; numeroDoc: string; nombre: string; telefono: string; email: string; direccion: string; notas: string; activo: boolean };
type Consulta =
  | { fuente: 'local'; cliente: Cliente }
  | { fuente: 'externa'; datos: { nombre: string; direccion?: string | null; estado?: string | null; condicion?: string | null } }
  | { fuente: null; motivo: string; mensaje: string };

const VACIO: Form = { tipoDoc: 'DNI', numeroDoc: '', nombre: '', telefono: '', email: '', direccion: '', notas: '', activo: true };
const LARGO: Partial<Record<TipoDoc, number>> = { DNI: 8, RUC: 11 };
const POR_PAGINA = 12;

const aForm = (c: Cliente): Form => ({
  tipoDoc: c.tipoDoc,
  numeroDoc: c.numeroDoc ?? '',
  nombre: c.nombre,
  telefono: c.telefono ?? '',
  email: c.email ?? '',
  direccion: c.direccion ?? '',
  notas: c.notas ?? '',
  activo: c.activo ?? true,
});

export default function Clientes() {
  const { puede } = useAuth();
  const avisar = useToast();
  const [texto, setTexto] = useState('');
  const q = useDebounce(texto.trim());
  const [verInactivos, setVerInactivos] = useState(false);
  const { data, recargar, cargando } = useCarga(() => api<Cliente[]>(`/clientes${qs({ q, todos: verInactivos ? 1 : undefined, limite: 500 })}`), [q, verInactivos]);
  const [pagina, setPagina] = useState(0);
  useEffect(() => setPagina(0), [q, verInactivos]);

  const [editando, setEditando] = useState<Cliente | null>(null);
  const [f, setF] = useState<Form>(VACIO);
  const [masInfo, setMasInfo] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [nota, setNota] = useState<{ texto: string; tipo: 'ok' | 'warn' | 'info' } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const lista = data ?? [];
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const visibles = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  const nuevo = () => {
    setEditando(null);
    setF(VACIO);
    setNota(null);
    setMasInfo(false);
    numeroRef.current?.focus();
  };

  const editar = (c: Cliente) => {
    setEditando(c);
    setF(aForm(c));
    setNota(null);
    setMasInfo(!!c.notas || c.activo === false);
  };

  const largo = LARGO[f.tipoDoc];
  const docCompleto = !!largo && f.numeroDoc.length === largo;

  const consultar = async () => {
    if (!docCompleto) return avisar(`El ${f.tipoDoc} debe tener ${largo} dígitos`, true);
    setBuscando(true);
    setNota(null);
    try {
      const r = await api<Consulta>(`/clientes/consulta/${f.tipoDoc}/${f.numeroDoc}`);
      if (r.fuente === 'local') {
        if (r.cliente.id !== editando?.id) {
          editar(r.cliente);
          setNota({ texto: 'Este cliente ya está registrado. Puedes revisar o actualizar sus datos.', tipo: 'info' });
        }
      } else if (r.fuente === 'externa') {
        const d = r.datos;
        setF((x) => ({ ...x, nombre: d.nombre, direccion: d.direccion ?? x.direccion }));
        const alerta = [d.estado && d.estado !== 'ACTIVO' && d.estado, d.condicion && d.condicion !== 'HABIDO' && d.condicion].filter(Boolean).join(' · ');
        setNota(alerta ? { texto: `Datos encontrados, pero el RUC figura: ${alerta}.`, tipo: 'warn' } : { texto: 'Datos encontrados.', tipo: 'ok' });
      } else {
        setNota({ texto: r.mensaje, tipo: r.motivo === 'no_encontrado' ? 'warn' : 'info' });
      }
    } catch (e) {
      // Sin conexión con el propio sistema o un error inesperado: se sigue a mano.
      setNota({ texto: `${(e as Error).message}. Escribe el nombre a mano.`, tipo: 'warn' });
    } finally {
      setBuscando(false);
    }
  };

  const puedeGuardar = f.nombre.trim().length >= 2 && (!largo || docCompleto) && !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const body = { ...f, numeroDoc: f.tipoDoc === 'SIN_DOCUMENTO' ? undefined : f.numeroDoc || undefined };
      const c = await api<Cliente>(editando ? `/clientes/${editando.id}` : '/clientes', { method: editando ? 'PATCH' : 'POST', body });
      avisar(editando ? 'Cliente actualizado' : 'Cliente guardado');
      recargar();
      editar(c);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (c: Cliente) => {
    if (!window.confirm(`¿Eliminar a ${c.nombre}?`)) return;
    try {
      const r = await api<{ eliminado: boolean; ventas: number }>(`/clientes/${c.id}`, { method: 'DELETE' });
      avisar(r.eliminado ? 'Cliente eliminado' : `Tiene ${r.ventas} venta(s): quedó inactivo para conservar el historial`);
      if (editando?.id === c.id) nuevo();
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  useAtajos({ F2: guardar });

  const cambiarTipo = (t: TipoDoc) => {
    setF((x) => ({ ...x, tipoDoc: t, numeroDoc: t === 'SIN_DOCUMENTO' ? '' : x.numeroDoc.slice(0, LARGO[t] ?? 15) }));
    setNota(null);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="clientes-logo"><Icono nombre="clientes" tam={26} /></span>
          <div><h1>Registro de clientes</h1><p>Administra la información de tus clientes frecuentes</p></div>
        </div>
      </div>

      <div className="clientes-grid">
        <div className="card">
          <div className="card-head" style={{ gap: 10 }}>
            <div className="search grow">
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por DNI, RUC, nombre o teléfono…" aria-label="Buscar cliente" />
            </div>
            <label className="check" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th className="num">#</th><th>Documento</th><th>Cliente</th><th>Teléfono</th><th>Tipo</th><th>Estado</th><th aria-label="Acciones" /></tr>
              </thead>
              <tbody>
                {visibles.map((c, i) => (
                  <tr key={c.id} className={`clickable${editando?.id === c.id ? ' seleccionada' : ''}`} onClick={() => editar(c)}>
                    <td className="num muted">{pagina * POR_PAGINA + i + 1}</td>
                    <td className="mono">{c.numeroDoc ?? '—'}</td>
                    <td>{c.nombre}</td>
                    <td className="mono">{c.telefono ?? '—'}</td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <Icono nombre={c.tipoDoc === 'RUC' ? 'empresa' : 'persona'} tam={16} />
                        <span className={`badge ${c.tipoDoc === 'RUC' ? 'accent' : 'info'}`}>{c.tipoDoc === 'SIN_DOCUMENTO' ? 'S/D' : c.tipoDoc}</span>
                      </span>
                    </td>
                    <td><span className={`badge ${c.activo === false ? '' : 'ok'}`}>{c.activo === false ? 'Inactivo' : 'Activo'}</span></td>
                    <td>
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" title="Editar" aria-label={`Editar ${c.nombre}`} onClick={(e) => (e.stopPropagation(), editar(c))}>
                          <Icono nombre="editar" tam={16} />
                        </button>
                        {puede('clientes.eliminar') && (
                          <button className="btn btn-ghost btn-sm texto-peligro" title="Eliminar" aria-label={`Eliminar ${c.nombre}`} onClick={(e) => (e.stopPropagation(), eliminar(c))}>
                            <Icono nombre="borrar" tam={16} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cargando && !lista.length && <Vacio>{q ? 'Ningún cliente coincide con la búsqueda.' : 'Aún no hay clientes registrados.'}</Vacio>}
          </div>
          {lista.length > 0 && (
            <div className="pager">
              <span>Mostrando {pagina * POR_PAGINA + 1} – {Math.min((pagina + 1) * POR_PAGINA, lista.length)} de {lista.length}{lista.length >= 500 ? '+' : ''} registros</span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0} aria-label="Página anterior">‹</button>
                <span className="mono">{pagina + 1} / {paginas}</span>
                <button className="btn btn-sm" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= paginas - 1} aria-label="Página siguiente">›</button>
              </span>
            </div>
          )}
        </div>

        <div className="card card-pad stack cliente-form">
          <div className="segmented-grande" role="tablist">
            <button className={!editando ? 'on' : ''} onClick={nuevo}><Icono nombre="mas" /> Nuevo cliente</button>
            <button className={editando ? 'on' : ''} disabled={!editando}><Icono nombre="editar" /> Editar cliente</button>
          </div>

          <h3 className="cliente-subtitulo"><Icono nombre="persona" /> Datos del cliente</h3>

          <div className="grid-2 cliente-doc">
            <div className="field">
              <span>Tipo de documento *</span>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {(['DNI', 'RUC'] as const).map((t) => (
                  <label key={t} className={`opcion-doc${f.tipoDoc === t ? ' on' : ''}`}>
                    <input type="radio" name="tipoDoc" checked={f.tipoDoc === t} onChange={() => cambiarTipo(t)} />
                    <Icono nombre={t === 'RUC' ? 'empresa' : 'persona'} tam={16} /> {t}
                  </label>
                ))}
                <select value={f.tipoDoc === 'DNI' || f.tipoDoc === 'RUC' ? '' : f.tipoDoc} onChange={(e) => e.target.value && cambiarTipo(e.target.value as TipoDoc)} aria-label="Otro tipo de documento" title="Otro tipo de documento" className={f.tipoDoc === 'CE' || f.tipoDoc === 'SIN_DOCUMENTO' ? 'otro-doc on' : 'otro-doc'}>
                  <option value="">Otro</option>
                  <option value="CE">Carné ext.</option>
                  <option value="SIN_DOCUMENTO">Sin documento</option>
                </select>
              </div>
            </div>
            <div className="field">
              <span>N.º de documento {f.tipoDoc !== 'SIN_DOCUMENTO' && '*'}</span>
              <div className="row" style={{ gap: 6 }}>
                <input
                  ref={numeroRef}
                  className="mono grow"
                  inputMode="numeric"
                  value={f.numeroDoc}
                  maxLength={largo ?? 15}
                  disabled={f.tipoDoc === 'SIN_DOCUMENTO'}
                  onChange={(e) => (set('numeroDoc', f.tipoDoc === 'CE' ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '')), setNota(null))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), consultar())}
                  placeholder={largo ? `${largo} dígitos` : ''}
                  autoFocus
                />
                {largo && (
                  <button className="btn" onClick={consultar} disabled={!docCompleto || buscando} title="Buscar datos del documento (Enter)" aria-label="Buscar documento">
                    {buscando ? '…' : <Icono nombre="buscar" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {nota && <div className={`aviso aviso-${nota.tipo}`} role="status">{nota.texto}</div>}

          <label className="field">
            <span>{f.tipoDoc === 'RUC' ? 'Razón social' : 'Nombres y apellidos'} *</span>
            <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
          </label>

          <div className="grid-2">
            <label className="field">
              <span>Teléfono / celular</span>
              <div className="input-icono"><Icono nombre="telefono" tam={16} /><input inputMode="tel" value={f.telefono} onChange={(e) => set('telefono', e.target.value)} /></div>
            </label>
            <label className="field">
              <span>Correo electrónico</span>
              <div className="input-icono"><Icono nombre="correo" tam={16} /><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            </label>
          </div>

          <label className="field">
            <span>Dirección</span>
            <div className="input-icono"><Icono nombre="ubicacion" tam={16} /><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} /></div>
          </label>

          <div className="cliente-extra">
            <button className="cliente-extra-head" onClick={() => setMasInfo((v) => !v)} aria-expanded={masInfo}>
              <span className="grow">Información adicional</span>
              <Icono nombre="flecha" className={masInfo ? 'girar-90' : ''} />
            </button>
            {masInfo && (
              <div className="stack" style={{ padding: '10px 12px' }}>
                <label className="field">
                  <span>Notas</span>
                  <textarea rows={2} value={f.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Ej. cumpleaños, preferencias, referencia de entrega" />
                </label>
                {editando && (
                  <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo (aparece al elegir cliente en la venta)</label>
                )}
              </div>
            )}
          </div>

          <div className="row cliente-pie">
            <button className="btn btn-lg" onClick={nuevo}><Icono nombre="limpiar" /> Limpiar</button>
            <button className="btn btn-lg btn-confirmar grow" onClick={guardar} disabled={!puedeGuardar}>
              <Icono nombre="guardar" /> {editando ? 'Guardar cambios' : 'Guardar cliente'} <Kbd>F2</Kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
