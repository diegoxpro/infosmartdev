import { KeyboardEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import GastoModal from '../components/GastoModal';
import { Icono } from '../components/icons';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { diasHasta, fechaHora, money, n } from '../format';
import { ConteoFondo, CUENTA_LABEL, CuentaFondo, ResumenFondo, TIPO_FONDO_LABEL } from '../types';

const r2 = (v: number) => Math.round(v * 100) / 100;
const cuadra = (v: number) => Math.abs(v) < 0.005;

export default function Acumulado() {
  const { puede } = useAuth();
  const { data, recargar } = useCarga(() => api<ResumenFondo>('/acumulado'), []);
  const { data: conteos, recargar: recargarConteos } = useCarga(() => api<ConteoFondo[]>('/acumulado/conteos'), []);
  const [modal, setModal] = useState<'gasto' | 'conteo' | 'retiro' | 'traspaso' | null>(null);
  const [viendo, setViendo] = useState<ConteoFondo | null>(null);
  const listo = () => {
    setModal(null);
    recargar();
    recargarConteos();
  };
  const s = data?.saldos;
  const ultimo = data?.ultimoConteo;
  const diasConteo = ultimo ? -diasHasta(ultimo.fecha) : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Acumulado</h1>
          <p>Dinero de las cajas anteriores: cada cierre deja aquí todo menos el fondo del día siguiente. De aquí se pagan gastos, proveedores y sueldos.</p>
        </div>
        <div className="row">
          {puede('acumulado.retirar') && <button className="btn" onClick={() => setModal('traspaso')}>Traspaso</button>}
          {puede('acumulado.retirar') && <button className="btn" onClick={() => setModal('retiro')}>Retiro o depósito</button>}
          {puede('acumulado.contar') && <button className="btn" onClick={() => setModal('conteo')}>Conteo semanal</button>}
          {puede('gastos.registrar') && <button className="btn btn-primary" onClick={() => setModal('gasto')}><Icono nombre="mas" /> Registrar gasto</button>}
        </div>
      </div>

      <div className="saldos-fondo">
        <div className="card stat"><div className="label">Efectivo</div><div className="value">{s ? money(s.EFECTIVO) : '–'}</div></div>
        <div className="card stat"><div className="label">Yape <span className="muted small">(incluye Plin, tarjeta y transferencia)</span></div><div className="value">{s ? money(s.YAPE) : '–'}</div></div>
        <div className="card stat"><div className="label">Total acumulado</div><div className="value total">{s ? money(s.total) : '–'}</div></div>
      </div>

      {data && (
        <div className={`alert ${diasConteo == null || diasConteo >= 7 ? 'warn' : 'info'}`}>
          <div>
            {ultimo ? (
              <>
                Último conteo: <b>{fechaHora(ultimo.fecha)}</b> por {ultimo.usuario.nombre}
                {diasConteo != null && diasConteo >= 7 && <> · <b>ya pasó una semana, toca contar</b></>}
              </>
            ) : (
              <>Aún no se ha hecho ningún conteo del acumulado.</>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Movimientos</h2><span className="muted small">Los últimos 100. El detalle completo está en Reportes › Gastos.</span></div>
        {data?.movimientos.length ? (
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Usuario</th><th className="num">Efectivo</th><th className="num">Yape</th></tr></thead>
              <tbody>
                {data.movimientos.map((m) => {
                  const v = n(m.monto);
                  const celda = (c: CuentaFondo) =>
                    m.cuenta === c ? <span className={v < 0 ? 'monto-menos' : 'monto-mas'}>{v < 0 ? '−' : '+'}{money(Math.abs(v))}</span> : null;
                  return (
                    <tr key={m.id}>
                      <td className="small">{fechaHora(m.fecha)}</td>
                      <td><span className="badge">{TIPO_FONDO_LABEL[m.tipo]}</span></td>
                      <td>{m.concepto}</td>
                      <td className="small">{m.usuario.nombre}</td>
                      <td className="num">{celda('EFECTIVO')}</td>
                      <td className="num">{celda('YAPE')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Vacio>Todavía no hay movimientos. Al cerrar la caja del día, lo que quede (menos el fondo para mañana) pasa aquí.</Vacio>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Conteos anteriores</h2></div>
        {conteos?.length ? (
          <table>
            <thead><tr><th>Fecha</th><th>Contó</th><th className="num">Efectivo</th><th className="num">Yape</th><th>Diferencia</th></tr></thead>
            <tbody>
              {conteos.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setViendo(c)}>
                  <td className="small">{fechaHora(c.fecha)}</td>
                  <td>{c.usuario.nombre}</td>
                  <td className="num">{money(c.efectivoContado)}</td>
                  <td className="num">{money(c.yapeContado)}</td>
                  <td><Diferencia v={n(c.diferenciaEfectivo)} etiqueta="Efectivo" /> <Diferencia v={n(c.diferenciaYape)} etiqueta="Yape" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Vacio>Sin conteos todavía.</Vacio>
        )}
      </div>

      {modal === 'gasto' && <GastoModal onClose={() => setModal(null)} onListo={listo} />}
      {modal === 'conteo' && s && <ConteoModal saldos={s} onClose={() => setModal(null)} onListo={(c) => (listo(), setViendo(c))} />}
      {modal === 'retiro' && <RetiroModal onClose={() => setModal(null)} onListo={listo} />}
      {modal === 'traspaso' && <TraspasoModal onClose={() => setModal(null)} onListo={listo} />}
      {viendo && <DetalleConteo c={viendo} onClose={() => setViendo(null)} />}
    </div>
  );
}

function Diferencia({ v, etiqueta }: { v: number; etiqueta?: string }) {
  if (cuadra(v)) return <span className="badge ok">{etiqueta ? `${etiqueta} cuadra` : 'Cuadra'}</span>;
  return <span className={`badge ${v < 0 ? 'danger' : 'warn'}`}>{etiqueta ? `${etiqueta}: ` : ''}{v < 0 ? 'falta ' : 'sobra '}{money(Math.abs(v))}</span>;
}

function ConteoModal({ saldos, onClose, onListo }: { saldos: ResumenFondo['saldos']; onClose: () => void; onListo: (c: ConteoFondo) => void }) {
  const avisar = useToast();
  const { data: denominaciones } = useCarga(() => api<number[]>('/acumulado/denominaciones'), []);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [yape, setYape] = useState('');
  const [observacion, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const contado = r2([...(denominaciones ?? [])].reduce((s, d) => s + d * n(conteo[String(d)]), 0));
  const difE = r2(contado - saldos.EFECTIVO);
  const difY = r2(n(yape) - saldos.YAPE);
  const cuadrado = cuadra(difE) && cuadra(difY) && yape !== '';
  const puede = yape !== '' && (cuadrado || observacion.trim() !== '');

  const siguiente = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const campos = Array.from(e.currentTarget.closest('.modal-body')!.querySelectorAll<HTMLInputElement>('input'));
    campos[campos.indexOf(e.currentTarget) + 1]?.focus();
  };

  const guardar = async () => {
    setEnviando(true);
    try {
      const c = await api<ConteoFondo>('/acumulado/conteos', {
        body: { conteo: Object.fromEntries(Object.entries(conteo).map(([k, v]) => [k, n(v)])), yape: n(yape), observacion: observacion.trim() || undefined },
      });
      avisar(cuadrado ? 'Conteo cerrado: cuadra' : 'Conteo cerrado; la diferencia quedó registrada');
      onListo(c);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      ancho
      titulo="Conteo semanal del acumulado"
      onClose={onClose}
      pie={
        <>
          <div className={`cuadre ${cuadrado ? 'ok' : 'pendiente'}`} role="status">
            {yape === ''
              ? 'Cuenta el efectivo y escribe el saldo de Yape.'
              : cuadrado
                ? 'El acumulado cuadra.'
                : `${[!cuadra(difE) && `Efectivo: ${difE < 0 ? 'falta' : 'sobra'} ${money(Math.abs(difE))}`, !cuadra(difY) && `Yape: ${difY < 0 ? 'falta' : 'sobra'} ${money(Math.abs(difY))}`].filter(Boolean).join(' · ')}. ${observacion.trim() ? 'Se cerrará con la diferencia registrada.' : 'Escribe el motivo en la observación.'}`}
          </div>
          <button className="btn" onClick={onClose}>Volver</button>
          <button className="btn btn-primary" onClick={guardar} disabled={enviando || !puede}>Cerrar conteo</button>
        </>
      }
    >
      <div className="stack">
        <div className="cierre-grid">
          <div className="contador">
            {denominaciones?.map((d, i) => (
              <div key={d} className="fila">
                <b className="num">S/ {d.toFixed(2)}</b>
                <input
                  className="num"
                  type="number"
                  min="0"
                  step="1"
                  value={conteo[String(d)] ?? ''}
                  placeholder="0"
                  autoFocus={i === 0}
                  onChange={(e) => setConteo((c) => ({ ...c, [String(d)]: e.target.value }))}
                  onKeyDown={siguiente}
                  aria-label={`Cantidad de S/ ${d.toFixed(2)}`}
                />
                <span className="muted">=</span>
                <span className="num">{money(d * n(conteo[String(d)]))}</span>
              </div>
            ))}
            <div className="fila contador-total"><b>Total</b><span /><span /><b className="num">{money(contado)}</b></div>
          </div>
          <div className="stack">
            <table className="balance">
              <tbody>
                <tr className="balance-grupo"><td colSpan={2}>Efectivo</td></tr>
                <tr><td>Según el sistema</td><td className="num">{money(saldos.EFECTIVO)}</td></tr>
                <tr><td>Contado</td><td className="num">{money(contado)}</td></tr>
                <tr><td>Diferencia</td><td className="num"><Diferencia v={difE} /></td></tr>
                <tr className="balance-grupo"><td colSpan={2}>Yape</td></tr>
                <tr><td>Según el sistema</td><td className="num">{money(saldos.YAPE)}</td></tr>
                <tr>
                  <td>Saldo en la app</td>
                  <td className="num">
                    <input className="num" style={{ width: 120 }} type="number" min="0" step="0.1" value={yape} placeholder="0.00" onChange={(e) => setYape(e.target.value)} onKeyDown={siguiente} aria-label="Saldo de Yape según la app" />
                  </td>
                </tr>
                {yape !== '' && <tr><td>Diferencia</td><td className="num"><Diferencia v={difY} /></td></tr>}
              </tbody>
            </table>
            <p className="muted small" style={{ margin: 0 }}>Si no cuadra se cierra igual con una observación, y el saldo del sistema pasa a ser lo contado.</p>
          </div>
        </div>
        <Campo label={cuadrado ? 'Observación' : 'Observación (obligatoria si no cuadra)'}>
          <input value={observacion} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: faltan S/ 5 de un pasaje que no se anotó" />
        </Campo>
      </div>
    </Modal>
  );
}

function DetalleConteo({ c, onClose }: { c: ConteoFondo; onClose: () => void }) {
  return (
    <Modal titulo={`Conteo #${c.id}`} onClose={onClose} pie={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{fechaHora(c.fecha)} · contó {c.usuario.nombre}</p>
        <table className="balance">
          <tbody>
            <tr className="balance-grupo"><td colSpan={2}>Efectivo</td></tr>
            <tr><td>Según el sistema</td><td className="num">{money(c.efectivoEsperado)}</td></tr>
            <tr><td>Contado</td><td className="num">{money(c.efectivoContado)}</td></tr>
            <tr><td>Diferencia</td><td className="num"><Diferencia v={n(c.diferenciaEfectivo)} /></td></tr>
            <tr className="balance-grupo"><td colSpan={2}>Yape</td></tr>
            <tr><td>Según el sistema</td><td className="num">{money(c.yapeEsperado)}</td></tr>
            <tr><td>Saldo en la app</td><td className="num">{money(c.yapeContado)}</td></tr>
            <tr><td>Diferencia</td><td className="num"><Diferencia v={n(c.diferenciaYape)} /></td></tr>
          </tbody>
        </table>
        {c.detalle.some((d) => d.cantidad > 0) && (
          <p className="small muted" style={{ margin: 0 }}>
            Billetes y monedas: {c.detalle.filter((d) => d.cantidad > 0).map((d) => `${d.cantidad} × S/ ${d.denominacion.toFixed(2)}`).join(', ')}
          </p>
        )}
        {c.observacion && <p style={{ margin: 0 }}>Observación: {c.observacion}</p>}
      </div>
    </Modal>
  );
}

function RetiroModal({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [cuenta, setCuenta] = useState<CuentaFondo>('EFECTIVO');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const guardar = async () => {
    try {
      await api('/acumulado/retiros', { body: { cuenta, monto: n(monto), concepto } });
      avisar('Retiro registrado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo="Retiro o depósito"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={n(monto) <= 0 || concepto.trim().length < 3}>Registrar</button>
        </>
      }
    >
      <div className="grid-2">
        <p className="muted small span-2" style={{ margin: 0 }}>Dinero que sale del acumulado sin ser gasto del negocio: retiro del dueño o depósito al banco. No resta en la utilidad.</p>
        <Campo label="Sale de">
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value as CuentaFondo)}>
            {(['EFECTIVO', 'YAPE'] as const).map((c) => <option key={c} value={c}>{CUENTA_LABEL[c]}</option>)}
          </select>
        </Campo>
        <Campo label="Monto"><input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus /></Campo>
        <Campo label="Motivo" className="span-2"><input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: depósito al BCP, retiro del dueño" /></Campo>
      </div>
    </Modal>
  );
}

function TraspasoModal({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [desde, setDesde] = useState<CuentaFondo>('YAPE');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const hacia: CuentaFondo = desde === 'EFECTIVO' ? 'YAPE' : 'EFECTIVO';
  const guardar = async () => {
    try {
      await api('/acumulado/traspasos', { body: { desde, monto: n(monto), concepto: concepto.trim() || undefined } });
      avisar('Traspaso registrado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo="Traspaso entre efectivo y Yape"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={n(monto) <= 0}>Registrar</button>
        </>
      }
    >
      <div className="grid-2">
        <Campo label="Sale de">
          <select value={desde} onChange={(e) => setDesde(e.target.value as CuentaFondo)}>
            <option value="YAPE">Yape (retirar a efectivo)</option>
            <option value="EFECTIVO">Efectivo (yapear o depositar a la cuenta)</option>
          </select>
        </Campo>
        <Campo label="Monto" ayuda={`Entra a ${CUENTA_LABEL[hacia].toLowerCase()}`}><input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus /></Campo>
        <Campo label="Detalle" className="span-2" ayuda="Opcional"><input value={concepto} onChange={(e) => setConcepto(e.target.value)} /></Campo>
      </div>
    </Modal>
  );
}
