import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BORRADOR_COMPRA, borrarBorrador, guardarBorrador, leerBorrador } from '../borrador';
import BuscadorProducto from '../components/BuscadorProducto';
import BuscadorProveedor from '../components/BuscadorProveedor';
import OrigenPago from '../components/OrigenPago';
import ProductoForm from '../components/ProductoForm';
import ProveedorForm from '../components/ProveedorForm';
import SugerenciasModal from '../components/SugerenciasModal';
import { Campo, Kbd, useAtajos, useCarga, useToast, Vacio } from '../components/ui';
import { hoyISO, money, n, qty } from '../format';
import { Compra, DOC_LABEL, MEDIO_LABEL, MEDIOS, MedioPago, OrigenGasto, Presentacion, Producto, Proveedor, Sugerencia, TipoDoc } from '../types';

interface Linea {
  producto: Producto;
  /** Si se compra por caja, paquete…; cantidad y costo son de esa presentación. */
  presentacion?: Presentacion | null;
  cantidad: string;
  costo: string;
  codigoLote: string;
  fechaVencimiento: string;
  /** Producto que no controla vencimiento pero en esta compra se le anota uno. */
  conVenc?: boolean;
}

/** La línea lleva lote y fecha: el producto ya controla vencimiento o se marcó "Añadir venc.". */
const llevaVenc = (l: Linea) => l.producto.controlaVencimiento || !!l.conVenc;

function enDias(dias: number, desde?: string) {
  if (desde) {
    // Desde la fecha de la factura: se suma en UTC para que no cambie el día por la zona horaria.
    const d = new Date(`${desde}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(Date.now() + dias * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function cabeceraVacia() {
  return {
    proveedorId: '',
    tipoDocumento: 'FACTURA' as TipoDoc,
    serie: '',
    numero: '',
    fechaEmision: hoyISO(),
    condicion: 'CONTADO' as 'CONTADO' | 'CREDITO',
    fechaVencimiento: enDias(15),
    medioPago: 'EFECTIVO' as MedioPago,
    // De dónde sale el pago al contado: acumulado (lo normal) o caja del día.
    origenPago: 'ACUMULADO' as OrigenGasto,
    observacion: '',
  };
}
type Cabecera = ReturnType<typeof cabeceraVacia>;

interface Borrador {
  cab: Cabecera;
  lineas: Linea[];
}

/** Hay borrador cuando ya se escribió algo de la factura o se agregó algún producto. */
export function hayBorradorCompra() {
  const b = leerBorrador<Borrador>(BORRADOR_COMPRA);
  return !!(b?.lineas?.length || b?.cab?.proveedorId || b?.cab?.serie || b?.cab?.numero);
}

export default function NuevaCompra() {
  const avisar = useToast();
  const navegar = useNavigate();
  const buscador = useRef<HTMLInputElement>(null);
  const { data: proveedores, setData: setProveedores } = useCarga(() => api<Proveedor[]>('/proveedores'), []);
  // Lo escrito en el buscador de proveedor cuando no existe: se abre su registro con eso ya puesto.
  const [nuevoProveedor, setNuevoProveedor] = useState<string | null>(null);
  // Lo escaneado o escrito que no existe: se abre el registro del producto con eso ya puesto.
  const [nuevoProducto, setNuevoProducto] = useState<string | null>(null);
  // La compra en curso se recupera al volver al módulo, recargar o reabrir el navegador.
  const [inicial] = useState(() => (hayBorradorCompra() ? leerBorrador<Borrador>(BORRADOR_COMPRA) : null));
  const [cab, setCab] = useState<Cabecera>(() => ({ ...cabeceraVacia(), ...inicial?.cab }));
  const [lineas, setLineas] = useState<Linea[]>(() => inicial?.lineas ?? []);
  const [recuperado, setRecuperado] = useState(!!inicial);
  const terminado = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ compra: Compra; sugerencias: Sugerencia[] } | null>(null);
  const setC = (k: keyof typeof cab, v: string) => setCab((x) => ({ ...x, [k]: v }));
  const proveedor = proveedores?.find((p) => String(p.id) === cab.proveedorId) ?? null;

  /** Si el proveedor da crédito (ej. Backus), se propone Crédito con la fecha de pago según sus días. */
  const elegirProveedor = (p: Proveedor) =>
    setCab((x) => ({
      ...x,
      proveedorId: String(p.id),
      ...(p.diasCredito ? { condicion: 'CREDITO' as const, fechaVencimiento: enDias(p.diasCredito, x.fechaEmision) } : {}),
    }));

  useEffect(() => {
    if (!terminado.current) guardarBorrador(BORRADOR_COMPRA, { cab, lineas });
  }, [cab, lineas]);

  const descartar = () => {
    if (!window.confirm('¿Descartar el borrador y empezar una compra nueva?')) return;
    borrarBorrador(BORRADOR_COMPRA);
    setCab(cabeceraVacia());
    setLineas([]);
    setRecuperado(false);
  };

  const agregar = (p: Producto, presentacion: Presentacion | null = null) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.producto.id === p.id && (l.presentacion?.id ?? 0) === (presentacion?.id ?? 0) && !p.controlaVencimiento);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: String(n(l.cantidad) + 1) } : l));
      // El costo guardado es por unidad; para una caja se propone costo × factor.
      const costo = Math.round(n(p.costo) * n(presentacion?.factor ?? 1) * 10000) / 10000;
      return [...ls, { producto: p, presentacion, cantidad: '1', costo: costo > 0 ? String(costo) : '', codigoLote: '', fechaVencimiento: '' }];
    });
  };
  const setVenc = (i: number, v: boolean) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, conVenc: v, ...(v ? {} : { codigoLote: '', fechaVencimiento: '' }) } : l)));
  const setL = (i: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const setImporte = (i: number, v: string) => {
    const c = n(lineas[i].cantidad);
    if (c > 0) setL(i, 'costo', String(Math.round((n(v) / c) * 10000) / 10000));
  };

  const total = lineas.reduce((s, l) => s + n(l.cantidad) * n(l.costo), 0);
  const faltan = [
    !cab.proveedorId && 'proveedor',
    (!cab.serie.trim() || !cab.numero.trim()) && 'serie y número',
    !lineas.length && 'productos',
    lineas.some((l) => n(l.cantidad) <= 0 || l.costo === '') && 'cantidad y costo de cada producto',
    lineas.some((l) => llevaVenc(l) && !l.fechaVencimiento) && 'fecha de vencimiento',
  ].filter(Boolean);

  const guardar = async () => {
    setEnviando(true);
    try {
      const r = await api<{ compra: Compra; sugerencias: Sugerencia[] }>('/compras', {
        body: {
          proveedorId: Number(cab.proveedorId),
          tipoDocumento: cab.tipoDocumento,
          serie: cab.serie,
          numero: cab.numero,
          fechaEmision: cab.fechaEmision,
          condicion: cab.condicion,
          fechaVencimiento: cab.condicion === 'CREDITO' ? cab.fechaVencimiento : undefined,
          medioPago: cab.condicion === 'CONTADO' ? cab.medioPago : undefined,
          origenPago: cab.condicion === 'CONTADO' ? (cab.origenPago ?? 'ACUMULADO') : undefined,
          observacion: cab.observacion.trim() || undefined,
          items: lineas.map((l) => ({
            productoId: l.producto.id,
            presentacionId: l.presentacion?.id,
            cantidad: n(l.cantidad),
            costoUnitario: n(l.costo),
            codigoLote: (llevaVenc(l) && l.codigoLote.trim()) || undefined,
            fechaVencimiento: (llevaVenc(l) && l.fechaVencimiento) || undefined,
          })),
        },
      });
      terminado.current = true;
      borrarBorrador(BORRADOR_COMPRA);
      avisar(`Compra registrada: ${money(r.compra.total)}`);
      if (r.sugerencias.length) setResultado(r);
      else navegar(`/compras/${r.compra.id}`);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };
  useAtajos({
    F2: () => buscador.current?.focus(),
    F9: () => !enviando && !faltan.length && guardar(),
  });


  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Registrar compra</h1>
          <p>Ingresa la factura del proveedor. El stock y el costo se actualizan al guardar.</p>
        </div>
      </div>

      {recuperado && (
        <div className="card card-pad row" style={{ justifyContent: 'space-between' }}>
          <span>Recuperaste la compra que estabas registrando. Se guarda sola mientras la llenas.</span>
          <button className="btn btn-sm" onClick={descartar}>Descartar borrador</button>
        </div>
      )}

      <div className="card card-pad">
        <div className="grid-4">
          <Campo label="Proveedor" className="span-2">
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <div className="grow">
                <BuscadorProveedor proveedores={proveedores ?? []} elegido={proveedor} onElegir={elegirProveedor} onNuevo={setNuevoProveedor} />
              </div>
              <button type="button" className="btn" onClick={() => setNuevoProveedor('')}>Nuevo</button>
            </div>
          </Campo>
          <Campo label="Documento">
            <select value={cab.tipoDocumento} onChange={(e) => setC('tipoDocumento', e.target.value)}>
              {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <div className="grid-2" style={{ gap: 8, gridTemplateColumns: '90px 1fr' }}>
            <Campo label="Serie"><input className="mono" value={cab.serie} onChange={(e) => setC('serie', e.target.value.toUpperCase())} placeholder="F001" /></Campo>
            <Campo label="Número"><input className="mono" value={cab.numero} onChange={(e) => setC('numero', e.target.value.replace(/\D/g, ''))} /></Campo>
          </div>
          <Campo label="Fecha de emisión"><input type="date" value={cab.fechaEmision} onChange={(e) => {
                const fecha = e.target.value;
                setCab((x) => ({ ...x, fechaEmision: fecha, ...(fecha && x.condicion === 'CREDITO' && proveedor?.diasCredito ? { fechaVencimiento: enDias(proveedor.diasCredito, fecha) } : {}) }));
              }} /></Campo>
          <Campo label="Condición">
            <select value={cab.condicion} onChange={(e) => setC('condicion', e.target.value)}>
              <option value="CONTADO">Contado</option>
              <option value="CREDITO">Crédito</option>
            </select>
          </Campo>
          {cab.condicion === 'CREDITO' ? (
            <Campo label="Vence el pago"><input type="date" value={cab.fechaVencimiento} onChange={(e) => setC('fechaVencimiento', e.target.value)} /></Campo>
          ) : (
            <Campo label="Pagado con">
              <select value={cab.medioPago} onChange={(e) => setC('medioPago', e.target.value)}>
                {MEDIOS.map((m) => <option key={m} value={m}>{MEDIO_LABEL[m]}</option>)}
              </select>
            </Campo>
          )}
          <Campo label="Observación"><input value={cab.observacion} onChange={(e) => setC('observacion', e.target.value)} /></Campo>
          {cab.condicion === 'CONTADO' && (
            <div className="span-4 stack" style={{ gap: 6 }}>
              <b className="small">¿De dónde sale el pago?</b>
              <div style={{ maxWidth: 640 }}>
                <OrigenPago origen={cab.origenPago ?? 'ACUMULADO'} onChange={(o) => setC('origenPago', o)} medio={cab.medioPago} monto={total} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="grow" style={{ maxWidth: 520 }}>
            <BuscadorProducto ref={buscador} onElegir={agregar} conPresentaciones onNuevo={setNuevoProducto} />
          </div>
          <span className="small muted">Enter agrega el producto. Repetir el código suma 1. Si no existe, puedes registrarlo aquí.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num" style={{ width: 110 }}>Cantidad</th>
                <th className="num" style={{ width: 130 }}>Costo unit.</th>
                <th className="num" style={{ width: 130 }}>Importe</th>
                <th style={{ width: 260 }}>Lote y vencimiento</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.producto.nombre}
                    {l.presentacion && <span className="badge info" style={{ marginLeft: 6 }}>{l.presentacion.nombre} · {qty(l.presentacion.factor)} und</span>}
                    <div className="small muted">
                      <span className="mono">{(l.presentacion ? l.presentacion.codigoBarra : l.producto.codigoBarra) ?? 'sin código'}</span> · costo anterior{' '}
                      {n(l.producto.costo) > 0 ? `${money(l.producto.costo)} c/u` : '—'}
                    </div>
                    {l.presentacion && n(l.cantidad) > 0 && (
                      <div className="small muted">
                        Entran {qty(n(l.cantidad) * n(l.presentacion.factor))} und
                        {l.costo !== '' && <> a {money(n(l.costo) / n(l.presentacion.factor))} c/u</>}
                      </div>
                    )}
                  </td>
                  <td><input className="num" type="number" min="0" step="any" value={l.cantidad} onChange={(e) => setL(i, 'cantidad', e.target.value)} /></td>
                  <td><input className="num" type="number" min="0" step="any" value={l.costo} onChange={(e) => setL(i, 'costo', e.target.value)} placeholder="0.00" /></td>
                  <td>
                    <input
                      className="num"
                      type="number"
                      min="0"
                      step="0.01"
                      key={`${l.cantidad}-${l.costo}`}
                      defaultValue={l.costo !== '' ? (n(l.cantidad) * n(l.costo)).toFixed(2) : ''}
                      onBlur={(e) => setImporte(i, e.target.value)}
                      title="Si la factura trae el importe total, escríbelo aquí y se calcula el costo unitario"
                    />
                  </td>
                  <td>
                    {!l.producto.controlaVencimiento && (
                      <label className="check small" title="Anota la fecha de esta compra; el producto pasa a controlar vencimiento">
                        <input type="checkbox" checked={!!l.conVenc} onChange={(e) => setVenc(i, e.target.checked)} /> Añadir venc.
                      </label>
                    )}
                    {llevaVenc(l) && (
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 6, marginTop: l.conVenc ? 4 : 0 }}>
                        <input placeholder="Lote" value={l.codigoLote} onChange={(e) => setL(i, 'codigoLote', e.target.value)} style={{ width: 90 }} />
                        <input type="date" value={l.fechaVencimiento} onChange={(e) => setL(i, 'fechaVencimiento', e.target.value)} aria-label="Vencimiento" autoFocus={l.conVenc} />
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="close" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} aria-label="Quitar">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lineas.length && <Vacio>Escanea o busca los productos de la factura.</Vacio>}
        </div>
        <div className="card-pad row" style={{ borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
          <div className="small muted">{faltan.length ? `Falta: ${faltan.join(', ')}` : `${lineas.length} productos`}</div>
          <div className="row" style={{ gap: 16 }}>
            <div className="totals">
              <span className="muted">Total</span>
              <span className="big">{money(total)}</span>
            </div>
            <button className="btn" onClick={() => navegar('/compras')} title="El borrador queda guardado para continuar después">Salir</button>
            <button className="btn" onClick={descartar} disabled={!lineas.length && !cab.proveedorId && !cab.serie && !cab.numero}>Descartar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={enviando || faltan.length > 0}>
              {enviando ? 'Guardando…' : <>Guardar compra <Kbd>F9</Kbd></>}
            </button>
          </div>
        </div>
      </div>

      {nuevoProveedor !== null && (
        <ProveedorForm
          inicial={nuevoProveedor}
          onClose={() => setNuevoProveedor(null)}
          onGuardado={(p) => {
            setProveedores((l) => [...(l ?? []).filter((x) => x.id !== p.id), p].sort((a, b) => a.razonSocial.localeCompare(b.razonSocial)));
            elegirProveedor(p);
            setNuevoProveedor(null);
          }}
        />
      )}
      {nuevoProducto !== null && (
        <ProductoForm
          desdeCompra
          // Lo que parece código (sin espacios y con 4+ dígitos seguidos) va al código de barras; lo demás es el nombre.
          inicial={/^[A-Za-z0-9-]*\d{4,}[A-Za-z0-9-]*$/.test(nuevoProducto) ? { codigoBarra: nuevoProducto } : { nombre: nuevoProducto }}
          onClose={() => {
            setNuevoProducto(null);
            setTimeout(() => buscador.current?.focus());
          }}
          onGuardado={(p) => {
            agregar(p);
            setNuevoProducto(null);
            setTimeout(() => buscador.current?.focus());
          }}
        />
      )}
      {resultado && <SugerenciasModal sugerencias={resultado.sugerencias} onClose={() => navegar(`/compras/${resultado.compra.id}`)} />}
    </div>
  );
}
