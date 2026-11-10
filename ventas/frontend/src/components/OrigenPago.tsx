import { useEffect, useRef } from 'react';
import { api } from '../api';
import { money, n } from '../format';
import { Caja, MedioPago, OrigenGasto, SaldosFondo } from '../types';
import { useCarga } from './ui';

/** Saldos para elegir de dónde sale un pago: acumulado (efectivo o Yape) o caja del día. */
export function useSaldosPago() {
  const { data: saldos } = useCarga(() => api<SaldosFondo>('/acumulado/saldos').catch(() => null), []);
  const { data: caja } = useCarga(() => api<Caja | null>('/caja/actual').catch(() => null), []);
  return { saldos, cajaEfectivo: caja?.resumen ? n(caja.resumen.efectivoEsperado) : null };
}

/**
 * Elige de dónde sale el dinero. Lo normal es el acumulado; si ahí no alcanza y
 * la caja del día sí, se propone la caja (mientras no se haya elegido a mano).
 */
export default function OrigenPago({
  origen,
  onChange,
  medio,
  monto,
}: {
  origen: OrigenGasto;
  onChange: (o: OrigenGasto) => void;
  medio: MedioPago;
  monto: number;
}) {
  const { saldos, cajaEfectivo } = useSaldosPago();
  const tocado = useRef(false);
  const esEfectivo = medio === 'EFECTIVO';
  const enAcumulado = saldos ? (esEfectivo ? saldos.EFECTIVO : saldos.YAPE) : null;
  const faltaAcumulado = enAcumulado != null && monto > enAcumulado + 0.005;
  const faltaCaja = cajaEfectivo == null || monto > cajaEfectivo + 0.005;
  const cajaPosible = esEfectivo && cajaEfectivo != null;

  useEffect(() => {
    if (tocado.current) return;
    if (origen === 'ACUMULADO' && faltaAcumulado && cajaPosible && !faltaCaja) onChange('CAJA');
    else if (origen === 'CAJA' && (!faltaAcumulado || !cajaPosible)) onChange('ACUMULADO');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faltaAcumulado, faltaCaja, cajaPosible]);
  // Pago digital: solo puede salir del Yape del acumulado.
  useEffect(() => {
    if (!esEfectivo && origen === 'CAJA') onChange('ACUMULADO');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esEfectivo]);

  const elegir = (o: OrigenGasto) => {
    tocado.current = true;
    onChange(o);
  };

  return (
    <div className="origenes" role="radiogroup" aria-label="De dónde sale el dinero">
      <label className={`origen${origen === 'ACUMULADO' ? ' elegido' : ''}`}>
        <input type="radio" name="origen" checked={origen === 'ACUMULADO'} onChange={() => elegir('ACUMULADO')} />
        <span className="grow">
          <b>Acumulado</b>
          <span className="small muted">
            {enAcumulado == null ? 'Cajas anteriores' : `${esEfectivo ? 'Efectivo' : 'Yape'}: ${money(enAcumulado)}`}
          </span>
          {faltaAcumulado && <span className="small falta">No alcanza</span>}
        </span>
      </label>
      <label className={`origen${origen === 'CAJA' ? ' elegido' : ''}${cajaPosible ? '' : ' deshabilitado'}`}>
        <input type="radio" name="origen" checked={origen === 'CAJA'} disabled={!cajaPosible} onChange={() => elegir('CAJA')} />
        <span className="grow">
          <b>Caja del día</b>
          <span className="small muted">
            {!esEfectivo ? 'Solo efectivo' : cajaEfectivo == null ? 'La caja está cerrada' : `Efectivo: ${money(cajaEfectivo)}`}
          </span>
          {cajaPosible && faltaCaja && <span className="small falta">No alcanza</span>}
        </span>
      </label>
    </div>
  );
}
