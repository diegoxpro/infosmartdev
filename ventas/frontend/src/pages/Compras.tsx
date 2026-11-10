import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Campo, useCarga, Vacio } from '../components/ui';
import { fecha, money, n } from '../format';
import { Compra, DOC_LABEL, Proveedor } from '../types';
import { hayBorradorCompra } from './NuevaCompra';

function primerDiaMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function Compras() {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const { data: proveedores } = useCarga(() => api<Proveedor[]>('/proveedores'), []);
  const { data: compras, cargando } = useCarga(() => api<Compra[]>(`/compras${qs({ desde, hasta, proveedorId })}`), [desde, hasta, proveedorId]);

  const validas = compras?.filter((c) => c.estado === 'REGISTRADA') ?? [];
  const total = validas.reduce((s, c) => s + n(c.total), 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Compras</h1>
          <p>Cada compra suma stock y actualiza el costo de los productos.</p>
        </div>
        {puede('compras.registrar') && (
          <Link className="btn btn-primary" to="/compras/nueva">
            {hayBorradorCompra() ? 'Continuar compra en borrador' : 'Registrar compra'}
          </Link>
        )}
      </div>
      <div className="card">
        <div className="card-head" style={{ alignItems: 'end' }}>
          <div className="row" style={{ alignItems: 'end' }}>
            <Campo label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
            <Campo label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
            <Campo label="Proveedor">
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">Todos</option>
                {proveedores?.map((p) => <option key={p.id} value={p.id}>{p.nombreComercial || p.razonSocial}</option>)}
              </select>
            </Campo>
          </div>
          <div className="num">
            <div className="small muted">{validas.length} compras</div>
            <b style={{ fontSize: 18 }}>{money(total)}</b>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Documento</th>
                <th>Proveedor</th>
                <th>Condición</th>
                <th className="num">Total</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {compras?.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navegar(`/compras/${c.id}`)} style={c.estado === 'ANULADA' ? { opacity: 0.55 } : undefined}>
                  <td>{fecha(c.fechaEmision)}</td>
                  <td>
                    <span className="mono">{c.serie}-{c.numero}</span>
                    <div className="small muted">{DOC_LABEL[c.tipoDocumento]}</div>
                  </td>
                  <td>{c.proveedor.razonSocial}</td>
                  <td>
                    {c.estado === 'ANULADA' ? (
                      <span className="badge danger">Anulada</span>
                    ) : c.condicion === 'CREDITO' ? (
                      <span className={`badge ${n(c.saldo) > 0 ? 'warn' : 'ok'}`}>{n(c.saldo) > 0 ? 'Crédito' : 'Crédito pagado'}</span>
                    ) : (
                      <span className="badge ok">Contado</span>
                    )}
                  </td>
                  <td className="num">{money(c.total)}</td>
                  <td className="num">{n(c.saldo) > 0 ? money(c.saldo) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!cargando && compras?.length === 0 && <Vacio>No hay compras en estas fechas.</Vacio>}
        </div>
      </div>
    </div>
  );
}
