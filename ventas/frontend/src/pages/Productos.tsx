import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import ProductoForm from '../components/ProductoForm';
import { Kbd, useAtajos, useCarga, useDebounce, Vacio } from '../components/ui';
import { equivalencia, monto, n, qty } from '../format';
import { Producto } from '../types';

const FILTROS = [
  { id: '', label: 'Todos' },
  { id: 'stock-bajo', label: 'Stock bajo' },
  { id: 'sin-stock', label: 'Sin stock' },
  { id: 'revisar', label: 'Por revisar' },
  { id: 'inactivos', label: 'Inactivos' },
];

export default function Productos() {
  const { puede } = useAuth();
  const [params, setParams] = useSearchParams();
  const filtro = params.get('filtro') ?? '';
  const [texto, setTexto] = useState('');
  const [pagina, setPagina] = useState(1);
  const q = useDebounce(texto.trim(), 250);
  const [editar, setEditar] = useState<Producto | 'nuevo' | null>(null);
  const buscar = useRef<HTMLInputElement>(null);
  useAtajos({
    F2: () => buscar.current?.select(),
    ...(puede('productos.editar') && { F8: () => setEditar('nuevo') }),
  });

  const { data, cargando, recargar } = useCarga(
    () => api<{ total: number; items: Producto[]; porPagina: number }>(`/productos${qs({ q, filtro, pagina, porPagina: 50 })}`),
    [q, filtro, pagina],
  );
  const paginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Productos</h1>
          <p>{data ? `${data.total.toLocaleString('es-PE')} productos` : 'Cargando…'}</p>
        </div>
        {puede('productos.editar') && (
          <button className="btn btn-primary" onClick={() => setEditar('nuevo')}>
            Nuevo producto <Kbd>F8</Kbd>
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-head toolbar">
          <div className="search grow">
            <input
              ref={buscar}
              aria-label="Buscar productos"
              value={texto}
              onChange={(e) => (setTexto(e.target.value), setPagina(1))}
              placeholder="Buscar por nombre o código de barras"
              autoFocus
            />
            <Kbd>F2</Kbd>
          </div>
          <div className="segmented" role="group" aria-label="Filtrar productos">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                aria-pressed={filtro === f.id}
                onClick={() => (setParams(f.id ? { filtro: f.id } : {}), setPagina(1))}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>U.M.</th>
                <th className="num">Stock</th>
                <th className="num">Costo S/</th>
                <th className="num">Precio 1 S/</th>
                <th className="num">Precio 2 S/</th>
                <th className="num">Precio 3 S/</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => {
                const bajo = n(p.stockMinimo) > 0 && n(p.stock) <= n(p.stockMinimo);
                return (
                  <tr
                    key={p.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => setEditar(p)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditar(p)}
                  >
                    <td className="mono muted">{p.codigoBarra ?? '—'}</td>
                    <td>
                      {p.nombre}
                      <div className="row small" style={{ gap: 6, marginTop: 2 }}>
                        {p.marca && <span className="muted">{p.marca.nombre}</span>}
                        {p.categoria && <span className="badge">{p.categoria.nombre}</span>}
                        {p.controlaVencimiento && <span className="badge info">Vence</span>}
                        {p.revisar && <span className="badge warn">Revisar</span>}
                        {p.presentaciones?.map((x) => <span key={x.id} className="badge info">{x.nombre} · {monto(x.precio1)}</span>)}
                      </div>
                    </td>
                    <td className="muted">{p.unidad}</td>
                    <td className="num">
                      {/* Rojo o ámbar solo si el producto tiene mínimo definido; si no, un cero gris. */}
                      <span className={bajo ? (n(p.stock) <= 0 ? 'badge danger' : 'badge warn') : n(p.stock) <= 0 ? 'muted' : ''}>{qty(p.stock)}</span>
                      {equivalencia(p.stock, p.presentaciones) && <div className="small muted">{equivalencia(p.stock, p.presentaciones)}</div>}
                    </td>
                    <td className="num muted">{n(p.costo) > 0 ? monto(p.costo) : '—'}</td>
                    <td className="num"><b>{monto(p.precio1)}</b></td>
                    {/* Precio 2 y 3 se apagan cuando repiten el precio 1: así resalta el que sí cambia. */}
                    <td className={`num${n(p.precio2) === n(p.precio1) ? ' faint' : ''}`}>{monto(p.precio2)}</td>
                    <td className={`num${n(p.precio3) === n(p.precio1) ? ' faint' : ''}`}>{monto(p.precio3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargando && data?.items.length === 0 && <Vacio>No hay productos con ese criterio.</Vacio>}
        </div>
        <div className="pager">
          <span>Página {pagina} de {paginas}</span>
          <div className="row tight">
            <button className="btn btn-sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <button className="btn btn-sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
          </div>
        </div>
      </div>

      {editar && (
        <ProductoForm
          producto={editar === 'nuevo' ? undefined : editar}
          onClose={() => setEditar(null)}
          onGuardado={() => (setEditar(null), recargar())}
        />
      )}
    </div>
  );
}
