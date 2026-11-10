import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { diasHasta, equivalencia, fecha, margenReal, money, n, precioSugerido, qty } from '../format';
import { Catalogo, Configuracion, Producto } from '../types';
import { Campo, Modal, useCarga, useToast } from './ui';

const UNIDADES = ['UND', 'BLLA', 'FCO', 'BSA', 'SCH', 'CJA', 'PQT', 'DOC', 'KG', 'LT'];

interface FilaPresentacion {
  id?: number;
  nombre: string;
  factor: string;
  codigoBarra: string;
  precio1: string;
  precio2: string;
  precio3: string;
}

interface Props {
  producto?: Producto;
  /** Datos para empezar un producto nuevo (p. ej. el código escaneado en una compra). */
  inicial?: { codigoBarra?: string; nombre?: string };
  /** Se registra desde una compra: el stock entra con la compra, no se pide stock inicial. */
  desdeCompra?: boolean;
  onClose: () => void;
  onGuardado: (p: Producto) => void;
}

export default function ProductoForm({ producto, inicial, desdeCompra, onClose, onGuardado }: Props) {
  const avisar = useToast();
  const { puede } = useAuth();
  const { data: cfg } = useCarga(() => api<Configuracion>('/configuracion'), []);
  const { data: categorias, setData: setCategorias } = useCarga(() => api<Catalogo[]>('/categorias'), []);
  const { data: marcas, setData: setMarcas } = useCarga(() => api<Catalogo[]>('/marcas'), []);
  const { data: detalle } = useCarga(() => (producto ? api<Producto>(`/productos/${producto.id}`) : Promise.resolve(null)), [producto?.id]);

  const [f, setF] = useState({
    codigoBarra: producto?.codigoBarra ?? inicial?.codigoBarra ?? '',
    nombre: producto?.nombre ?? inicial?.nombre?.toUpperCase() ?? '',
    categoriaId: producto?.categoriaId ?? '',
    marcaId: producto?.marcaId ?? '',
    unidad: producto?.unidad ?? 'UND',
    afectacionIgv: producto?.afectacionIgv ?? 'EXONERADO',
    costo: String(n(producto?.costo)),
    precio1: String(n(producto?.precio1)),
    precio2: String(n(producto?.precio2)),
    precio3: String(n(producto?.precio3)),
    margen1: producto?.margen1 != null ? String(n(producto.margen1)) : '',
    margen2: producto?.margen2 != null ? String(n(producto.margen2)) : '',
    margen3: producto?.margen3 != null ? String(n(producto.margen3)) : '',
    stockMinimo: String(n(producto?.stockMinimo)),
    stockInicial: '',
    controlaVencimiento: producto?.controlaVencimiento ?? false,
    activo: producto?.activo ?? true,
  });
  const [pres, setPres] = useState<FilaPresentacion[]>(() =>
    (producto?.presentaciones ?? []).map((x) => ({
      id: x.id,
      nombre: x.nombre,
      factor: String(n(x.factor)),
      codigoBarra: x.codigoBarra ?? '',
      precio1: String(n(x.precio1)),
      precio2: String(n(x.precio2)),
      precio3: String(n(x.precio3)),
    })),
  );
  const setP = (i: number, k: keyof FilaPresentacion, v: string) => setPres((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const presIncompleta = pres.some((x) => !x.nombre.trim() || n(x.factor) <= 1 || n(x.precio1) <= 0);
  // Una sola fecha por producto (igual que en el inventario): todo el stock vence ese día.
  const [vence, setVence] = useState('');
  const [venceInicial, setVenceInicial] = useState('');
  const fechasLotes = [...new Set((detalle?.lotes ?? []).map((l) => l.fechaVencimiento.slice(0, 10)))].sort();
  useEffect(() => {
    if (!detalle) return;
    const primera = fechasLotes[0] ?? '';
    setVence(primera);
    setVenceInicial(primera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalle]);
  const stockActual = producto ? n(producto.stock) : n(f.stockInicial);
  const [revisado, setRevisado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const margenDefecto = (i: 1 | 2 | 3) => n(cfg?.[`margen${i}`]);
  const margenDe = (i: 1 | 2 | 3) => (f[`margen${i}`] !== '' ? n(f[`margen${i}`]) : margenDefecto(i));
  const calcular = (i: 1 | 2 | 3) => set(`precio${i}`, String(precioSugerido(n(f.costo), margenDe(i), n(cfg?.redondeoPrecio ?? 0.1))));
  // Precio de una presentación con el mismo margen, sobre el costo de todas sus unidades.
  const calcularPres = (i: number) =>
    setPres((l) =>
      l.map((x, j) =>
        j === i
          ? {
              ...x,
              ...Object.fromEntries(
                ([1, 2, 3] as const).map((k) => [`precio${k}`, String(precioSugerido(n(f.costo) * n(x.factor), margenDe(k), n(cfg?.redondeoPrecio ?? 0.1)))]),
              ),
            }
          : x,
      ),
    );

  const nuevoCatalogo = async (tipo: 'categorias' | 'marcas') => {
    const nombre = window.prompt(tipo === 'categorias' ? 'Nombre de la nueva categoría' : 'Nombre de la nueva marca');
    if (!nombre?.trim()) return;
    const c = await api<Catalogo>(`/${tipo}`, { body: { nombre } });
    if (tipo === 'categorias') setCategorias((l) => [...(l ?? []).filter((x) => x.id !== c.id), c].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    else setMarcas((l) => [...(l ?? []).filter((x) => x.id !== c.id), c].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    set(tipo === 'categorias' ? 'categoriaId' : 'marcaId', String(c.id));
  };

  const guardar = async () => {
    setEnviando(true);
    const optNum = (v: string) => (v === '' ? null : n(v));
    const body = {
      codigoBarra: f.codigoBarra.trim() || null,
      nombre: f.nombre.trim().toUpperCase(),
      categoriaId: f.categoriaId === '' ? null : Number(f.categoriaId),
      marcaId: f.marcaId === '' ? null : Number(f.marcaId),
      unidad: f.unidad,
      afectacionIgv: f.afectacionIgv,
      costo: n(f.costo),
      precio1: n(f.precio1),
      precio2: n(f.precio2) || n(f.precio1),
      precio3: n(f.precio3) || n(f.precio1),
      margen1: optNum(f.margen1),
      margen2: optNum(f.margen2),
      margen3: optNum(f.margen3),
      stockMinimo: n(f.stockMinimo),
      controlaVencimiento: f.controlaVencimiento,
      // Solo se manda si cambió, para no rehacer los lotes en cada guardado.
      ...(f.controlaVencimiento && vence && vence !== venceInicial ? { fechaVencimiento: vence } : {}),
      activo: f.activo,
      presentaciones: pres.map((x) => ({
        id: x.id,
        nombre: x.nombre.trim(),
        factor: n(x.factor),
        codigoBarra: x.codigoBarra.trim() || null,
        precio1: n(x.precio1),
        precio2: n(x.precio2) || n(x.precio1),
        precio3: n(x.precio3) || n(x.precio1),
      })),
      ...(producto ? { revisado } : { stockInicial: (!desdeCompra && n(f.stockInicial)) || undefined }),
    };
    try {
      const guardado = await api<Producto>(producto ? `/productos/${producto.id}` : '/productos', { method: producto ? 'PATCH' : 'POST', body });
      avisar(producto ? 'Producto actualizado' : desdeCompra ? 'Producto creado y agregado a la compra' : 'Producto creado');
      onGuardado(guardado);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      ancho
      titulo={producto ? (puede('productos.editar') ? 'Editar producto' : 'Producto') : 'Nuevo producto'}
      onClose={onClose}
      pie={
        puede('productos.editar') && (
          <>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={enviando || f.nombre.trim().length < 2 || n(f.precio1) <= 0 || presIncompleta}>
              {desdeCompra ? 'Guardar y agregar a la compra' : 'Guardar'}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={!puede('productos.editar')} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        {producto?.revisar && (
          <div className="alert warn">
            <div className="grow">
              <b>Revisar:</b> {producto.revisar}
            </div>
            <label className="check">
              <input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} /> Ya lo revisé
            </label>
          </div>
        )}
        {desdeCompra && (
          <div className="alert info">
            <div className="grow">
              Este producto no estaba registrado. Al guardarlo se agrega a la compra; el stock entra cuando guardes la compra.
            </div>
          </div>
        )}
        <div className="grid-3">
          <Campo label="Código de barras" ayuda="Déjalo vacío si no tiene">
            <input className="mono" value={f.codigoBarra} onChange={(e) => set('codigoBarra', e.target.value)} autoFocus={!producto && !f.codigoBarra} />
          </Campo>
          <Campo label="Nombre" className="span-2">
            <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} autoFocus={!producto && !!f.codigoBarra} />
          </Campo>
          <Campo label="Categoría">
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <select value={f.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
                <option value="">Sin categoría</option>
                {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn" title="Nueva categoría" onClick={() => nuevoCatalogo('categorias')}>+</button>
            </div>
          </Campo>
          <Campo label="Marca">
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <select value={f.marcaId} onChange={(e) => set('marcaId', e.target.value)}>
                <option value="">Sin marca</option>
                {marcas?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn" title="Nueva marca" onClick={() => nuevoCatalogo('marcas')}>+</button>
            </div>
          </Campo>
          <div className="grid-2" style={{ gap: 12 }}>
            <Campo label="Unidad">
              <select value={f.unidad} onChange={(e) => set('unidad', e.target.value)}>
                {[...new Set([f.unidad, ...UNIDADES])].map((u) => <option key={u}>{u}</option>)}
              </select>
            </Campo>
            <Campo label="IGV">
              <select value={f.afectacionIgv} onChange={(e) => set('afectacionIgv', e.target.value)}>
                <option value="EXONERADO">Exonerado</option>
                <option value="GRAVADO">Gravado</option>
                <option value="INAFECTO">Inafecto</option>
              </select>
            </Campo>
          </div>
        </div>

        <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 className="grow">Costo y precios</h3>
            <span className="small muted">Margen vacío = margen general de Configuración</span>
          </div>
          <div className="grid-4">
            <Campo label="Costo (último)">
              <input className="num" type="number" step="any" min="0" value={f.costo} onChange={(e) => set('costo', e.target.value)} />
            </Campo>
            {([1, 2, 3] as const).map((i) => {
              const real = margenReal(n(f.costo), n(f[`precio${i}`]));
              return (
                <div key={i} className="stack" style={{ gap: 6 }}>
                  <Campo label={`Precio ${i}`} ayuda={real != null ? `Ganancia actual ${real}%` : 'Sin costo registrado'}>
                    <input className="num" type="number" step="0.01" min="0" value={f[`precio${i}`]} onChange={(e) => set(`precio${i}`, e.target.value)} />
                  </Campo>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <input
                      className="num"
                      style={{ height: 30 }}
                      type="number"
                      step="any"
                      min="0"
                      placeholder={`${margenDefecto(i)}`}
                      value={f[`margen${i}`]}
                      onChange={(e) => set(`margen${i}`, e.target.value)}
                      aria-label={`Margen ${i} %`}
                    />
                    <span className="muted">%</span>
                    <button type="button" className="btn btn-sm" onClick={() => calcular(i)} disabled={n(f.costo) <= 0} title="Calcular el precio con este margen">
                      Calcular
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 className="grow">Presentaciones</h3>
            <button type="button" className="btn btn-sm" onClick={() => setPres((l) => [...l, { nombre: '', factor: '', codigoBarra: '', precio1: '', precio2: '', precio3: '' }])}>
              Agregar presentación
            </button>
          </div>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            Para vender o comprar por cajetilla, paquete o caja. El stock se cuenta en unidades ({f.unidad}): vender una cajetilla x20 descuenta 20, y comprar
            5 cajas x20 suma 100.
          </p>
          {pres.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th className="num" style={{ width: 72 }}>Unidades</th>
                  <th style={{ width: 130 }}>Código de barras</th>
                  {[1, 2, 3].map((k) => <th key={k} className="num" style={{ width: 80 }}>Precio {k}</th>)}
                  <th style={{ width: 80 }} />
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {pres.map((x, i) => {
                  const costo = n(f.costo) * n(x.factor);
                  const real = margenReal(costo, n(x.precio1));
                  return (
                    <tr key={x.id ?? `nueva-${i}`}>
                      <td style={{ minWidth: 190 }}>
                        <input value={x.nombre} onChange={(e) => setP(i, 'nombre', e.target.value)} placeholder="Cajetilla x20" aria-label="Nombre de la presentación" />
                        {n(x.factor) > 1 && costo > 0 && (
                          <div className="small muted">
                            Costo {money(costo)}{real != null && n(x.precio1) > 0 ? ` · ganancia ${real}%` : ''} · {money(n(x.precio1) / n(x.factor))} c/u
                          </div>
                        )}
                      </td>
                      <td><input className="num" type="number" min="2" step="any" value={x.factor} onChange={(e) => setP(i, 'factor', e.target.value)} aria-label="Unidades que trae" /></td>
                      <td><input className="mono" value={x.codigoBarra} onChange={(e) => setP(i, 'codigoBarra', e.target.value)} placeholder="Opcional" aria-label="Código de barras" /></td>
                      {([1, 2, 3] as const).map((k) => (
                        <td key={k}>
                          <input className="num" type="number" step="0.01" min="0" value={x[`precio${k}`]} onChange={(e) => setP(i, `precio${k}`, e.target.value)} aria-label={`Precio ${k}`} />
                        </td>
                      ))}
                      <td>
                        <button type="button" className="btn btn-sm" onClick={() => calcularPres(i)} disabled={n(f.costo) <= 0 || n(x.factor) <= 1} title="Calcular los 3 precios con tus márgenes">
                          Calcular
                        </button>
                      </td>
                      <td>
                        <button type="button" className="close" onClick={() => setPres((l) => l.filter((_, j) => j !== i))} aria-label="Quitar presentación">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {presIncompleta && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>Cada presentación necesita nombre, más de 1 unidad y precio 1.</div>}
        </div>

        <div className="grid-4">
          {!producto && !desdeCompra && (
            <Campo label="Stock inicial">
              <input className="num" type="number" step="any" min="0" value={f.stockInicial} onChange={(e) => set('stockInicial', e.target.value)} />
            </Campo>
          )}
          {producto && (
            <Campo label="Stock actual" ayuda={equivalencia(producto.stock, producto.presentaciones) ? `= ${equivalencia(producto.stock, producto.presentaciones)}` : 'Se cambia con compras, ventas o ajustes'}>
              <input className="num" value={qty(producto.stock)} readOnly tabIndex={-1} />
            </Campo>
          )}
          <Campo label="Stock mínimo" ayuda="Avisa cuando llegue a este número">
            <input className="num" type="number" step="any" min="0" value={f.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value)} />
          </Campo>
          <div className="field" style={{ justifyContent: 'center' }}>
            <label className="check">
              <input type="checkbox" checked={f.controlaVencimiento} onChange={(e) => set('controlaVencimiento', e.target.checked)} />
              Controlar vencimiento
            </label>
          </div>
          <div className="field" style={{ justifyContent: 'center' }}>
            <label className="check">
              <input type="checkbox" checked={f.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo
            </label>
          </div>
        </div>

        {f.controlaVencimiento && (
          <div className="grid-4">
            <Campo
              label="Fecha de vencimiento"
              ayuda={
                vence && diasHasta(vence) < 0
                  ? 'Esta fecha ya pasó: el producto saldrá como vencido'
                  : vence && vence !== venceInicial && fechasLotes.length > 1
                    ? 'Todo el stock vencerá en esta fecha'
                    : 'Opcional. Las compras pueden traer otra fecha'
              }
            >
              <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
            </Campo>
            {vence && stockActual <= 0 && (
              <div className="small muted span-3" style={{ alignSelf: 'center' }}>
                {producto ? 'El producto no tiene stock: la fecha se registrará cuando entre mercadería en una compra.' : 'Pon el stock inicial para que esa cantidad quede con esta fecha.'}
              </div>
            )}
            {fechasLotes.length > 1 && vence === venceInicial && (
              <div className="small muted span-3" style={{ alignSelf: 'center' }}>
                Hay {fechasLotes.length} lotes con fechas distintas (abajo). Si cambias la fecha, todo el stock vencerá en la nueva.
              </div>
            )}
          </div>
        )}

        {detalle?.lotes && detalle.lotes.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 8 }}>Lotes con stock</h3>
            <table className="card">
              <thead>
                <tr><th>Lote</th><th>Vence</th><th className="num">Cantidad</th></tr>
              </thead>
              <tbody>
                {detalle.lotes.map((l) => (
                  <tr key={l.id}>
                    <td>{l.codigo ?? `#${l.id}`}</td>
                    <td>{fecha(l.fechaVencimiento)}</td>
                    <td className="num">{qty(l.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {producto && (
          <div className="small muted">
            Valor del stock al costo: {money(n(producto.stock) * n(producto.costo))}
            {producto.codigoAnterior && <> · Id SysVent {producto.codigoAnterior.split(':')[0]}</>}
          </div>
        )}
      </fieldset>
    </Modal>
  );
}
