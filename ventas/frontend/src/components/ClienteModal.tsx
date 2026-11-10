import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { Cliente } from '../types';
import { Icono } from './icons';
import { Kbd, Modal, useAtajos, useDebounce, useToast } from './ui';

type TipoDoc = Cliente['tipoDoc'];
type Consulta =
  | { fuente: 'local'; cliente: Cliente }
  | { fuente: 'externa'; datos: { nombre: string; direccion?: string | null; estado?: string | null; condicion?: string | null } }
  | { fuente: null; motivo: string; mensaje: string };

const LARGO: Partial<Record<TipoDoc, number>> = { DNI: 8, RUC: 11 };
const VACIO = { tipoDoc: 'DNI' as TipoDoc, numeroDoc: '', nombre: '', telefono: '', direccion: '' };

/**
 * Elegir el cliente de la venta: buscar entre los guardados (↑/↓ y Enter), registrar uno nuevo
 * con consulta DNI/RUC (F2 guarda y usa) o dejar Público general (F4).
 */
export default function ClienteModal({ onElegir, onClose }: { onElegir: (c: Cliente | null) => void; onClose: () => void }) {
  const avisar = useToast();
  const [texto, setTexto] = useState('');
  const q = useDebounce(texto.trim());
  const [lista, setLista] = useState<Cliente[]>([]);
  const [marcado, setMarcado] = useState(0);
  const [f, setF] = useState(VACIO);
  const [nota, setNota] = useState<{ texto: string; tipo: 'ok' | 'warn' | 'info' } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const nombreRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vigente = true;
    api<Cliente[]>(`/clientes${qs({ q, limite: 30 })}`).then((l) => vigente && (setLista(l), setMarcado(0)));
    // Un número completo en la búsqueda pasa al formulario de cliente nuevo.
    if (/^\d{8}$/.test(q)) setF((x) => ({ ...x, tipoDoc: 'DNI', numeroDoc: q }));
    if (/^\d{11}$/.test(q)) setF((x) => ({ ...x, tipoDoc: 'RUC', numeroDoc: q }));
    return () => {
      vigente = false;
    };
  }, [q]);

  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${marcado}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [marcado]);

  const largo = LARGO[f.tipoDoc];
  const docCompleto = !!largo && f.numeroDoc.length === largo;
  const puedeGuardar = f.nombre.trim().length >= 2 && (!largo || docCompleto) && !guardando;

  const consultar = async (tipo = f.tipoDoc, numero = f.numeroDoc) => {
    if (!LARGO[tipo] || numero.length !== LARGO[tipo]) return;
    setBuscando(true);
    setNota(null);
    try {
      const r = await api<Consulta>(`/clientes/consulta/${tipo}/${numero}`);
      if (r.fuente === 'local') return onElegir(r.cliente);
      if (r.fuente === 'externa') {
        const d = r.datos;
        setF((x) => ({ ...x, nombre: d.nombre, direccion: d.direccion ?? x.direccion }));
        const alerta = [d.estado && d.estado !== 'ACTIVO' && d.estado, d.condicion && d.condicion !== 'HABIDO' && d.condicion].filter(Boolean).join(' · ');
        setNota(alerta ? { texto: `Datos encontrados, pero el RUC figura: ${alerta}.`, tipo: 'warn' } : { texto: 'Datos encontrados. Revisa y guarda con F2.', tipo: 'ok' });
      } else {
        setNota({ texto: r.mensaje, tipo: r.motivo === 'no_encontrado' ? 'warn' : 'info' });
        nombreRef.current?.focus();
      }
    } catch (e) {
      setNota({ texto: `${(e as Error).message}. Escribe el nombre a mano.`, tipo: 'warn' });
    } finally {
      setBuscando(false);
    }
  };

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const body = { ...f, numeroDoc: f.tipoDoc === 'SIN_DOCUMENTO' ? undefined : f.numeroDoc || undefined };
      onElegir(await api<Cliente>('/clientes', { body }));
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  const teclaBusqueda = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setMarcado((m) => Math.min(m + 1, lista.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setMarcado((m) => Math.max(m - 1, 0)));
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = texto.trim();
      if (lista[marcado] && t === q) return onElegir(lista[marcado]);
      // Sin coincidencias: un DNI/RUC completo se consulta directo.
      const tipo: TipoDoc | null = /^\d{8}$/.test(t) ? 'DNI' : /^\d{11}$/.test(t) ? 'RUC' : null;
      if (tipo) (setF((x) => ({ ...x, tipoDoc: tipo, numeroDoc: t })), consultar(tipo, t));
    }
  };

  const cambiarTipo = (t: TipoDoc) => {
    setF((x) => ({ ...x, tipoDoc: t, numeroDoc: t === 'SIN_DOCUMENTO' ? '' : x.numeroDoc.slice(0, LARGO[t] ?? 15) }));
    setNota(null);
  };

  useAtajos({ F2: guardar, F4: () => onElegir(null) }, { enModal: true });

  return (
    <Modal
      className="cobro cliente-pos"
      onClose={onClose}
      titulo={
        <span className="cobro-titulo">
          <Icono nombre="clientes" tam={30} />
          <span>Cliente<small>Elige o registra al cliente de esta venta</small></span>
        </span>
      }
      pie={
        <>
          <button className="btn btn-lg" onClick={() => onElegir(null)}>
            <Icono nombre="persona" /> Público general <Kbd>F4</Kbd>
          </button>
          <span className="grow" />
          <button className="btn btn-lg" onClick={onClose}>Cancelar</button>
          <button className="btn btn-lg btn-confirmar" onClick={guardar} disabled={!puedeGuardar}>
            <Icono nombre="guardar" /> Guardar y usar <Kbd>F2</Kbd>
          </button>
        </>
      }
    >
      <div className="cobro-grid cliente-pos-grid">
        <section className="cobro-monto">
          <h3><Icono nombre="buscar" /> Buscar cliente</h3>
          <div className="search">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={teclaBusqueda}
              placeholder="DNI, RUC, nombre o teléfono"
              aria-label="Buscar cliente"
              autoFocus
            />
          </div>
          <div className="cliente-resultados" ref={listaRef} role="listbox" aria-label="Clientes">
            {lista.map((c, i) => (
              <button
                key={c.id}
                data-i={i}
                role="option"
                aria-selected={i === marcado}
                className={`cliente-resultado${i === marcado ? ' on' : ''}`}
                onMouseEnter={() => setMarcado(i)}
                onClick={() => onElegir(c)}
              >
                <Icono nombre={c.tipoDoc === 'RUC' ? 'empresa' : 'persona'} />
                <span className="grow">
                  <b>{c.nombre}</b>
                  <small className="mono muted">
                    {c.numeroDoc ? `${c.tipoDoc} ${c.numeroDoc}` : 'Sin documento'}
                    {c.telefono && ` · ${c.telefono}`}
                  </small>
                </span>
                <span className={`badge ${c.tipoDoc === 'RUC' ? 'accent' : 'info'}`}>{c.tipoDoc === 'SIN_DOCUMENTO' ? 'S/D' : c.tipoDoc}</span>
              </button>
            ))}
            {!lista.length && (
              <div className="empty small">
                {q ? 'Ningún cliente guardado coincide.' : 'Aún no hay clientes guardados.'}
                {/^\d{8}$|^\d{11}$/.test(q) && <> Pulsa <Kbd>Enter</Kbd> para consultar el documento.</>}
              </div>
            )}
          </div>
          <div className="small muted cobro-ayuda">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> elegir · <Kbd>Enter</Kbd> usar · <Kbd>Esc</Kbd> cerrar</span>
          </div>
        </section>

        <section className="stack">
          <h3><Icono nombre="mas" /> Nuevo cliente</h3>
          <div className="grid-2 cliente-doc">
            <div className="field">
              <span>Tipo de documento *</span>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {(['DNI', 'RUC'] as const).map((t) => (
                  <label key={t} className={`opcion-doc${f.tipoDoc === t ? ' on' : ''}`}>
                    <input type="radio" name="tipoDocVenta" checked={f.tipoDoc === t} onChange={() => cambiarTipo(t)} />
                    <Icono nombre={t === 'RUC' ? 'empresa' : 'persona'} tam={16} /> {t}
                  </label>
                ))}
                <select
                  value={f.tipoDoc === 'DNI' || f.tipoDoc === 'RUC' ? '' : f.tipoDoc}
                  onChange={(e) => e.target.value && cambiarTipo(e.target.value as TipoDoc)}
                  aria-label="Otro tipo de documento"
                  title="Otro tipo de documento"
                  className={f.tipoDoc === 'CE' || f.tipoDoc === 'SIN_DOCUMENTO' ? 'otro-doc on' : 'otro-doc'}
                >
                  <option value="">Otro</option>
                  <option value="CE">Carné ext.</option>
                  <option value="SIN_DOCUMENTO">Sin documento</option>
                </select>
              </div>
            </div>
            <div className="field">
              <span>N.º de documento {f.tipoDoc !== 'SIN_DOCUMENTO' && '*'}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input
                  className="mono grow"
                  inputMode="numeric"
                  value={f.numeroDoc}
                  maxLength={largo ?? 15}
                  disabled={f.tipoDoc === 'SIN_DOCUMENTO'}
                  onChange={(e) => (setF({ ...f, numeroDoc: f.tipoDoc === 'CE' ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '') }), setNota(null))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), consultar())}
                  placeholder={largo ? `${largo} dígitos` : ''}
                  aria-label="Número de documento"
                />
                {largo && (
                  <button className="btn" onClick={() => consultar()} disabled={!docCompleto || buscando} title="Buscar datos del documento (Enter)" aria-label="Buscar documento">
                    {buscando ? '…' : <Icono nombre="buscar" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {nota && <div className={`aviso aviso-${nota.tipo}`} role="status">{nota.texto}</div>}

          <label className="field">
            <span>{f.tipoDoc === 'RUC' ? 'Razón social' : 'Nombres y apellidos'} *</span>
            <input ref={nombreRef} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Teléfono / celular</span>
              <div className="input-icono"><Icono nombre="telefono" tam={16} /><input inputMode="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
            </label>
            <label className="field">
              <span>Dirección</span>
              <div className="input-icono"><Icono nombre="ubicacion" tam={16} /><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
            </label>
          </div>
        </section>
      </div>
    </Modal>
  );
}
