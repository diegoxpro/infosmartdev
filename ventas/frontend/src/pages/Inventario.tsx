import { useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import BuscadorProducto from '../components/BuscadorProducto';
import MermaModal, { MermaInicial } from '../components/MermaModal';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { fechaHora, money, n, qty } from '../format';
import { Movimiento, Producto } from '../types';

const TIPOS: Record<string, { label: string; clase: string }> = {
  IMPORTACION: { label: 'Importación', clase: '' },
  COMPRA: { label: 'Compra', clase: 'ok' },
  ANULACION_COMPRA: { label: 'Anula compra', clase: 'danger' },
  VENTA: { label: 'Venta', clase: 'info' },
  ANULACION_VENTA: { label: 'Anula venta', clase: 'warn' },
  MERMA: { label: 'Merma', clase: 'danger' },
  AJUSTE: { label: 'Ajuste', clase: 'accent' },
  INVENTARIO: { label: 'Inventario', clase: 'accent' },
};

export default function Inventario() {
  const [tab, setTab] = useState<'movimientos' | 'mermas'>('movimientos');
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Inventario y mermas</h1>
          <p>Cada entrada y salida de stock queda registrada aquí.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'movimientos' ? 'active' : ''} onClick={() => setTab('movimientos')}>Movimientos de stock</button>
        <button className={tab === 'mermas' ? 'active' : ''} onClick={() => setTab('mermas')}>Mermas</button>
      </div>
      {tab === 'movimientos' ? <Movimientos /> : <Mermas />}
    </div>
  );
}

function Movimientos() {
  const { puede } = useAuth();
  const [producto, setProducto] = useState<Producto | null>(null);
  const [tipo, setTipo] = useState('');
  const [ajuste, setAjuste] = useState(false);
  const [merma, setMerma] = useState<MermaInicial | null>(null);
  const { data, recargar, cargando } = useCarga(
    () => api<Movimiento[]>(`/inventario/movimientos${qs({ productoId: producto?.id, tipo })}`),
    [producto?.id, tipo],
  );
  const actualizar = async () => {
    recargar();
    if (producto) setProducto(await api<Producto>(`/productos/${producto.id}`));
  };

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <div className="row grow">
          <div style={{ width: 380 }}>
            <BuscadorProducto onElegir={setProducto} placeholder="Filtrar por producto (escanea o escribe)" />
          </div>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 180 }}>
            <option value="">Todos los tipos</option>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {producto && (
          <div className="row">
            <span className="badge accent">
              {producto.nombre} · stock {qty(producto.stock)}
              <button className="close" style={{ fontSize: 14, padding: 0 }} onClick={() => setProducto(null)} aria-label="Quitar filtro">×</button>
            </span>
            {puede('stock.ajustar') && (
              <>
                <button className="btn btn-sm" onClick={() => setAjuste(true)}>Ajustar stock</button>
                <button className="btn btn-sm" onClick={() => setMerma({ productoId: producto.id, nombre: producto.nombre, costo: n(producto.costo) })}>Merma</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Detalle</th><th className="num">Cantidad</th><th className="num">Stock</th><th>Usuario</th></tr>
          </thead>
          <tbody>
            {data?.map((m) => (
              <tr key={m.id}>
                <td className="small">{fechaHora(m.fecha)}</td>
                <td><span className={`badge ${TIPOS[m.tipo]?.clase ?? ''}`}>{TIPOS[m.tipo]?.label ?? m.tipo}</span></td>
                <td>{m.producto.nombre}</td>
                <td className="small muted">{[m.referencia, m.motivo, m.lote?.codigo && `Lote ${m.lote.codigo}`].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num" style={{ color: n(m.cantidad) < 0 ? 'var(--danger)' : 'var(--ok)' }}>
                  {n(m.cantidad) > 0 ? '+' : ''}{qty(m.cantidad)}
                </td>
                <td className="num">{qty(m.stockResultante)}</td>
                <td className="small">{m.usuario?.nombre ?? 'Sistema'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && !data?.length && <Vacio>Sin movimientos.</Vacio>}
      </div>
      {ajuste && producto && <AjusteModal producto={producto} onClose={() => setAjuste(false)} onListo={() => (setAjuste(false), actualizar())} />}
      {merma && <MermaModal inicial={merma} onClose={() => setMerma(null)} onListo={() => (setMerma(null), actualizar())} />}
    </div>
  );
}

function AjusteModal({ producto, onClose, onListo }: { producto: Producto; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [stockReal, setStockReal] = useState('');
  const [motivo, setMotivo] = useState('Conteo de inventario');
  const dif = stockReal === '' ? 0 : n(stockReal) - n(producto.stock);

  const guardar = async () => {
    try {
      await api('/inventario/ajustes', { body: { productoId: producto.id, stockReal: n(stockReal), motivo } });
      avisar('Stock ajustado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <Modal
      titulo="Ajustar stock al conteo físico"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={stockReal === '' || !dif || motivo.trim().length < 3}>Guardar ajuste</button>
        </>
      }
    >
      <div className="stack">
        <h3>{producto.nombre}</h3>
        <div className="grid-3">
          <Campo label="Stock en sistema"><input className="num" value={qty(producto.stock)} readOnly tabIndex={-1} /></Campo>
          <Campo label="Stock contado"><input className="num" type="number" min="0" step="any" value={stockReal} onChange={(e) => setStockReal(e.target.value)} autoFocus /></Campo>
          <Campo label="Diferencia" ayuda={dif ? money(dif * n(producto.costo)) + ' al costo' : undefined}>
            <input className="num" value={dif > 0 ? `+${qty(dif)}` : qty(dif)} readOnly tabIndex={-1} style={{ color: dif < 0 ? 'var(--danger)' : dif > 0 ? 'var(--ok)' : undefined }} />
          </Campo>
        </div>
        <Campo label="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      </div>
    </Modal>
  );
}

function Mermas() {
  const hoy = new Date();
  const [desde, setDesde] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`);
  const [hasta, setHasta] = useState('');
  const { data, cargando } = useCarga(() => api<{ total: number; items: Movimiento[] }>(`/inventario/mermas${qs({ desde, hasta })}`), [desde, hasta]);
  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'end' }}>
        <div className="row" style={{ alignItems: 'end' }}>
          <Campo label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        </div>
        <div className="num"><div className="small muted">Total mermas al costo</div><b style={{ fontSize: 18, color: 'var(--danger)' }}>{money(data?.total)}</b></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Motivo</th><th className="num">Cantidad</th><th className="num">Costo unit.</th><th className="num">Valor</th><th>Usuario</th></tr></thead>
          <tbody>
            {data?.items.map((m) => (
              <tr key={m.id}>
                <td className="small">{fechaHora(m.fecha)}</td>
                <td>{m.producto.nombre}{m.lote?.codigo && <div className="small muted">Lote {m.lote.codigo}</div>}</td>
                <td>{m.motivo}</td>
                <td className="num">{qty(-n(m.cantidad))}</td>
                <td className="num">{money(m.costoUnitario)}</td>
                <td className="num">{money(m.valor)}</td>
                <td className="small">{m.usuario?.nombre}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && !data?.items.length && <Vacio>Sin mermas en estas fechas.</Vacio>}
      </div>
    </div>
  );
}
