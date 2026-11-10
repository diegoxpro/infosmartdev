import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import PagoModal from '../components/PagoModal';
import { useCarga, Vacio } from '../components/ui';
import { diasHasta, fecha, money, n } from '../format';
import { Compra } from '../types';

export default function CuentasPorPagar() {
  const { puede } = useAuth();
  const { data, recargar, cargando } = useCarga(() => api<Compra[]>(`/compras${qs({ pendientes: 1 })}`), []);
  const [pagar, setPagar] = useState<Compra | null>(null);

  const porProveedor = new Map<string, number>();
  data?.forEach((c) => porProveedor.set(c.proveedor.razonSocial, (porProveedor.get(c.proveedor.razonSocial) ?? 0) + n(c.saldo)));
  const total = [...porProveedor.values()].reduce((s, v) => s + v, 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Cuentas por pagar</h1>
          <p>Compras al crédito con saldo pendiente, ordenadas por vencimiento.</p>
        </div>
        <div className="num"><div className="small muted">Deuda total</div><b style={{ fontSize: 22 }}>{money(total)}</b></div>
      </div>

      {porProveedor.size > 0 && (
        <div className="row">
          {[...porProveedor.entries()].sort((a, b) => b[1] - a[1]).map(([p, v]) => (
            <div key={p} className="card stat" style={{ minWidth: 200 }}>
              <div className="label">{p}</div>
              <div className="value" style={{ fontSize: 18 }}>{money(v)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vence</th><th>Proveedor</th><th>Documento</th><th className="num">Total</th><th className="num">Saldo</th><th /></tr>
            </thead>
            <tbody>
              {data?.map((c) => {
                const d = c.fechaVencimiento ? diasHasta(c.fechaVencimiento) : null;
                return (
                  <tr key={c.id}>
                    <td>
                      {fecha(c.fechaVencimiento)}{' '}
                      {d != null && (
                        <span className={`badge ${d < 0 ? 'danger' : d <= 3 ? 'warn' : ''}`}>
                          {d < 0 ? `vencida hace ${-d} d` : d === 0 ? 'vence hoy' : `en ${d} d`}
                        </span>
                      )}
                    </td>
                    <td>{c.proveedor.razonSocial}</td>
                    <td><Link className="mono" to={`/compras/${c.id}`}>{c.serie}-{c.numero}</Link></td>
                    <td className="num">{money(c.total)}</td>
                    <td className="num"><b>{money(c.saldo)}</b></td>
                    <td className="actions">{puede('compras.pagar') && <button className="btn btn-sm" onClick={() => setPagar(c)}>Pagar</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargando && !data?.length && <Vacio>No debes nada a tus proveedores.</Vacio>}
        </div>
      </div>
      {pagar && <PagoModal compra={pagar} onClose={() => setPagar(null)} onListo={() => (setPagar(null), recargar())} />}
    </div>
  );
}
