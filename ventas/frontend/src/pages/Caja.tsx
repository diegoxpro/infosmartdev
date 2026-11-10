import { KeyboardEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import GastoModal from '../components/GastoModal';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { fechaHora, money, n } from '../format';
import { imprimirCierre } from '../ticket';
import { Caja as TCaja, COMPROBANTE_LABEL, Configuracion, MEDIO_LABEL, MedioPago, MEDIOS, ResumenCaja, TipoMovimientoCaja } from '../types';

const DIGITALES = MEDIOS.filter((m) => m !== 'EFECTIVO');
const r2 = (v: number) => Math.round(v * 100) / 100;
const cuadra = (v: number) => Math.abs(v) < 0.005;

const TIPO_MOV: Record<TipoMovimientoCaja, { label: string; badge: string }> = {
  INGRESO: { label: 'Ingreso', badge: 'ok' },
  EGRESO: { label: 'Gasto', badge: 'danger' },
  RETIRO: { label: 'Retiro', badge: 'warn' },
  VENTA_SIN_COMPROBANTE: { label: 'Venta sin comprobante', badge: 'info' },
};

export default function Caja() {
  const avisar = useToast();
  const { data: caja, recargar, cargando } = useCarga(() => api<TCaja | null>('/caja/actual'), []);
  const { data: cfg } = useCarga(() => api<Configuracion>('/configuracion'), []);
  const { data: historial, recargar: recargarHistorial } = useCarga(() => api<TCaja[]>('/caja/historial'), []);
  const [monto, setMonto] = useState('');
  const [mov, setMov] = useState<'INGRESO' | 'RETIRO' | null>(null);
  const [gasto, setGasto] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [viendo, setViendo] = useState<TCaja | null>(null);

  const abrir = async () => {
    try {
      await api('/caja/abrir', { body: { montoInicial: monto === '' ? undefined : n(monto) } });
      avisar('Caja abierta');
      recargar();
      recargarHistorial();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  if (cargando) return null;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Caja</h1>
          <p>{caja ? `Caja #${caja.id} abierta el ${fechaHora(caja.fechaApertura)} por ${caja.usuarioApertura.nombre}` : 'La caja está cerrada.'}</p>
        </div>
        {caja && (
          <div className="row">
            <button className="btn" onClick={() => setMov('INGRESO')}>Ingreso</button>
            <button className="btn" onClick={() => setGasto(true)} title="Lo normal es pagar los gastos desde el acumulado (Gastos › Acumulado)">Gasto</button>
            <button className="btn" onClick={() => setMov('RETIRO')}>Retiro</button>
            <Link className="btn" to="/venta">Ir a vender</Link>
            <button className="btn btn-primary" onClick={() => setCerrando(true)}>Cerrar caja</button>
          </div>
        )}
      </div>

      {!caja ? (
        <div className="card card-pad stack" style={{ maxWidth: 420 }}>
          <h2>Abrir caja</h2>
          <Campo label="Monto inicial (fondo de caja)" ayuda={`Por defecto S/ ${n(cfg?.montoInicialCaja ?? 150).toFixed(2)}`}>
            <input className="num" type="number" min="0" step="0.1" value={monto} placeholder={n(cfg?.montoInicialCaja ?? 150).toFixed(2)} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </Campo>
          <div><button className="btn btn-primary" onClick={abrir}>Abrir caja</button></div>
        </div>
      ) : (
        <>
          <Resumen r={caja.resumen!} />
          <VentaSinComprobante onListo={recargar} />
          <div className="card">
            <div className="card-head"><h2>Movimientos de caja</h2></div>
            {caja.movimientos?.length ? (
              <table>
                <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Usuario</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {caja.movimientos.map((m) => (
                    <tr key={m.id}>
                      <td className="small">{fechaHora(m.fecha)}</td>
                      <td><span className={`badge ${TIPO_MOV[m.tipo].badge}`}>{TIPO_MOV[m.tipo].label}</span></td>
                      <td>{m.concepto}{m.medioPago && m.medioPago !== 'EFECTIVO' && <span className="muted"> · {MEDIO_LABEL[m.medioPago]}</span>}</td>
                      <td>{m.usuario.nombre}</td>
                      <td className="num">{m.tipo === 'EGRESO' || m.tipo === 'RETIRO' ? '−' : ''}{money(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Vacio>Sin movimientos. Registra aquí gastos, retiros, ingresos de efectivo o ventas sin comprobante.</Vacio>
            )}
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head"><h2>Cierres anteriores</h2></div>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th>Caja</th><th>Apertura</th><th>Cierre</th><th className="num">Efectivo en caja</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
            <tbody>
              {historial?.filter((h) => h.estado === 'CERRADA').map((h) => (
                <tr key={h.id} className="clickable" onClick={async () => setViendo(await api<TCaja>(`/caja/${h.id}`))}>
                  <td>#{h.id}</td>
                  <td className="small">{fechaHora(h.fechaApertura)} · {h.usuarioApertura.nombre}</td>
                  <td className="small">{fechaHora(h.fechaCierre)} · {h.usuarioCierre?.nombre}</td>
                  <td className="num">{money(h.efectivoEsperado)}</td>
                  <td className="num">{money(h.efectivoContado)}</td>
                  <td className="num">
                    <Diferencia v={n(h.diferencia)} />
                    {h.sinCuadrar && <> <span className="badge danger" title="Se cerró marcando «cerrar aunque no cuadre»">Sin cuadrar</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {gasto && <GastoModal soloCaja onClose={() => setGasto(false)} onListo={() => (setGasto(false), recargar())} />}
      {mov && <MovimientoModal tipo={mov} onClose={() => setMov(null)} onListo={() => (setMov(null), recargar())} />}
      {cerrando && caja && (
        <CierreModal
          caja={caja}
          fondoDia={n(cfg?.montoInicialCaja ?? 150)}
          onClose={() => setCerrando(false)}
          onListo={(c) => {
            setCerrando(false);
            if (cfg) imprimirCierre(c, cfg);
            setViendo(c);
            recargar();
            recargarHistorial();
          }}
        />
      )}
      {viendo && (
        <Modal
          ancho
          titulo={`Cierre de caja #${viendo.id}`}
          onClose={() => setViendo(null)}
          pie={<button className="btn" onClick={() => cfg && imprimirCierre(viendo, cfg)}>Imprimir</button>}
        >
          {viendo.sinCuadrar && (
            <div className="cuadre pendiente" role="status">
              Esta caja se cerró sin cuadrar{viendo.resumen?.pendientes?.length ? `: ${viendo.resumen.pendientes.join(', ')}` : ''}.
            </div>
          )}
          <Resumen r={viendo.resumen!} />
          {viendo.resumen?.alAcumulado && <AlAcumulado {...viendo.resumen.alAcumulado} />}
          {viendo.observacion && <p>Observación: {viendo.observacion}</p>}
        </Modal>
      )}
    </div>
  );
}

/** Lo que pasa al acumulado al cerrar: el efectivo menos el fondo del día siguiente, y todo lo digital. */
function AlAcumulado({ efectivo, yape, quedaEnCaja, previo }: { efectivo: number; yape: number; quedaEnCaja: number; previo?: boolean }) {
  return (
    <div className="alert info">
      <div>
        <b>{previo ? 'Al cerrar pasa al acumulado' : 'Pasó al acumulado'}:</b> {money(efectivo)} en efectivo y {money(yape)} en Yape
        {' '}· quedan {money(quedaEnCaja)} en caja para el día siguiente.
      </div>
    </div>
  );
}

function Diferencia({ v }: { v: number }) {
  if (Math.abs(v) < 0.005) return <span className="badge ok">Cuadra</span>;
  return <span className={`badge ${v < 0 ? 'danger' : 'warn'}`}>{v < 0 ? 'Falta ' : 'Sobra '}{money(Math.abs(v))}</span>;
}

function Resumen({ r }: { r: ResumenCaja }) {
  return (
    <div className="stack">
      <div className="grid-4">
        <div className="card stat"><div className="label">Efectivo inicial</div><div className="value">{money(r.montoInicial)}</div></div>
        <div className="card stat"><div className="label">Ventas ({r.numeroVentas})</div><div className="value">{money(r.totalVentas + (r.sinComprobante?.total ?? 0))}</div></div>
        <div className="card stat"><div className="label">Utilidad estimada</div><div className="value">{money(r.utilidad)}</div></div>
        <div className="card stat"><div className="label">Total efectivo en caja</div><div className="value" style={{ color: 'var(--accent)' }}>{money(r.efectivoEsperado)}</div></div>
      </div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Balance general</h3></div>
          <Balance r={r} contado={r.efectivoContado} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Por comprobante</h3></div>
          <table>
            <tbody>
              {r.porComprobante.map((p) => (
                <tr key={p.tipo}><td>{COMPROBANTE_LABEL[p.tipo]} ({p.cantidad})</td><td className="num">{money(p.total)}</td></tr>
              ))}
              {(r.sinComprobante?.total ?? 0) > 0 && <tr><td>Ventas sin comprobante</td><td className="num">{money(r.sinComprobante!.total)}</td></tr>}
              {!r.porComprobante.length && !r.sinComprobante?.total && <tr><td className="muted">Sin ventas</td><td /></tr>}
              {r.anuladas.cantidad > 0 && <tr><td className="muted">Anuladas ({r.anuladas.cantidad})</td><td className="num muted">{money(r.anuladas.total)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Balance de caja como el de SysVent: qué suma y qué resta al efectivo, y lo cobrado por medios digitales. */
function Balance({ r, contado, digital }: { r: ResumenCaja; contado?: number; digital?: Partial<Record<MedioPago, number | null>> }) {
  const sc = r.sinComprobante?.porMedio;
  const total = r.totalPorMedio ?? r.porMedio;
  const totalDigital = r2(DIGITALES.reduce((s, m) => s + n(total[m]), 0));
  const confirmados = digital ?? Object.fromEntries((r.digital ?? []).map((d) => [d.medio, d.confirmado]));
  const fila = (label: string, v: number, signo: '' | '−' = '') => (
    <tr key={label} className={v ? '' : 'muted'}><td>{label}</td><td className="num">{v ? signo : ''}{money(v)}</td></tr>
  );
  return (
    <table className="balance">
      <tbody>
        <tr className="balance-grupo"><td colSpan={2}>Efectivo</td></tr>
        {fila('Efectivo inicial', n(r.montoInicial))}
        {fila('Ventas en efectivo', n(r.porMedio.EFECTIVO))}
        {sc && fila('Ventas sin comprobante en efectivo', n(sc.EFECTIVO))}
        {fila('Otros ingresos de efectivo', n(r.ingresos))}
        {r.retiros == null ? fila('Gastos y retiros', n(r.gastos ?? r.egresos), '−') : (
          <>
            {fila('Gastos', n(r.gastos), '−')}
            {fila('Retiros', n(r.retiros), '−')}
          </>
        )}
        {r.pagosProveedor != null && fila('Pagos a proveedores', n(r.pagosProveedor), '−')}
        <tr className="balance-total"><td>Total efectivo en caja</td><td className="num">{money(r.efectivoEsperado)}</td></tr>
        {contado != null && (
          <>
            <tr><td>Efectivo contado</td><td className="num">{money(contado)}</td></tr>
            <tr><td>Diferencia</td><td className="num"><Diferencia v={r2(contado - r.efectivoEsperado)} /></td></tr>
          </>
        )}
        <tr className="balance-grupo"><td colSpan={2}>Billeteras digitales y tarjeta</td></tr>
        {DIGITALES.map((m) => {
          const v = n(total[m]);
          const conf = confirmados[m];
          return (
            <tr key={m} className={v ? '' : 'muted'}>
              <td>
                Ventas con {MEDIO_LABEL[m].toLowerCase()}
                {n(sc?.[m]) > 0 && <span className="muted small"> (incluye {money(sc![m])} sin comprobante)</span>}
              </td>
              <td className="num">
                {money(v)}
                {conf != null && v > 0 && <> <Diferencia v={r2(n(conf) - v)} /></>}
              </td>
            </tr>
          );
        })}
        <tr className="balance-total"><td>Total digital</td><td className="num">{money(totalDigital)}</td></tr>
        <tr className="balance-total"><td>Total vendido (efectivo + digital)</td><td className="num">{money(r.totalVentas + (r.sinComprobante?.total ?? 0))}</td></tr>
      </tbody>
    </table>
  );
}

/** Caja de texto para anotar ventas que se hicieron sin boleta ni ticket del sistema. */
function VentaSinComprobante({ onListo }: { onListo: () => void }) {
  const avisar = useToast();
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [detalle, setDetalle] = useState('');
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    if (n(monto) <= 0) return;
    setEnviando(true);
    try {
      await api('/caja/movimientos', { body: { tipo: 'VENTA_SIN_COMPROBANTE', concepto: detalle.trim() || undefined, monto: n(monto), medioPago: medio } });
      avisar('Venta sin comprobante registrada');
      setMonto('');
      setDetalle('');
      setMedio('EFECTIVO');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="card card-pad stack">
      <div>
        <h2>Ventas sin comprobante</h2>
        <p className="muted small">Anota aquí lo que se vendió sin pasar por el sistema. Suma al balance de caja según cómo se cobró.</p>
      </div>
      <form className="venta-sc" onSubmit={(e) => (e.preventDefault(), guardar())}>
        <Campo label="Monto">
          <input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
        </Campo>
        <Campo label="Cobrado con">
          <select value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
            {MEDIOS.map((m) => <option key={m} value={m}>{MEDIO_LABEL[m]}</option>)}
          </select>
        </Campo>
        <Campo label="Detalle (opcional)">
          <input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej.: 2 gaseosas y pan, se fue la luz" />
        </Campo>
        <button className="btn btn-primary" type="submit" disabled={enviando || n(monto) <= 0}>Añadir venta</button>
      </form>
    </div>
  );
}

function MovimientoModal({ tipo, onClose, onListo }: { tipo: 'INGRESO' | 'RETIRO'; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const guardar = async () => {
    try {
      await api('/caja/movimientos', { body: { tipo, concepto, monto: n(monto) } });
      avisar(tipo === 'INGRESO' ? 'Ingreso registrado' : 'Retiro registrado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo={tipo === 'INGRESO' ? 'Ingreso de efectivo' : 'Retiro de efectivo de la caja del día'}
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={concepto.trim().length < 3 || n(monto) <= 0}>Registrar</button>
        </>
      }
    >
      <div className="grid-2">
        <Campo label="Concepto" className="span-2">
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === 'INGRESO' ? 'Cambio de sencillo, aporte…' : 'Retiro del dueño…'} autoFocus />
        </Campo>
        <Campo label="Monto"><input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} /></Campo>
      </div>
    </Modal>
  );
}

function CierreModal({ caja, fondoDia, onClose, onListo }: { caja: TCaja; fondoDia: number; onClose: () => void; onListo: (c: TCaja) => void }) {
  const avisar = useToast();
  const { data: denominaciones } = useCarga(() => api<number[]>('/caja/denominaciones'), []);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [digital, setDigital] = useState<Partial<Record<MedioPago, string>>>({});
  const [observacion, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [forzar, setForzar] = useState(false);
  const r = caja.resumen!;
  const total = r.totalPorMedio ?? r.porMedio;
  const contado = r2([...(denominaciones ?? [])].reduce((s, d) => s + d * n(conteo[String(d)]), 0));
  const dif = r2(contado - r.efectivoEsperado);
  // Solo se confirman los medios digitales que tuvieron ventas.
  const aConfirmar = DIGITALES.filter((m) => n(total[m]) > 0);
  const digitalNum = Object.fromEntries(aConfirmar.map((m) => [m, digital[m] == null || digital[m] === '' ? null : n(digital[m])])) as Partial<Record<MedioPago, number | null>>;
  const pendientes = aConfirmar.filter((m) => digitalNum[m] == null || !cuadra(n(digitalNum[m]) - n(total[m])));
  const cuadrada = cuadra(dif) && pendientes.length === 0;
  // "Cerrar aunque no cuadre" exige explicar la diferencia en la observación.
  const puedeCerrar = cuadrada || (forzar && observacion.trim() !== '');

  const siguiente = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const campos = Array.from(e.currentTarget.closest('.modal-body')!.querySelectorAll<HTMLInputElement>('input'));
    campos[campos.indexOf(e.currentTarget) + 1]?.focus();
  };

  const cerrar = async () => {
    if (!puedeCerrar) return;
    setEnviando(true);
    try {
      const c = await api<TCaja>('/caja/cerrar', {
        body: {
          conteo: Object.fromEntries(Object.entries(conteo).map(([k, v]) => [k, n(v)])),
          digital: digitalNum,
          observacion: observacion.trim() || undefined,
          sinCuadrar: !cuadrada && forzar,
        },
      });
      avisar(cuadrada ? 'Caja cerrada' : 'Caja cerrada sin cuadrar; la diferencia quedó registrada');
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
      titulo="Cerrar caja: cuenta el efectivo y cuadra"
      onClose={onClose}
      pie={
        <>
          <div className={`cuadre ${cuadrada ? 'ok' : 'pendiente'}`} role="status">
            {cuadrada
              ? 'Caja cuadrada. Ya puedes cerrarla.'
              : [
                  !cuadra(dif) && `El efectivo no cuadra: ${dif < 0 ? 'falta' : 'sobra'} ${money(Math.abs(dif))}.`,
                  pendientes.length > 0 && `Falta cuadrar ${pendientes.map((m) => MEDIO_LABEL[m]).join(', ')}.`,
                  forzar
                    ? observacion.trim() ? 'Se cerrará con la diferencia registrada.' : 'Escribe en la observación el motivo de la diferencia.'
                    : 'Revisa el conteo o registra el gasto, ingreso o venta que falte.',
                ].filter(Boolean).join(' ')}
          </div>
          {!cuadrada && (
            <label className="check" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
              Cerrar aunque no cuadre
            </label>
          )}
          <button className="btn" onClick={onClose}>Volver</button>
          <button className="btn btn-primary" onClick={cerrar} disabled={enviando || !puedeCerrar}
            title={puedeCerrar ? undefined : forzar ? 'Escribe el motivo en la observación' : 'Cuadra la caja o marca «Cerrar aunque no cuadre»'}
          >
            Cerrar e imprimir
          </button>
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
            <Balance r={r} contado={contado} digital={digitalNum} />
            {aConfirmar.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <b>Confirma lo cobrado por medios digitales</b>
                <p className="muted small" style={{ margin: 0 }}>Escribe el total que muestra la app de Yape o Plin, o el voucher del POS.</p>
                {aConfirmar.map((m) => (
                  <div key={m} className="confirmar-digital">
                    <span>{MEDIO_LABEL[m]} <span className="muted small">(sistema {money(total[m])})</span></span>
                    <input
                      className="num"
                      type="number"
                      min="0"
                      step="0.1"
                      value={digital[m] ?? ''}
                      placeholder="0.00"
                      onChange={(e) => setDigital((x) => ({ ...x, [m]: e.target.value }))}
                      onKeyDown={siguiente}
                      aria-label={`Total de ${MEDIO_LABEL[m]} según la app o voucher`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="grid-3">
          <div className="card stat"><div className="label">Efectivo inicial</div><div className="value">{money(r.montoInicial)}</div></div>
          <div className="card stat"><div className="label">Efectivo contado</div><div className="value">{money(contado)}</div></div>
          <div className="card stat"><div className="label">Efectivo en caja actual</div><div className="value" style={{ color: 'var(--accent)' }}>{money(r.efectivoEsperado)}</div></div>
        </div>
        <AlAcumulado
          efectivo={r2(contado - Math.min(contado, fondoDia))}
          yape={r2(DIGITALES.reduce((s, m) => s + (digitalNum[m] ?? n(total[m])), 0))}
          quedaEnCaja={r2(Math.min(contado, fondoDia))}
          previo
        />
        <Campo label={forzar && !cuadrada ? 'Observación (obligatoria: motivo de la diferencia)' : 'Observación'}>
          <input value={observacion} onChange={(e) => setObs(e.target.value)} placeholder={forzar && !cuadrada ? 'Ej.: faltó S/ 2.00 por vuelto mal dado' : undefined} />
        </Campo>
      </div>
    </Modal>
  );
}
