import QRCode from 'qrcode';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icono } from '../components/icons';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { fechaHora, money, n, qty } from '../format';

// El conteo desde la PC trae el lector de códigos: se carga solo al abrir la pestaña.
const ContarDesdePc = lazy(() => import('./ContarInventarioPc').then((m) => ({ default: m.ContarDesdePc })));

type EstadoInv = 'EN_CURSO' | 'REVISION' | 'VALIDADO' | 'CANCELADO';
type EstadoConteo = 'APLICADO' | 'PENDIENTE' | 'SUMADO' | 'REEMPLAZADO' | 'DESCARTADO';

interface Lote {
  fecha: string;
  cantidad: number;
}

const fechaCorta = (f: string) => f.split('-').reverse().join('/');
/** "15/12/2026: 10 · 20/01/2027: 6" */
const textoLotes = (lotes: Lote[]) => lotes.map((l) => `${fechaCorta(l.fecha)}: ${qty(l.cantidad)}`).join(' · ');

interface Conteo {
  id: number;
  cantidad: string;
  stockAlContar: string;
  lotes: Lote[];
  estado: EstadoConteo;
  fecha: string;
  operador: { nombre: string };
}

interface Item {
  id: number;
  cantidad: string;
  stockReferencia: string;
  lotes: Lote[];
  actualizado: string;
  producto: { id: number; nombre: string; codigoBarra: string | null; unidad: string; stock: string; costo: string; controlaVencimiento: boolean };
  conteos: Conteo[];
}

interface Detalle {
  id: number;
  estado: EstadoInv;
  inicio: string;
  fin: string | null;
  usuario: { nombre: string };
  operadores: { id: number; nombre: string; createdAt: string; ultimoAcceso: string; _count: { conteos: number } }[];
  items: Item[];
  totalProductos: number;
}

interface Actual {
  inventario: { id: number; estado: EstadoInv; qr: string } | null;
}

interface NoContado {
  id: number;
  nombre: string;
  codigoBarra: string | null;
  unidad: string;
  stock: string;
  categoria: { nombre: string } | null;
}

const ESTADO: Record<EstadoInv, { label: string; clase: string }> = {
  EN_CURSO: { label: 'Contando', clase: 'ok' },
  REVISION: { label: 'En revisión', clase: 'warn' },
  VALIDADO: { label: 'Validado', clase: 'info' },
  CANCELADO: { label: 'Cancelado', clase: 'danger' },
};

const diferencia = (it: Item) => n(it.cantidad) - n(it.stockReferencia);

export default function RealizarInventario() {
  const avisar = useToast();
  const { data, recargar, cargando } = useCarga(() => api<Actual>('/toma-inventario/actual'), []);
  const [iniciando, setIniciando] = useState(false);

  const iniciar = async () => {
    setIniciando(true);
    try {
      await api('/toma-inventario', { method: 'POST' });
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setIniciando(false);
    }
  };

  if (cargando && !data) return null;
  const inv = data?.inventario;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Realizar inventario</h1>
          <p>Cuenta el stock con los celulares. Se puede seguir vendiendo mientras tanto.</p>
        </div>
        {!inv && (
          <button className="btn btn-lg btn-confirmar" onClick={iniciar} disabled={iniciando}>
            <Icono nombre="ok" /> {iniciando ? 'Iniciando…' : 'Iniciar'}
          </button>
        )}
      </div>
      {inv ? <EnCurso id={inv.id} qr={inv.qr} alTerminar={recargar} /> : <Inicio />}
    </div>
  );
}

function Inicio() {
  const { data } = useCarga(
    () => api<{ id: number; estado: EstadoInv; inicio: string; validadoAt: string | null; usuario: { nombre: string }; _count: { items: number; operadores: number } }[]>('/toma-inventario/historial'),
    [],
  );
  return (
    <>
      <div className="card card-pad">
        <ol className="inv-pasos">
          <li>Da clic en <b>Iniciar</b>. Aparece un código QR.</li>
          <li>Cada operador escanea el QR con su celular (conectado al WiFi de la tienda) y escribe su nombre. La primera vez, el celular pide instalar el certificado de la tienda. La cajera también puede contar desde la caja con el lector de códigos (menú <b>Realizar inventario</b>).</li>
          <li>En el celular: <b>Escanear</b>, apunta al código de barras y escribe la cantidad en unidades. Los productos sin código se buscan por nombre.</li>
          <li>Los conteos aparecen aquí al instante. Si dos personas cuentan el mismo producto, el sistema te pregunta si se suman o se reemplazan.</li>
          <li>Al terminar, da clic en <b>Finalizar conteo</b>, revisa las diferencias y los productos no contados, y da clic en <b>Validar</b> para actualizar el stock.</li>
        </ol>
      </div>
      {!!data?.length && (
        <div className="card">
          <div className="card-head"><b>Inventarios anteriores</b></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>N.º</th><th>Inicio</th><th>Estado</th><th>Validado</th><th>Por</th><th className="num">Productos</th><th className="num">Operadores</th></tr>
              </thead>
              <tbody>
                {data.map((h) => (
                  <tr key={h.id}>
                    <td>#{h.id}</td>
                    <td>{fechaHora(h.inicio)}</td>
                    <td><span className={`badge ${ESTADO[h.estado].clase}`}>{ESTADO[h.estado].label}</span></td>
                    <td>{h.validadoAt ? fechaHora(h.validadoAt) : '—'}</td>
                    <td>{h.usuario.nombre}</td>
                    <td className="num">{h._count.items}</td>
                    <td className="num">{h._count.operadores}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function EnCurso({ id, qr, alTerminar }: { id: number; qr: string; alTerminar: () => void }) {
  const avisar = useToast();
  const { data, recargar, setData } = useCarga(() => api<Detalle>(`/toma-inventario/${id}`), [id]);
  const version = useRef('');
  const [tab, setTab] = useState<'contados' | 'no-contados' | 'operadores' | 'contar'>('contados');
  const [filtro, setFiltro] = useState('');
  const [editar, setEditar] = useState<Item | null>(null);
  const [validar, setValidar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // "Tiempo real": consulta un número de versión cada 2 s y recarga solo si cambió.
  useEffect(() => {
    let vivo = true;
    const tick = async () => {
      try {
        const v = await api<{ version: string }>(`/toma-inventario/${id}/version`);
        if (vivo && v.version !== version.current) {
          const primera = !version.current;
          version.current = v.version;
          if (!primera) setData(await api<Detalle>(`/toma-inventario/${id}`));
        }
      } catch {
        /* sin conexión con la API: se reintenta en el siguiente ciclo */
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [id, setData]);

  const accion = async (ruta: string, ok?: string, terminar = false) => {
    setOcupado(true);
    try {
      await api(ruta, { method: 'POST' });
      if (ok) avisar(ok);
      if (terminar) alTerminar();
      else recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setOcupado(false);
    }
  };

  const pendientes = useMemo(
    () => (data?.items ?? []).flatMap((it) => it.conteos.filter((c) => c.estado === 'PENDIENTE').map((c) => ({ item: it, conteo: c }))),
    [data],
  );
  const items = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const lista = data?.items ?? [];
    return q ? lista.filter((it) => it.producto.nombre.toLowerCase().includes(q) || it.producto.codigoBarra?.includes(q)) : lista;
  }, [data, filtro]);

  if (!data) return null;
  const abierto = data.estado === 'EN_CURSO';
  const conDiferencia = data.items.filter((it) => Math.abs(diferencia(it)) >= 0.0005).length;

  return (
    <>
      <div className="inv-cabecera">
        {abierto && <QrConexion url={qr} />}
        <div className="card card-pad inv-resumen">
          <div className="row">
            <span className={`badge ${ESTADO[data.estado].clase}`}>{ESTADO[data.estado].label}</span>
            <span className="muted">Inventario #{data.id} · iniciado {fechaHora(data.inicio)} por {data.usuario.nombre}</span>
          </div>
          <div className="inv-cifras">
            <div><span>Contados</span><b>{data.items.length}<small> de {data.totalProductos}</small></b></div>
            <div><span>Con diferencia</span><b>{conDiferencia}</b></div>
            <div><span>Por decidir</span><b className={pendientes.length ? 'texto-warn' : ''}>{pendientes.length}</b></div>
            <div><span>Celulares</span><b>{data.operadores.length}</b></div>
          </div>
          <div className="row">
            {abierto ? (
              <button className="btn btn-lg btn-primary" disabled={ocupado} onClick={() => accion(`/toma-inventario/${id}/finalizar`, 'Conteo cerrado: ya no se reciben datos de los celulares')}>
                Finalizar conteo
              </button>
            ) : (
              <>
                <button className="btn btn-lg btn-confirmar" disabled={ocupado || !!pendientes.length} onClick={() => setValidar(true)} title={pendientes.length ? 'Primero decide los productos contados dos veces' : undefined}>
                  <Icono nombre="ok" /> Validar y actualizar stock
                </button>
                <button className="btn btn-lg" disabled={ocupado} onClick={() => accion(`/toma-inventario/${id}/reabrir`, 'Los celulares pueden seguir contando')}>
                  Reabrir conteo
                </button>
              </>
            )}
            <button
              className="btn btn-danger"
              disabled={ocupado}
              onClick={() => confirm('¿Cancelar este inventario? No se cambiará ningún stock.') && accion(`/toma-inventario/${id}/cancelar`, 'Inventario cancelado', true)}
            >
              Cancelar inventario
            </button>
          </div>
        </div>
      </div>

      {pendientes.length > 0 && (
        <div className="card">
          <div className="card-head">
            <b><Icono nombre="alerta" /> Productos contados dos veces</b>
            <span className="muted">Elige si se suman (estaban en lugares distintos) o si el nuevo reemplaza al anterior.</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th>Ya contado</th><th>Nuevo conteo</th><th /></tr>
              </thead>
              <tbody>
                {pendientes.map(({ item, conteo }) => (
                  <tr key={conteo.id} className="fila-alerta">
                    <td><b>{item.producto.nombre}</b><div className="muted">{item.producto.codigoBarra ?? 'Sin código'}</div></td>
                    <td>
                      <b>{qty(item.cantidad)}</b>
                      <div className="muted">
                        {item.conteos.filter((c) => c.estado !== 'PENDIENTE' && c.estado !== 'DESCARTADO').map((c) => c.operador.nombre).join(', ')}
                      </div>
                      {item.lotes.length > 0 && <div className="small">{textoLotes(item.lotes)}</div>}
                    </td>
                    <td>
                      <b>{qty(conteo.cantidad)}</b>
                      <div className="muted">{conteo.operador.nombre} · {fechaHora(conteo.fecha)}</div>
                      {conteo.lotes.length > 0 && <div className="small">{textoLotes(conteo.lotes)}</div>}
                    </td>
                    <td className="actions">
                      <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                        <Resolver conteoId={conteo.id} accion="SUMAR" texto={`Sumar = ${qty(n(item.cantidad) + n(conteo.cantidad))}`} alListo={recargar} />
                        <Resolver conteoId={conteo.id} accion="REEMPLAZAR" texto={`Reemplazar = ${qty(conteo.cantidad)}`} alListo={recargar} />
                        <Resolver conteoId={conteo.id} accion="DESCARTAR" texto="Descartar" alListo={recargar} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'contados' ? 'active' : ''} onClick={() => setTab('contados')}>Contados ({data.items.length})</button>
        <button className={tab === 'no-contados' ? 'active' : ''} onClick={() => setTab('no-contados')}>No contados ({Math.max(0, data.totalProductos - data.items.length)})</button>
        <button className={tab === 'operadores' ? 'active' : ''} onClick={() => setTab('operadores')}>Operadores ({data.operadores.length})</button>
        <button className={tab === 'contar' ? 'active' : ''} onClick={() => setTab('contar')}>Contar desde esta PC</button>
      </div>

      {tab === 'contar' && <Suspense fallback={null}><ContarDesdePc /></Suspense>}

      {tab === 'contados' && (
        <div className="card">
          <div className="card-head">
            <input placeholder="Filtrar por nombre o código" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 360 }} />
            <span className="muted">La diferencia es contado menos el stock que había cuando se contó: lo vendido después ya está descontado.</span>
          </div>
          {items.length ? (
            <div className="table-wrap" style={{ maxHeight: '60vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Producto</th><th className="num">Stock al contar</th><th className="num">Contado</th><th className="num">Diferencia</th>
                    <th>Vencimientos</th><th>Contado por</th><th>Hora</th><th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const d = diferencia(it);
                    const pendiente = it.conteos.some((c) => c.estado === 'PENDIENTE');
                    return (
                      <tr key={it.id} className={pendiente ? 'fila-alerta' : ''}>
                        <td><b>{it.producto.nombre}</b><div className="muted">{it.producto.codigoBarra ?? 'Sin código'}</div></td>
                        <td className="num">{qty(it.stockReferencia)}</td>
                        <td className="num"><b>{qty(it.cantidad)}</b></td>
                        <td className={`num ${d > 0.0005 ? 'texto-ok' : d < -0.0005 ? 'texto-danger' : 'muted'}`}>{d > 0 ? '+' : ''}{qty(d)}</td>
                        <td className="small">
                          {it.lotes.length ? textoLotes(it.lotes) : it.producto.controlaVencimiento ? <span className="texto-danger">Sin fechas</span> : '—'}
                        </td>
                        <td>{[...new Set(it.conteos.filter((c) => c.estado !== 'DESCARTADO').map((c) => c.operador.nombre))].join(', ')}</td>
                        <td>{fechaHora(it.actualizado)}</td>
                        <td className="actions"><button className="btn btn-sm" onClick={() => setEditar(it)}>Corregir</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Vacio>{data.items.length ? 'Ningún producto coincide.' : 'Aún no llegan conteos. Escanea el QR con un celular para empezar.'}</Vacio>
          )}
        </div>
      )}
      {tab === 'no-contados' && <NoContados id={id} version={data.items.length} />}
      {tab === 'operadores' && (
        <div className="card">
          {data.operadores.length ? (
            <table>
              <thead><tr><th>Operador</th><th>Entró</th><th>Última actividad</th><th className="num">Conteos</th></tr></thead>
              <tbody>
                {data.operadores.map((o) => (
                  <tr key={o.id}><td>{o.nombre}</td><td>{fechaHora(o.createdAt)}</td><td>{fechaHora(o.ultimoAcceso)}</td><td className="num">{o._count.conteos}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Vacio>Ningún celular se ha conectado todavía.</Vacio>
          )}
        </div>
      )}

      {editar && <EditarItem item={editar} onClose={() => setEditar(null)} alGuardar={() => (setEditar(null), recargar())} />}
      {validar && <Validar detalle={data} onClose={() => setValidar(false)} alValidar={() => (setValidar(false), alTerminar())} />}
    </>
  );
}

function Resolver({ conteoId, accion, texto, alListo }: { conteoId: number; accion: 'SUMAR' | 'REEMPLAZAR' | 'DESCARTAR'; texto: string; alListo: () => void }) {
  const avisar = useToast();
  const [ocupado, setOcupado] = useState(false);
  return (
    <button
      className={`btn btn-sm${accion === 'SUMAR' ? ' btn-primary' : accion === 'DESCARTAR' ? ' btn-ghost' : ''}`}
      disabled={ocupado}
      onClick={async () => {
        setOcupado(true);
        try {
          await api(`/toma-inventario/conteos/${conteoId}/resolver`, { body: { accion } });
          alListo();
        } catch (e) {
          avisar((e as Error).message, true);
        } finally {
          setOcupado(false);
        }
      }}
    >
      {texto}
    </button>
  );
}

function QrConexion({ url }: { url: string }) {
  const [img, setImg] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setImg);
  }, [url]);
  return (
    <div className="card card-pad inv-qr">
      {img && <img src={img} alt="Código QR para conectar los celulares" width={200} height={200} />}
      <div>
        <b>Esperando celulares</b>
        <p className="muted">Escanea este código con la cámara del celular, conectado al WiFi de la tienda. Pueden entrar varios a la vez.</p>
        <code>{url}</code>
      </div>
    </div>
  );
}

function NoContados({ id, version }: { id: number; version: number }) {
  const avisar = useToast();
  const { data, recargar } = useCarga(() => api<NoContado[]>(`/toma-inventario/${id}/no-contados`), [id, version]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [filtro, setFiltro] = useState('');
  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (data ?? []).filter((p) => !q || p.nombre.toLowerCase().includes(q) || p.codigoBarra?.includes(q));
  }, [data, filtro]);
  const todos = lista.length > 0 && lista.every((p) => sel.has(p.id));
  const alternar = (pid: number) => setSel((s) => {
    const x = new Set(s);
    if (x.has(pid)) x.delete(pid);
    else x.add(pid);
    return x;
  });
  const inhabilitar = async () => {
    if (!confirm(`¿Inhabilitar ${sel.size} producto(s)? Dejan de aparecer en la venta y su stock queda igual. Se pueden volver a activar en Productos.`)) return;
    try {
      const r = await api<{ inhabilitados: number }>('/toma-inventario/inhabilitar', { body: { productoIds: [...sel] } });
      avisar(`${r.inhabilitados} producto(s) inhabilitados`);
      setSel(new Set());
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <input placeholder="Filtrar por nombre o código" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 360 }} />
        <button className="btn btn-danger" disabled={!sel.size} onClick={inhabilitar}>Inhabilitar seleccionados ({sel.size})</button>
      </div>
      {!data ? null : lista.length ? (
        <div className="table-wrap" style={{ maxHeight: '60vh' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" aria-label="Seleccionar todos" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(lista.map((p) => p.id)))} />
                </th>
                <th>Producto</th><th>Código</th><th>Categoría</th><th className="num">Stock del sistema</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} onClick={() => alternar(p.id)} style={{ cursor: 'pointer' }}>
                  <td><input type="checkbox" aria-label={`Seleccionar ${p.nombre}`} checked={sel.has(p.id)} onChange={() => alternar(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td>{p.nombre}</td>
                  <td>{p.codigoBarra ?? <span className="muted">Sin código</span>}</td>
                  <td>{p.categoria?.nombre ?? '—'}</td>
                  <td className="num">{qty(p.stock)} {p.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Vacio>{data.length ? 'Ningún producto coincide.' : 'Todos los productos activos fueron contados.'}</Vacio>
      )}
      <div className="card-pad muted">Al validar, los productos no contados conservan su stock. Inhabilitar solo los oculta de la venta.</div>
    </div>
  );
}

function EditarItem({ item, onClose, alGuardar }: { item: Item; onClose: () => void; alGuardar: () => void }) {
  const avisar = useToast();
  const [cantidad, setCantidad] = useState(String(n(item.cantidad)));
  const [lotes, setLotes] = useState(() => item.lotes.map((l) => ({ fecha: l.fecha, cantidad: String(l.cantidad) })));
  const porFecha = lotes.length > 0 || item.producto.controlaVencimiento;
  const total = Math.round(lotes.reduce((s, l) => s + (Number(l.cantidad) || 0), 0) * 1000) / 1000;
  const filasOk = lotes.every((l) => l.fecha && l.cantidad !== '' && Number(l.cantidad) >= 0);
  const valido = porFecha ? filasOk : cantidad !== '' && Number(cantidad) >= 0;
  const cambiar = (i: number, campo: 'fecha' | 'cantidad', v: string) => setLotes((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  const guardar = async () => {
    try {
      const detalle = lotes.filter((l) => Number(l.cantidad) > 0).map((l) => ({ fecha: l.fecha, cantidad: Number(l.cantidad) }));
      await api(`/toma-inventario/items/${item.id}`, { method: 'PATCH', body: { cantidad: porFecha ? total : Number(cantidad), lotes: porFecha ? detalle : [] } });
      alGuardar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo={`Corregir: ${item.producto.nombre}`}
      onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={guardar} disabled={!valido}>Guardar</button></>}
    >
      <div className="stack">
        {porFecha ? (
          <>
            <table>
              <thead><tr><th>Vence el</th><th className="num">Cantidad ({item.producto.unidad})</th><th /></tr></thead>
              <tbody>
                {lotes.map((l, i) => (
                  <tr key={i}>
                    <td><input type="date" value={l.fecha} onChange={(e) => cambiar(i, 'fecha', e.target.value)} /></td>
                    <td><input className="num" type="number" min={0} step="any" value={l.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} /></td>
                    <td className="actions"><button className="btn btn-sm btn-ghost" onClick={() => setLotes((ls) => ls.filter((_, j) => j !== i))} aria-label="Quitar fecha">✕</button></td>
                  </tr>
                ))}
                <tr><td><b>Total</b></td><td className="num"><b>{qty(total)}</b></td><td /></tr>
              </tbody>
            </table>
            <div className="row">
              <button className="btn btn-sm" onClick={() => setLotes((ls) => [...ls, { fecha: '', cantidad: '' }])}>+ Agregar fecha</button>
              {!item.producto.controlaVencimiento && lotes.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={() => (setCantidad(String(total)), setLotes([]))}>Quitar fechas</button>
              )}
            </div>
            {!filasOk && <div className="texto-danger small">Cada cantidad necesita su fecha.</div>}
          </>
        ) : (
          <>
            <Campo label={`Cantidad contada (${item.producto.unidad})`}>
              <input className="num" type="number" min={0} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
            </Campo>
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLotes([{ fecha: '', cantidad }])}>Detallar por fecha de vencimiento</button>
          </>
        )}
        <div className="muted">
          Conteos recibidos: {item.conteos.map((c) => `${c.operador.nombre} ${qty(c.cantidad)}${c.lotes.length ? ` (${textoLotes(c.lotes)})` : ''}`).join(' · ')}
        </div>
      </div>
    </Modal>
  );
}

function Validar({ detalle, onClose, alValidar }: { detalle: Detalle; onClose: () => void; alValidar: () => void }) {
  const avisar = useToast();
  const [ocupado, setOcupado] = useState(false);
  const resumen = useMemo(() => {
    let sobran = 0;
    let faltan = 0;
    let valor = 0;
    let cambios = 0;
    for (const it of detalle.items) {
      const d = diferencia(it);
      if (Math.abs(d) < 0.0005) continue;
      cambios++;
      if (d > 0) sobran += d;
      else faltan -= d;
      valor += d * n(it.producto.costo);
    }
    return { sobran, faltan, valor, cambios, vencimientos: detalle.items.filter((it) => it.lotes.length).length };
  }, [detalle]);
  const validar = async () => {
    setOcupado(true);
    try {
      const r = await api<{ productos: number; ajustados: number }>(`/toma-inventario/${detalle.id}/validar`, { method: 'POST' });
      avisar(`Stock actualizado: ${r.ajustados} de ${r.productos} productos cambiaron`);
      alValidar();
    } catch (e) {
      avisar((e as Error).message, true);
      setOcupado(false);
    }
  };
  return (
    <Modal
      titulo="Validar inventario"
      onClose={onClose}
      pie={<><button className="btn" onClick={onClose}>Volver a revisar</button><button className="btn btn-confirmar" onClick={validar} disabled={ocupado}>{ocupado ? 'Actualizando…' : 'Validar y actualizar stock'}</button></>}
    >
      <div className="stack">
        <div className="inv-cifras">
          <div><span>Productos contados</span><b>{detalle.items.length}</b></div>
          <div><span>Cambian de stock</span><b>{resumen.cambios}</b></div>
          <div><span>Unidades que sobran</span><b className="texto-ok">+{qty(resumen.sobran)}</b></div>
          <div><span>Unidades que faltan</span><b className="texto-danger">−{qty(resumen.faltan)}</b></div>
        </div>
        <p>Diferencia valorizada al costo: <b className={resumen.valor < 0 ? 'texto-danger' : 'texto-ok'}>{money(resumen.valor)}</b></p>
        <ul className="muted">
          <li>Cada diferencia queda en el kardex como movimiento <b>Inventario #{detalle.id}</b>.</li>
          <li>Lo vendido mientras se contaba no se pierde: se aplica solo la diferencia sobre el stock actual.</li>
          {resumen.vencimientos > 0 && <li>{resumen.vencimientos} producto(s) quedarán con los lotes contados (fecha y cantidad); sus lotes anteriores se reemplazan.</li>}
          <li>Los {Math.max(0, detalle.totalProductos - detalle.items.length)} productos no contados conservan su stock.</li>
        </ul>
      </div>
    </Modal>
  );
}
