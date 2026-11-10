import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import GastoModal from '../components/GastoModal';
import MermaModal, { MermaInicial } from '../components/MermaModal';
import { useCarga, Vacio } from '../components/ui';
import { diasHasta, fecha, money, n, qty } from '../format';
import { Alertas, AvisoGastoFijo, Compra, EstadoBackup, EstadoSunatGeneral, Lote } from '../types';

export default function Inicio() {
  const { usuario, puede } = useAuth();
  const { data: backup } = useCarga(() => (puede('config.backup') ? api<EstadoBackup>('/backups') : Promise.resolve(null)), [puede('config.backup')]);
  const { data: a, recargar } = useCarga(() => api<Alertas>('/inventario/alertas'), []);
  const { data: pendientes } = useCarga(() => api<Compra[]>(`/compras${qs({ pendientes: 1 })}`), []);
  const { data: sunat } = useCarga(() => api<EstadoSunatGeneral>('/sunat/estado'), []);
  const [merma, setMerma] = useState<MermaInicial | null>(null);
  const { data: fijos, recargar: recargarFijos } = useCarga(() => api<AvisoGastoFijo[]>('/gastos/fijos/avisos'), []);
  const [pagando, setPagando] = useState<AvisoGastoFijo | null>(null);

  const deuda = pendientes?.reduce((s, c) => s + n(c.saldo), 0) ?? 0;
  const vencenPronto = pendientes?.filter((c) => c.fechaVencimiento && diasHasta(c.fechaVencimiento) <= 3) ?? [];

  const aMerma = (l: Lote) =>
    setMerma({
      productoId: l.productoId,
      nombre: l.producto!.nombre,
      costo: n(l.producto!.costo),
      lote: l,
      cantidad: n(l.cantidad),
      motivo: 'Producto vencido',
    });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Hola, {usuario?.nombre.split(' ')[0]}</h1>
          <p>Esto es lo que necesita tu atención hoy.</p>
        </div>
      </div>

      <div className="grid-4">
        <Stat label="Lotes vencidos" valor={a?.vencidos.length} tono="danger" to="#vencidos" />
        <Stat label={`Vencen en ${a?.diasAviso ?? 15} días`} valor={a?.porVencer.length} tono="warn" to="#por-vencer" />
        <Stat label="Bajo stock mínimo" valor={a?.stockBajo.length} tono="warn" to="/productos?filtro=stock-bajo" />
        <Stat label="Deuda con proveedores" valor={pendientes ? deuda : undefined} texto={money(deuda)} to="/cuentas-por-pagar" />
      </div>

      {backup?.atrasado && (
        <div className="alert warn">
          <div>
            <b>No hay un backup reciente de tus datos.</b> <Link to="/configuracion">Revisa la configuración de backup</Link>
          </div>
        </div>
      )}

      {sunat && sunat.modo !== 'DESACTIVADO' && sunat.atrasadas > 0 && (
        <div className="alert danger">
          <div>
            <b>{sunat.atrasadas} {sunat.atrasadas === 1 ? 'boleta lleva' : 'boletas llevan'} más de 2 días sin ser aceptadas por SUNAT.</b>{' '}
            <Link to="/ventas">Revisar en Ventas</Link>
          </div>
        </div>
      )}

      {vencenPronto.length > 0 && (
        <div className="alert warn">
          <div>
            <b>{vencenPronto.length} {vencenPronto.length === 1 ? 'factura vence' : 'facturas vencen'} en 3 días o menos.</b>{' '}
            <Link to="/cuentas-por-pagar">Ver cuentas por pagar</Link>
          </div>
        </div>
      )}

      {fijos && fijos.length > 0 && (
        <div className={`alert ${fijos.some((f) => f.estado !== 'PROXIMO') ? 'danger' : 'warn'}`}>
          <div className="grow">
            <b>Gastos fijos por pagar</b>
            <ul className="aviso-fijos" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {fijos.map((f) => (
                <li key={`${f.gastoFijoId}-${f.periodo}`}>
                  {f.nombre}{f.monto != null && ` (${money(f.monto)})`}:{' '}
                  {f.estado === 'VENCIDO' ? `venció el ${fecha(f.fecha)}` : f.estado === 'HOY' ? 'toca pagar hoy' : `vence el ${fecha(f.fecha)}`}
                  {puede('gastos.registrar') && (
                    <> <button className="btn btn-sm" onClick={() => setPagando(f)}>Pagar</button></>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {a && a.vencidos.length > 0 && (
        <div className="card" id="vencidos">
          <div className="card-head">
            <h2>Productos vencidos</h2>
            <span className="badge danger">Envíalos a merma para contabilizarlos</span>
          </div>
          <TablaLotes lotes={a.vencidos} onMerma={aMerma} />
        </div>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card" id="por-vencer">
          <div className="card-head">
            <h2>Por vencer</h2>
          </div>
          {a?.porVencer.length ? <TablaLotes lotes={a.porVencer} onMerma={aMerma} /> : <Vacio>Nada por vencer pronto.</Vacio>}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Stock bajo el mínimo</h2>
            <Link className="btn btn-sm" to="/productos?filtro=stock-bajo">Ver todos</Link>
          </div>
          {a?.stockBajo.length ? (
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table>
                <thead>
                  <tr><th>Producto</th><th className="num">Stock</th><th className="num">Mínimo</th></tr>
                </thead>
                <tbody>
                  {a.stockBajo.map((p) => (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td className="num"><span className={`badge ${n(p.stock) <= 0 ? 'danger' : 'warn'}`}>{qty(p.stock)}</span></td>
                      <td className="num">{qty(p.stockMinimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Vacio>Ningún producto bajo su mínimo. Define el stock mínimo en cada producto para recibir avisos.</Vacio>
          )}
        </div>
      </div>

      {pagando && <GastoModal fijo={pagando} onClose={() => setPagando(null)} onListo={() => (setPagando(null), recargarFijos())} />}
      {merma && <MermaModal inicial={merma} onClose={() => setMerma(null)} onListo={() => (setMerma(null), recargar())} />}
    </div>
  );
}

function TablaLotes({ lotes, onMerma }: { lotes: Lote[]; onMerma: (l: Lote) => void }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table>
        <thead>
          <tr><th>Producto</th><th>Vence</th><th className="num">Cantidad</th><th /></tr>
        </thead>
        <tbody>
          {lotes.map((l) => {
            const d = diasHasta(l.fechaVencimiento);
            return (
              <tr key={l.id}>
                <td>
                  {l.producto?.nombre}
                  {l.codigo && <div className="small muted">Lote {l.codigo}</div>}
                </td>
                <td>
                  {fecha(l.fechaVencimiento)}{' '}
                  <span className={`badge ${d <= 0 ? 'danger' : 'warn'}`}>{d < 0 ? `hace ${-d} d` : d === 0 ? 'hoy' : `en ${d} d`}</span>
                </td>
                <td className="num">{qty(l.cantidad)}</td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => onMerma(l)}>Enviar a merma</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Indicador de Inicio: en cero queda apagado; con valor toma su color y lleva al detalle. */
function Stat({ label, valor, texto, tono, to }: { label: string; valor?: number; texto?: string; tono?: 'warn' | 'danger'; to: string }) {
  const activo = !!valor && valor > 0;
  const clase = `card stat${activo ? ` activo${tono ? ` ${tono}` : ''}` : ' cero'}`;
  const cuerpo = (
    <>
      <div className="label">{label}</div>
      <div className="value">{valor === undefined ? '–' : texto ?? valor}</div>
    </>
  );
  if (!activo) return <div className={clase}>{cuerpo}</div>;
  return to.startsWith('#') ? (
    <a className={clase} href={to}>{cuerpo}</a>
  ) : (
    <Link className={clase} to={to}>{cuerpo}</Link>
  );
}
