import { useState } from 'react';
import { api } from '../api';
import { money, n } from '../format';
import { Compra, MEDIO_LABEL, MEDIOS, MedioPago, OrigenGasto } from '../types';
import OrigenPago from './OrigenPago';
import { Campo, Modal, useToast } from './ui';

export default function PagoModal({ compra, onClose, onListo }: { compra: Compra; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [monto, setMonto] = useState(String(n(compra.saldo)));
  const [medioPago, setMedio] = useState<MedioPago>('EFECTIVO');
  const [numeroOperacion, setOperacion] = useState('');
  const [observacion, setObs] = useState('');
  const [origen, setOrigen] = useState<OrigenGasto>('ACUMULADO');
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    setEnviando(true);
    try {
      await api(`/compras/${compra.id}/pagos`, {
        body: { monto: n(monto), medioPago, origen: medioPago === 'EFECTIVO' ? origen : 'ACUMULADO', numeroOperacion: numeroOperacion.trim() || undefined, observacion: observacion.trim() || undefined },
      });
      avisar(`Pago de ${money(monto)} registrado`);
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      titulo="Registrar pago al proveedor"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={enviando || n(monto) <= 0 || n(monto) > n(compra.saldo)}>Registrar pago</button>
        </>
      }
    >
      <div className="stack">
        <div>
          <h3>{compra.proveedor.razonSocial}</h3>
          <div className="muted small">
            {compra.serie}-{compra.numero} · saldo pendiente <b>{money(compra.saldo)}</b>
          </div>
        </div>
        <div className="grid-2">
          <Campo label="Monto">
            <input className="num" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Medio de pago">
            <select value={medioPago} onChange={(e) => setMedio(e.target.value as MedioPago)}>
              {MEDIOS.map((m) => <option key={m} value={m}>{MEDIO_LABEL[m]}</option>)}
            </select>
          </Campo>
          {medioPago !== 'EFECTIVO' && (
            <Campo label="N.º de operación" ayuda="Opcional">
              <input className="mono" value={numeroOperacion} onChange={(e) => setOperacion(e.target.value)} />
            </Campo>
          )}
          <Campo label="Observación" className={medioPago === 'EFECTIVO' ? 'span-2' : ''}>
            <input value={observacion} onChange={(e) => setObs(e.target.value)} />
          </Campo>
          <div className="span-2 stack" style={{ gap: 6 }}>
            <b className="small">¿De dónde sale el dinero?</b>
            <OrigenPago origen={origen} onChange={setOrigen} medio={medioPago} monto={n(monto)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
