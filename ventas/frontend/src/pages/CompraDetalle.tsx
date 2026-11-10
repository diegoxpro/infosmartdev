import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import PagoModal from '../components/PagoModal';
import SugerenciasModal from '../components/SugerenciasModal';
import { useCarga, useToast } from '../components/ui';
import { fecha, fechaHora, money, n, qty } from '../format';
import { Compra, DOC_LABEL, MEDIO_LABEL, Sugerencia } from '../types';

export default function CompraDetalle() {
  const { id } = useParams();
  const avisar = useToast();
  const { puede } = useAuth();
  const { data: c, recargar, error } = useCarga(() => api<Compra>(`/compras/${id}`), [id]);
  const [pagar, setPagar] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);

  if (error) return <div className="alert danger">{error}</div>;
  if (!c) return null;

  const revisarPrecios = async () => {
    const s = await api<Sugerencia[]>(`/compras/${c.id}/sugerencias`);
    if (s.length) setSugerencias(s);
    else avisar('Los precios ya coinciden con tus márgenes');
  };

  const anular = async () => {
    const motivo = window.prompt('¿Por qué anulas esta compra? Se descontará el stock que ingresó.');
    if (!motivo || motivo.trim().length < 3) return;
    try {
      await api(`/compras/${c.id}/anular`, { body: { motivo } });
      avisar('Compra anulada');
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  const anulada = c.estado === 'ANULADA';
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="small"><Link to="/compras">← Compras</Link></div>
          <h1 style={{ marginTop: 6 }}>
            {DOC_LABEL[c.tipoDocumento]} <span className="mono">{c.serie}-{c.numero}</span>
          </h1>
          <p>{c.proveedor.razonSocial}{c.proveedor.ruc && <> · RUC {c.proveedor.ruc}</>}</p>
        </div>
        {puede('compras.registrar') && !anulada && (
          <div className="row">
            <button className="btn" onClick={revisarPrecios}>Revisar precios</button>
            {n(c.saldo) > 0 && <button className="btn btn-primary" onClick={() => setPagar(true)}>Registrar pago</button>}
            <button className="btn btn-danger" onClick={anular}>Anular</button>
          </div>
        )}
      </div>

      {anulada && <div className="alert danger">Compra anulada. {c.observacion}</div>}

      <div className="grid-4">
        <div className="card stat"><div className="label">Emisión</div><div className="value" style={{ fontSize: 18 }}>{fecha(c.fechaEmision)}</div></div>
        <div className="card stat">
          <div className="label">Condición</div>
          <div className="value" style={{ fontSize: 18 }}>
            {c.condicion === 'CREDITO' ? `Crédito · vence ${fecha(c.fechaVencimiento)}` : 'Contado'}
          </div>
        </div>
        <div className="card stat"><div className="label">Total</div><div className="value">{money(c.total)}</div></div>
        <div className={`card stat${n(c.saldo) > 0 ? ' warn' : ''}`}><div className="label">Saldo por pagar</div><div className="value">{money(c.saldo)}</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Productos</h2><span className="small muted">Registró {c.usuario?.nombre}</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Producto</th><th>Lote / vence</th><th className="num">Cantidad</th><th className="num">Costo unit.</th><th className="num">Importe</th></tr>
            </thead>
            <tbody>
              {c.items?.map((i) => (
                <tr key={i.id}>
                  <td>{i.producto.nombre}<div className="small muted mono">{i.producto.codigoBarra}</div></td>
                  <td>{i.fechaVencimiento ? <>{i.codigoLote ?? '—'} · {fecha(i.fechaVencimiento)}</> : <span className="muted">—</span>}</td>
                  <td className="num">
                    {qty(i.cantidad)} {i.presentacion?.nombre ?? i.producto.unidad}
                    {i.presentacion && <div className="small muted">{qty(n(i.cantidad) * n(i.factor))} und</div>}
                  </td>
                  <td className="num">{money(i.costoUnitario)}</td>
                  <td className="num">{money(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Pagos</h2></div>
        {c.pagos?.length ? (
          <table>
            <thead><tr><th>Fecha</th><th>Medio</th><th>Salió de</th><th>Operación</th><th>Registró</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {c.pagos.map((p) => (
                <tr key={p.id}>
                  <td>{fechaHora(p.fecha)}</td>
                  <td>{MEDIO_LABEL[p.medioPago]}</td>
                  <td>{p.movimientoCaja ? 'Caja del día' : p.movimientoFondo ? `Acumulado (${p.movimientoFondo.cuenta === 'YAPE' ? 'Yape' : 'efectivo'})` : <span className="muted">—</span>}</td>
                  <td className="mono">{p.numeroOperacion ?? '—'}</td>
                  <td>{p.usuario.nombre}</td>
                  <td className="num">{money(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Sin pagos registrados.</div>
        )}
      </div>

      {pagar && <PagoModal compra={c} onClose={() => setPagar(false)} onListo={() => (setPagar(false), recargar())} />}
      {sugerencias && <SugerenciasModal sugerencias={sugerencias} onClose={() => setSugerencias(null)} />}
    </div>
  );
}
