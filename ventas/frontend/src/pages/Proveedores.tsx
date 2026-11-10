import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Icono } from '../components/icons';
import { aFormProveedor, FormProveedor, guardarProveedor, PROVEEDOR_VACIO, ProveedorCampos, proveedorValido } from '../components/ProveedorForm';
import { Kbd, useAtajos, useCarga, useDebounce, useToast, Vacio } from '../components/ui';
import { money, n } from '../format';
import { Proveedor } from '../types';

const POR_PAGINA = 12;

export default function Proveedores() {
  const { puede } = useAuth();
  const avisar = useToast();
  const [texto, setTexto] = useState('');
  const q = useDebounce(texto.trim());
  const [verInactivos, setVerInactivos] = useState(false);
  const { data, recargar, cargando } = useCarga(() => api<Proveedor[]>(`/proveedores${qs({ q, todos: verInactivos ? 1 : undefined })}`), [q, verInactivos]);
  const [pagina, setPagina] = useState(0);
  useEffect(() => setPagina(0), [q, verInactivos]);

  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [f, setF] = useState<FormProveedor>(PROVEEDOR_VACIO);
  const [guardando, setGuardando] = useState(false);
  // Cambia en cada "nuevo" para que el formulario olvide el aviso de la consulta anterior.
  const [vuelta, setVuelta] = useState(0);
  const numeroRef = useRef<HTMLInputElement>(null);

  const lista = data ?? [];
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const visibles = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  const nuevo = () => {
    setEditando(null);
    setF(PROVEEDOR_VACIO);
    setVuelta((v) => v + 1);
    numeroRef.current?.focus();
  };

  const editar = (p: Proveedor) => {
    setEditando(p);
    setF(aFormProveedor(p));
  };

  const puedeGuardar = puede('proveedores.editar') && proveedorValido(f) && !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const p = await guardarProveedor(f, editando?.id);
      avisar(editando ? 'Proveedor actualizado' : 'Proveedor guardado');
      recargar();
      editar(p);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (p: Proveedor) => {
    if (!window.confirm(`¿Eliminar a ${p.nombreComercial || p.razonSocial}?`)) return;
    try {
      const r = await api<{ eliminado: boolean; compras: number }>(`/proveedores/${p.id}`, { method: 'DELETE' });
      avisar(r.eliminado ? 'Proveedor eliminado' : `Tiene ${r.compras} compra(s): quedó inactivo para conservar el historial`);
      if (editando?.id === p.id) nuevo();
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  useAtajos({ F2: guardar });

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="clientes-logo"><Icono nombre="proveedores" tam={26} /></span>
          <div><h1>Registro de proveedores</h1><p>Administra a quién le compras, sus contactos y el crédito que te dan</p></div>
        </div>
      </div>

      <div className="clientes-grid proveedores-grid">
        <div className="card">
          <div className="card-head" style={{ gap: 10 }}>
            <div className="search grow">
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por RUC, razón social, nombre comercial o contacto…" aria-label="Buscar proveedor" />
            </div>
            <label className="check" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>RUC / DNI</th><th>Proveedor</th><th>Teléfono</th><th>Crédito</th><th className="num">Deuda</th><th>Estado</th><th aria-label="Acciones" /></tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} className={`clickable${editando?.id === p.id ? ' seleccionada' : ''}`} onClick={() => editar(p)}>
                    <td className="mono">{p.ruc ?? '—'}</td>
                    <td>
                      {p.nombreComercial ? <><b>{p.nombreComercial}</b><div className="small muted">{p.razonSocial}</div></> : p.razonSocial}
                      {p.contacto && <div className="small muted">Contacto: {p.contacto}</div>}
                    </td>
                    <td className="mono">{p.telefono ?? '—'}</td>
                    <td>{p.diasCredito ? <span className="badge info">{p.diasCredito} días</span> : <span className="muted">Contado</span>}</td>
                    <td className="num">{n(p.deuda) > 0 ? <span className="badge warn">{money(p.deuda)}</span> : '—'}</td>
                    <td><span className={`badge ${p.activo ? 'ok' : ''}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td>
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" title="Editar" aria-label={`Editar ${p.razonSocial}`} onClick={(e) => (e.stopPropagation(), editar(p))}>
                          <Icono nombre="editar" tam={16} />
                        </button>
                        {puede('proveedores.editar') && (
                          <button className="btn btn-ghost btn-sm texto-peligro" title="Eliminar" aria-label={`Eliminar ${p.razonSocial}`} onClick={(e) => (e.stopPropagation(), eliminar(p))}>
                            <Icono nombre="borrar" tam={16} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cargando && !lista.length && <Vacio>{q ? 'Ningún proveedor coincide con la búsqueda.' : 'Aún no hay proveedores registrados.'}</Vacio>}
          </div>
          {lista.length > 0 && (
            <div className="pager">
              <span>Mostrando {pagina * POR_PAGINA + 1} – {Math.min((pagina + 1) * POR_PAGINA, lista.length)} de {lista.length} registros</span>
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
            <button className={!editando ? 'on' : ''} onClick={nuevo}><Icono nombre="mas" /> Nuevo proveedor</button>
            <button className={editando ? 'on' : ''} disabled={!editando}><Icono nombre="editar" /> Editar proveedor</button>
          </div>

          <h3 className="cliente-subtitulo"><Icono nombre="empresa" /> Datos del proveedor</h3>

          <ProveedorCampos
            key={editando?.id ?? `nuevo-${vuelta}`}
            f={f}
            setF={setF}
            editandoId={editando?.id}
            numeroRef={numeroRef}
            conActivo={!!editando}
            extraAbierto={!!editando && (!!editando.notas || !!editando.email || !editando.activo)}
            onExiste={(p) => {
              editar(p);
              avisar('Este proveedor ya está registrado. Puedes revisar o actualizar sus datos.');
            }}
          />

          {!puede('proveedores.editar') && <div className="aviso aviso-info">No tienes permiso para registrar o cambiar proveedores.</div>}

          <div className="row cliente-pie">
            <button className="btn btn-lg" onClick={nuevo}><Icono nombre="limpiar" /> Limpiar</button>
            <button className="btn btn-lg btn-confirmar grow" onClick={guardar} disabled={!puedeGuardar}>
              <Icono nombre="guardar" /> {editando ? 'Guardar cambios' : 'Guardar proveedor'} <Kbd>F2</Kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
