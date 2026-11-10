import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useAutorizacion } from '../autorizacion';
import { BORRADOR_VENTA, guardarBorrador, leerBorrador } from '../borrador';
import BuscadorProducto from '../components/BuscadorProducto';
import ClienteModal from '../components/ClienteModal';
import CobroModal, { PagoVenta } from '../components/CobroModal';
import { Kbd, Modal, useAtajos, useCarga, useToast } from '../components/ui';
import { money, n, qty } from '../format';
import { correlativo, imprimirVenta } from '../ticket';
import { Caja, Cliente, COMPROBANTE_LABEL, Configuracion, Presentacion, Producto, Serie, TipoComprobante, Venta as TVenta } from '../types';

interface Linea {
  producto: Producto;
  /** Si se vende por cajetilla, paquete…; la cantidad es de esa presentación. */
  presentacion?: Presentacion | null;
  cantidad: number;
  /** Precio cambiado a mano; si no, se usa el del nivel elegido. */
  precioManual?: number;
  descuento: number;
}

interface Borrador {
  lineas: Linea[];
  tipo: TipoComprobante;
  nivel: 1 | 2 | 3;
  cliente: Cliente | null;
  descuento: number;
  /** Pagos escritos en el cobro sin confirmar, con el total cobrado; si existen, el cobro se reabre al volver. */
  cobro?: { total: number; pagos: PagoVenta[] };
}

// Cada venta empieza en boleta libre y precio 1.
const vacio: Borrador = { lineas: [], tipo: 'BOLETA_LIBRE', nivel: 1, cliente: null, descuento: 0 };

function recuperarVenta(): Borrador {
  const guardado = leerBorrador<Borrador>(BORRADOR_VENTA);
  // Solo se recupera una venta que tenía productos o cliente; si no, se parte de lo predeterminado.
  return guardado?.lineas?.length || guardado?.cliente ? { ...vacio, lineas: [], ...guardado } : vacio;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const claveDe = (p: Producto, x?: Presentacion | null) => `${p.id}-${x?.id ?? 0}`;
const factorDe = (l: Linea) => n(l.presentacion?.factor ?? 1);

export default function Venta() {
  const avisar = useToast();
  const autorizar = useAutorizacion();
  const { puede } = useAuth();
  const buscador = useRef<HTMLInputElement>(null);
  const { data: caja, cargando: cargandoCaja } = useCarga(() => api<Caja | null>('/caja/actual'), []);
  const { data: cfg } = useCarga(() => api<Configuracion>('/configuracion'), []);
  const { data: series, recargar: recargarSeries } = useCarga(() => api<Serie[]>('/series'), []);

  const [b, setB] = useState<Borrador>(recuperarVenta);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(() => !!b.cobro && b.lineas.length > 0);
  const [enviando, setEnviando] = useState(false);
  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  const [ventaPrevia, setVentaPrevia] = useState<TVenta | null>(null);
  /** Línea que se pidió quitar con Supr; mientras exista se muestra la confirmación. */
  const [porQuitar, setPorQuitar] = useState<string | null>(null);

  // La venta en curso sobrevive a cambiar de módulo, recargar o cerrar la pestaña.
  useEffect(() => guardarBorrador(BORRADOR_VENTA, b), [b]);

  // Al recuperar una venta se traen precio y stock actuales de sus productos.
  useEffect(() => {
    if (!b.lineas.length) return;
    Promise.all(b.lineas.map((l) => api<Producto>(`/productos/${l.producto.id}`).catch(() => null))).then((ps) =>
      setB((x) => ({
        ...x,
        lineas: x.lineas.map((l) => {
          const producto = ps.find((p) => p?.id === l.producto.id) ?? l.producto;
          const presentacion = l.presentacion ? producto.presentaciones?.find((p) => p.id === l.presentacion!.id) ?? l.presentacion : l.presentacion;
          return { ...l, producto, presentacion };
        }),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const precioDe = (l: Linea) => l.precioManual ?? n((l.presentacion ?? l.producto)[`precio${b.nivel}`]);
  const importe = (l: Linea) => r2(l.cantidad * precioDe(l) - l.descuento);
  const subtotal = r2(b.lineas.reduce((s, l) => s + importe(l), 0));
  const total = r2(subtotal - b.descuento);
  const unidades = b.lineas.reduce((s, l) => s + l.cantidad * factorDe(l), 0);
  // Número que tomará la próxima venta (el backend usa la primera serie activa del tipo).
  const serie = series?.find((x) => x.tipo === b.tipo && x.activa);
  const proximo = serie ? correlativo({ serie: serie.serie, numero: serie.ultimoNumero + 1 }) : null;

  const enfocar = () => setTimeout(() => buscador.current?.focus(), 0);
  const set = (cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios }));
  const setLinea = (i: number, cambios: Partial<Linea>) => setB((x) => ({ ...x, lineas: x.lineas.map((l, j) => (j === i ? { ...l, ...cambios } : l)) }));

  // El stock está en unidades: una cajetilla x20 usa 20.
  const unidadesEnCarrito = (productoId: number, excepto?: number) =>
    b.lineas.reduce((s, l, j) => (l.producto.id === productoId && j !== excepto ? s + l.cantidad * factorDe(l) : s), 0);
  const hayStock = (p: Producto, unidades: number) => {
    if (cfg?.permitirVentaSinStock || unidades <= n(p.stock)) return true;
    avisar(n(p.stock) <= 0 ? `${p.nombre} no tiene stock` : `Solo hay ${qty(p.stock)} unidades de ${p.nombre}`, true);
    return false;
  };

  const agregar = (p: Producto, presentacion: Presentacion | null = null) => {
    if (!hayStock(p, unidadesEnCarrito(p.id) + n(presentacion?.factor ?? 1))) return;
    const clave = claveDe(p, presentacion);
    setUltimo(clave);
    setB((x) => {
      const i = x.lineas.findIndex((l) => claveDe(l.producto, l.presentacion) === clave);
      if (i >= 0) return { ...x, lineas: x.lineas.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l)) };
      return { ...x, lineas: [...x.lineas, { producto: p, presentacion, cantidad: 1, descuento: 0 }] };
    });
  };
  const cambiarCantidad = (i: number, cantidad: number) => {
    const l = b.lineas[i];
    if (cantidad > l.cantidad && !hayStock(l.producto, unidadesEnCarrito(l.producto.id, i) + cantidad * factorDe(l))) return;
    setLinea(i, { cantidad });
  };

  // Quita una línea y deja marcada la de al lado, para poder seguir quitando con Supr.
  const quitar = (clave: string) => {
    const i = b.lineas.findIndex((l) => claveDe(l.producto, l.presentacion) === clave);
    if (i < 0) return;
    const vecina = b.lineas[i + 1] ?? b.lineas[i - 1];
    setB((x) => ({ ...x, lineas: x.lineas.filter((l) => claveDe(l.producto, l.presentacion) !== clave) }));
    setUltimo(vecina ? claveDe(vecina.producto, vecina.presentacion) : null);
  };

  const limpiar = useCallback(() => {
    setB(vacio);
    setUltimo(null);
    enfocar();
  }, []);

  const pedirDescuento = () => {
    if (!puede('ventas.descuento')) return avisar('No tienes permiso para dar descuentos', true);
    const v = window.prompt('Descuento total en soles (requiere administrador)', String(b.descuento || ''));
    if (v === null) return;
    const d = r2(n(v));
    if (d < 0 || d >= subtotal) return avisar('El descuento debe ser menor al total', true);
    set({ descuento: d });
  };

  const cobrar = async (pagos: PagoVenta[], imprimir: boolean) => {
    setEnviando(true);
    try {
      const venta = await autorizar(
        (autorizacion) =>
          api<TVenta>('/ventas', {
            body: {
              tipoComprobante: b.tipo,
              nivelPrecio: b.nivel,
              clienteId: b.cliente?.id,
              descuento: b.descuento || undefined,
              items: b.lineas.map((l) => ({
                productoId: l.producto.id,
                presentacionId: l.presentacion?.id,
                cantidad: l.cantidad,
                precioUnitario: l.precioManual,
                descuento: l.descuento || undefined,
              })),
              pagos,
              autorizacion,
            },
          }),
        'La venta tiene un descuento o un precio rebajado. Necesita la clave de un administrador.',
      );
      if (imprimir && cfg) imprimirVenta(venta, cfg);
      setVentaPrevia(venta);
      setCobrando(false);
      recargarSeries();
      limpiar();
    } catch (e) {
      avisar((e as Error).message, true);
      recargarSeries();
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = () => b.lineas.length && window.confirm('¿Cancelar la venta en curso?') && limpiar();

  // Atajos de teclado del punto de venta.
  useAtajos(
    {
      F2: () => buscador.current?.focus(),
      F4: () => set({ tipo: b.tipo === 'BOLETA' ? 'BOLETA_LIBRE' : 'BOLETA' }),
      F6: () => set({ nivel: ((b.nivel % 3) + 1) as 1 | 2 | 3 }),
      F7: () => setEligiendoCliente(true),
      F8: () => b.lineas.length && pedirDescuento(),
      F9: () => b.lineas.length && total > 0 && setCobrando(true),
      F10: cancelar,
      F11: () => !b.lineas.length && ventaPrevia && cfg && imprimirVenta(ventaPrevia, cfg),
    },
    { activo: !!caja },
  );

  // Supr pide quitar el producto marcado; ↑ y ↓ cambian cuál está marcado.
  // No interfiere al escribir: si el cursor está en un campo con texto, las teclas hacen lo de siempre.
  useEffect(() => {
    if (!caja) return;
    const tecla = (e: KeyboardEvent) => {
      if (!['Delete', 'ArrowUp', 'ArrowDown'].includes(e.key) || !b.lineas.length) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const foco = document.activeElement;
      const enCampo = foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement || foco instanceof HTMLSelectElement;
      // En el buscador vacío sí valen; en cantidad, precio o con texto escrito, no.
      if (enCampo && !(foco === buscador.current && !buscador.current.value)) return;
      const claves = b.lineas.map((l) => claveDe(l.producto, l.presentacion));
      const i = ultimo ? claves.indexOf(ultimo) : -1;
      e.preventDefault();
      if (e.key === 'Delete') return setPorQuitar(i >= 0 ? claves[i] : claves[claves.length - 1]);
      const j = i < 0 ? claves.length - 1 : e.key === 'ArrowUp' ? Math.max(i - 1, 0) : Math.min(i + 1, claves.length - 1);
      setUltimo(claves[j]);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [caja, b.lineas, ultimo]);

  const lineaPorQuitar = porQuitar ? b.lineas.find((l) => claveDe(l.producto, l.presentacion) === porQuitar) : undefined;

  if (cargandoCaja) return null;
  if (!caja) {
    return (
      <div className="card card-pad stack" style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <h1>La caja está cerrada</h1>
        <p className="muted" style={{ margin: 0 }}>Para vender, primero abre la caja con el monto inicial.</p>
        <div><Link className="btn btn-primary" to="/caja">Abrir caja</Link></div>
      </div>
    );
  }

  return (
    <div className="pos">
      <div className="card pos-main">
        <div className="pos-bar">
          <div className="search">
            <BuscadorProducto ref={buscador} onElegir={agregar} conPresentaciones placeholder="Escanea o escribe el producto (F2)" />
          </div>
          <div className="pos-opcion">
            <div className="segmented" role="group" aria-label="Comprobante (F4)">
              {(['BOLETA', 'BOLETA_LIBRE'] as const).map((t) => (
                <button key={t} className={b.tipo === t ? 'on' : ''} onClick={() => set({ tipo: t })}>{COMPROBANTE_LABEL[t]}</button>
              ))}
            </div>
            <div className="small muted">
              <Kbd>F4</Kbd> N.º <b className="mono">{proximo ?? 'sin serie activa'}</b>
            </div>
          </div>
          <div className="pos-opcion">
            <div className="segmented" role="group" aria-label="Nivel de precio (F6)">
              {([1, 2, 3] as const).map((k) => (
                <button key={k} className={b.nivel === k ? 'on' : ''} onClick={() => set({ nivel: k })} title={`Precio ${k}`}>P{k}</button>
              ))}
            </div>
            <div className="small muted"><Kbd>F6</Kbd> Precio</div>
          </div>
        </div>
        <div className="pos-items">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ width: 150, textAlign: 'center' }}>Cantidad</th>
                <th className="num" style={{ width: 120 }}>Precio</th>
                <th className="num" style={{ width: 110 }}>Importe</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {b.lineas.map((l, i) => (
                <tr
                  key={claveDe(l.producto, l.presentacion)}
                  className={ultimo === claveDe(l.producto, l.presentacion) ? 'ultimo' : ''}
                  // Clic o foco en la fila la marca, para quitarla con Supr.
                  onMouseDown={() => setUltimo(claveDe(l.producto, l.presentacion))}
                  onFocus={() => setUltimo(claveDe(l.producto, l.presentacion))}
                >
                  <td>
                    {l.producto.nombre}
                    {l.presentacion && <span className="badge info" style={{ marginLeft: 6 }}>{l.presentacion.nombre} · {qty(l.presentacion.factor)} und</span>}
                    <div className="small muted">
                      <span className="mono">{(l.presentacion ? l.presentacion.codigoBarra : l.producto.codigoBarra) ?? 'sin código'}</span> · stock {qty(l.producto.stock)} und
                      {l.descuento > 0 && <span className="badge accent" style={{ marginLeft: 6 }}>Dscto {money(l.descuento)}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="qty">
                      <button className="btn" onClick={() => (l.cantidad > 1 ? setLinea(i, { cantidad: l.cantidad - 1 }) : null)} aria-label="Menos">−</button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={l.cantidad}
                        onChange={(e) => n(e.target.value) > 0 && cambiarCantidad(i, n(e.target.value))}
                        onKeyDown={(e) => e.key === 'Enter' && enfocar()}
                      />
                      <button className="btn" onClick={() => cambiarCantidad(i, l.cantidad + 1)} aria-label="Más">+</button>
                    </div>
                  </td>
                  <td className="num">
                    <input
                      className="num"
                      style={{ height: 32 }}
                      type="number"
                      step="0.1"
                      min="0"
                      value={precioDe(l)}
                      onChange={(e) => setLinea(i, { precioManual: e.target.value === '' ? undefined : n(e.target.value) })}
                      onKeyDown={(e) => e.key === 'Enter' && enfocar()}
                      title="Bajar el precio requiere al administrador"
                    />
                  </td>
                  <td className="num"><b>{money(importe(l))}</b></td>
                  <td>
                    <button className="close" onClick={() => setB((x) => ({ ...x, lineas: x.lineas.filter((_, j) => j !== i) }))} aria-label="Quitar">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!b.lineas.length && (
            <div className="empty">
              Escanea un producto para empezar.
              {ventaPrevia && (
                <div style={{ marginTop: 12 }}>
                  Última venta: <b className="mono">{correlativo(ventaPrevia)}</b> por {money(ventaPrevia.total)}
                  {n(ventaPrevia.vuelto) > 0 && <> · vuelto <b>{money(ventaPrevia.vuelto)}</b></>}{' '}
                  <button className="btn btn-sm" onClick={() => cfg && imprimirVenta(ventaPrevia, cfg)}>Reimprimir <Kbd>F11</Kbd></button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="atajos">
          <span><Kbd>F2</Kbd> Buscar</span>
          <span><Kbd>F4</Kbd> Boleta / libre</span>
          <span><Kbd>F6</Kbd> Precio 1-2-3</span>
          <span><Kbd>F7</Kbd> Cliente</span>
          <span><Kbd>F8</Kbd> Descuento</span>
          <span><Kbd>F9</Kbd> Cobrar</span>
          <span><Kbd>Supr</Kbd> Quitar producto</span>
          <span><Kbd>F10</Kbd> Cancelar venta</span>
        </div>
      </div>

      <div className="pos-side">
        <div className="card pos-total">
          <div className="label">
            {COMPROBANTE_LABEL[b.tipo]} {proximo && <span className="mono">{proximo}</span>} · Precio {b.nivel}
          </div>
          <div className="monto">{money(total)}</div>
          <div className="small muted">{b.lineas.length} productos · {qty(unidades)} unidades</div>
          {b.descuento > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              Subtotal {money(subtotal)} · descuento <b>−{money(b.descuento)}</b>{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => set({ descuento: 0 })}>Quitar</button>
            </div>
          )}
        </div>
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="small muted">Cliente</div>
              <b>{b.cliente?.nombre ?? 'Público general'}</b>
              {b.cliente?.numeroDoc && <div className="small mono muted">{b.cliente.tipoDoc} {b.cliente.numeroDoc}</div>}
            </div>
            <button className="btn btn-sm" onClick={() => setEligiendoCliente(true)}>Cambiar <Kbd>F7</Kbd></button>
          </div>
          <button className="btn" onClick={pedirDescuento} disabled={!b.lineas.length}>Aplicar descuento <Kbd>F8</Kbd></button>
        </div>
        <button className="btn btn-primary btn-cobrar" disabled={!b.lineas.length || total <= 0} onClick={() => setCobrando(true)}>
          Cobrar <Kbd>F9</Kbd>
        </button>
        <button className="btn" disabled={!b.lineas.length} onClick={cancelar}>Cancelar venta <Kbd>F10</Kbd></button>
        <div className="small muted" style={{ textAlign: 'center' }}>
          Caja #{caja.id} abierta por {caja.usuarioApertura.nombre}
        </div>
      </div>

      {cobrando && (
        <CobroModal
          total={total}
          enviando={enviando}
          // Si el total cambió (por ejemplo, subió un precio) el cobro empieza de cero.
          key={total}
          inicial={b.cobro?.total === total ? b.cobro.pagos : undefined}
          onCambio={(pagos) => set({ cobro: { total, pagos } })}
          onClose={() => (setCobrando(false), set({ cobro: undefined }), enfocar())}
          onConfirmar={cobrar}
        />
      )}
      {lineaPorQuitar && (
        <ConfirmarQuitar
          linea={lineaPorQuitar}
          importe={importe(lineaPorQuitar)}
          onCancelar={() => (setPorQuitar(null), enfocar())}
          onConfirmar={() => (quitar(porQuitar!), setPorQuitar(null), enfocar())}
        />
      )}
      {eligiendoCliente && (
        <ClienteModal
          onClose={() => (setEligiendoCliente(false), enfocar())}
          onElegir={(c) => (set({ cliente: c }), setEligiendoCliente(false), enfocar())}
        />
      )}
    </div>
  );
}

/** Confirmación al quitar un producto con Supr: Enter elimina, Esc cancela. */
function ConfirmarQuitar({ linea, importe, onCancelar, onConfirmar }: { linea: Linea; importe: number; onCancelar: () => void; onConfirmar: () => void }) {
  // Enter elimina, salvo que el foco esté en un botón (entonces vale ese botón, p. ej. Cancelar con Tab).
  useAtajos({ Enter: (e) => (document.activeElement instanceof HTMLButtonElement ? (document.activeElement as HTMLButtonElement).click() : onConfirmar(), void e) }, { enModal: true });
  return (
    <Modal
      titulo="Eliminar producto"
      onClose={onCancelar}
      pie={
        <>
          <button className="btn" onClick={onCancelar}>Cancelar <Kbd>Esc</Kbd></button>
          <button className="btn btn-danger" onClick={onConfirmar}>Eliminar <Kbd>Enter</Kbd></button>
        </>
      }
    >
      <p style={{ margin: 0 }}>¿Desea eliminar este producto?</p>
      <p style={{ margin: '8px 0 0' }}>
        <b>{linea.producto.nombre}</b>
        {linea.presentacion && <> · {linea.presentacion.nombre}</>}
        <span className="muted"> · cantidad {qty(linea.cantidad)} · {money(importe)}</span>
      </p>
    </Modal>
  );
}
