import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import BuscadorProducto from '../components/BuscadorProducto';
import { api, qs, sesion } from '../api';
import { Campo, useCarga, useToast, Vacio } from '../components/ui';
import { fecha, fechaHora, hoyISO, money, qty } from '../format';
import { Configuracion, Producto } from '../types';

export type CategoriaReporte = 'ventas' | 'compras' | 'kardex' | 'sunat' | 'gastos';
interface InfoReporte {
  id: string;
  titulo: string;
  categoria: CategoriaReporte;
  usaFechas: boolean;
  requiereProducto: boolean;
}
const ENCABEZADO: Record<CategoriaReporte, { titulo: string; inicial: string; texto: string }> = {
  ventas: { titulo: 'Reporte de venta', inicial: 'ventas-resumido', texto: 'Ventas, utilidad, medios de pago y cajeros del período.' },
  compras: { titulo: 'Reporte de compra', inicial: 'compras-detallado', texto: 'Facturas de proveedores, compras por producto y pagos realizados.' },
  kardex: { titulo: 'Reporte de kardex', inicial: 'kardex', texto: 'Entradas, salidas y saldo de stock por producto, y stock valorizado.' },
  gastos: { titulo: 'Reporte de gastos', inicial: 'gastos-por-categoria', texto: 'Gastos por categoría y mes, sueldos por trabajador, y movimientos y conteos del acumulado.' },
  sunat: { titulo: 'Boletas SUNAT', inicial: 'boletas-sunat', texto: 'Boletas electrónicas por día con su estado en SUNAT, y fecha y hora de cada envío.' },
};

type TipoColumna = 'texto' | 'moneda' | 'numero' | 'porcentaje' | 'fecha' | 'fechaHora';
interface Reporte {
  titulo: string;
  subtitulo?: string;
  columnas: { clave: string; titulo: string; tipo?: TipoColumna }[];
  filas: Record<string, unknown>[];
  totales?: Record<string, number>;
  agruparPor?: string;
}

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function rango(id: string): [string, string] {
  const h = new Date();
  const dia = (n: number) => new Date(h.getFullYear(), h.getMonth(), h.getDate() + n);
  switch (id) {
    case 'ayer':
      return [iso(dia(-1)), iso(dia(-1))];
    case 'semana': {
      const lunes = dia(-((h.getDay() + 6) % 7));
      return [iso(lunes), hoyISO()];
    }
    case 'mes':
      return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), hoyISO()];
    case 'mes-pasado':
      return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))];
    default:
      return [hoyISO(), hoyISO()];
  }
}
const RAPIDOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes-pasado', label: 'Mes pasado' },
];

function celda(tipo: TipoColumna | undefined, v: unknown) {
  if (v == null || v === '') return '—';
  switch (tipo) {
    case 'moneda':
      return money(v);
    case 'numero':
      return qty(v);
    case 'porcentaje':
      return `${Number(v).toFixed(1)}%`;
    case 'fecha':
      return fecha(String(v));
    case 'fechaHora':
      return fechaHora(String(v));
    default:
      return String(v);
  }
}
const alinear = (t?: TipoColumna) => (t && t !== 'texto' && t !== 'fecha' && t !== 'fechaHora' ? 'num' : '');

export default function Reportes({ categoria }: { categoria: CategoriaReporte }) {
  const avisar = useToast();
  const enc = ENCABEZADO[categoria];
  const [params] = useSearchParams();
  const { data: todos } = useCarga(() => api<InfoReporte[]>('/reportes'), []);
  const lista = todos?.filter((x) => x.categoria === categoria);
  const { data: cfg } = useCarga(() => api<Configuracion>('/configuracion'), []);
  const [actual, setActual] = useState(enc.inicial);
  const [[desde, hasta], setRango] = useState<[string, string]>(rango(categoria === 'ventas' || categoria === 'sunat' ? 'hoy' : 'mes'));
  const [rapido, setRapido] = useState(categoria === 'ventas' || categoria === 'sunat' ? 'hoy' : 'mes');
  const [producto, setProducto] = useState<{ id: number; nombre: string } | null>(null);
  const info = lista?.find((x) => x.id === actual);
  const usaFechas = info?.usaFechas ?? true;
  const requiereProducto = info?.requiereProducto ?? false;

  // Desde otra pantalla se puede abrir el kardex de un producto: /reportes/kardex?producto=12
  const idInicial = Number(params.get('producto'));
  useEffect(() => {
    if (!idInicial) return;
    api<Producto>(`/productos/${idInicial}`)
      .then((p) => setProducto({ id: p.id, nombre: p.nombre }))
      .catch(() => undefined);
  }, [idInicial]);

  const consulta = { ...(usaFechas ? { desde, hasta } : {}), ...(requiereProducto && producto ? { productoId: producto.id } : {}) };
  const listo = !!info && (!requiereProducto || !!producto);
  const { data: r, cargando, error } = useCarga(
    () => (listo ? api<Reporte>(`/reportes/${actual}${qs(consulta)}`) : Promise.resolve(null)),
    [actual, desde, hasta, usaFechas, listo, producto?.id],
  );

  const excel = async () => {
    try {
      const res = await fetch(`/api/reportes/${actual}${qs({ ...consulta, formato: 'xlsx' })}`, {
        headers: { authorization: `Bearer ${sesion.token()}` },
      });
      if (!res.ok) throw new Error('No se pudo generar el Excel');
      const url = URL.createObjectURL(await res.blob());
      const nombre = `${actual}${requiereProducto && producto ? `_${producto.nombre.replace(/[^\w]+/g, '-')}` : ''}${usaFechas ? `_${desde}_${hasta}` : ''}`;
      const a = Object.assign(document.createElement('a'), { href: url, download: `${nombre}.xlsx` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  const grupos = r?.agruparPor
    ? [...new Set(r.filas.map((f) => String(f[r.agruparPor!])))].map((g) => ({ g, filas: r.filas.filter((f) => String(f[r.agruparPor!]) === g) }))
    : null;
  const sumables = r?.totales ? Object.keys(r.totales) : [];

  return (
    <div className="stack">
      <div className="page-head no-print">
        <div>
          <h1>{enc.titulo}</h1>
          <p>{enc.texto} Puedes descargarlo en Excel o imprimirlo y guardarlo como PDF.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={excel} disabled={!r?.filas.length}>Descargar Excel</button>
          <button className="btn" onClick={() => window.print()} disabled={!r}>Imprimir o PDF</button>
        </div>
      </div>

      <div className="card no-print">
        <div className="card-head" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <Campo label="Reporte">
            <select value={actual} onChange={(e) => setActual(e.target.value)} style={{ minWidth: 240 }}>
              {lista?.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
            </select>
          </Campo>
          {requiereProducto && (
            <Campo label="Producto">
              {producto ? (
                <div className="row" style={{ alignItems: 'center' }}>
                  <b style={{ maxWidth: 280 }}>{producto.nombre}</b>
                  <button className="btn" onClick={() => setProducto(null)}>Cambiar</button>
                </div>
              ) : (
                <div style={{ minWidth: 300 }}>
                  <BuscadorProducto placeholder="Escanea o escribe el producto" onElegir={(p) => setProducto({ id: p.id, nombre: p.nombre })} />
                </div>
              )}
            </Campo>
          )}
          {usaFechas && (
            <div className="row" style={{ alignItems: 'end' }}>
              <div className="segmented" role="group" aria-label="Período">
                {RAPIDOS.map((x) => (
                  <button key={x.id} className={rapido === x.id ? 'on' : ''} onClick={() => (setRapido(x.id), setRango(rango(x.id)))}>{x.label}</button>
                ))}
              </div>
              <Campo label="Desde"><input type="date" value={desde} onChange={(e) => (setRapido(''), setRango([e.target.value, hasta]))} /></Campo>
              <Campo label="Hasta"><input type="date" value={hasta} onChange={(e) => (setRapido(''), setRango([desde, e.target.value]))} /></Campo>
            </div>
          )}
        </div>
      </div>

      {requiereProducto && !producto && <Vacio>Elige un producto para ver su kardex.</Vacio>}
      {error && <div className="alert danger">{error}</div>}
      {r && (
        <div className="card" style={{ opacity: cargando ? 0.6 : 1 }}>
          <div className="card-head">
            <div>
              <div className="solo-impresion"><b>{cfg?.empresaNombre}</b></div>
              <h2>{r.titulo}</h2>
              {r.subtitulo && <div className="small muted">{r.subtitulo}</div>}
            </div>
            <span className="small muted">{r.filas.length} filas</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table>
              <thead>
                <tr>{r.columnas.map((c) => <th key={c.clave} className={alinear(c.tipo)}>{c.titulo}</th>)}</tr>
              </thead>
              <tbody>
                {grupos
                  ? grupos.map(({ g, filas }) => {
                      const sub = Object.fromEntries(sumables.map((k) => [k, filas.reduce((s, f) => s + Number(f[k] ?? 0), 0)]));
                      return (
                        <Fragment key={g}>
                          <tr className="reporte-grupo"><td colSpan={r.columnas.length}>{g} ({filas.length})</td></tr>
                          {filas.map((f, i) => <Fila key={i} r={r} f={f} />)}
                          <tr className="reporte-subtotal">
                            {r.columnas.map((c, i) => (
                              <td key={c.clave} className={alinear(c.tipo)}>{i === 0 ? 'Subtotal' : c.clave in sub ? celda(c.tipo, sub[c.clave]) : ''}</td>
                            ))}
                          </tr>
                        </Fragment>
                      );
                    })
                  : r.filas.map((f, i) => <Fila key={i} r={r} f={f} />)}
                {r.totales && r.filas.length > 0 && (
                  <tr className="reporte-total">
                    {r.columnas.map((c, i) => (
                      <td key={c.clave} className={alinear(c.tipo)}>{i === 0 ? 'TOTAL' : c.clave in r.totales! ? celda(c.tipo, r.totales![c.clave]) : ''}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {!r.filas.length && <Vacio>No hay datos en este período.</Vacio>}
          </div>
        </div>
      )}
    </div>
  );
}

function Fila({ r, f }: { r: Reporte; f: Record<string, unknown> }) {
  // En el reporte de utilidad, los montos negativos restan.
  return (
    <tr>
      {r.columnas.map((c) => {
        const v = f[c.clave];
        const negativo = c.tipo === 'moneda' && Number(v) < 0;
        return (
          <td key={c.clave} className={alinear(c.tipo)} style={negativo ? { color: 'var(--danger)' } : undefined}>
            {celda(c.tipo, v)}
          </td>
        );
      })}
    </tr>
  );
}
