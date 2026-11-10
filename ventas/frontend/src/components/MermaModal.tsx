import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fecha, money, n, qty } from '../format';
import { Lote } from '../types';
import { Campo, Modal, useToast } from './ui';

export interface MermaInicial {
  productoId: number;
  nombre: string;
  costo: number;
  lote?: Lote;
  cantidad?: number;
  motivo?: string;
}

export default function MermaModal({ inicial, onClose, onListo }: { inicial: MermaInicial; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const { puede } = useAuth();
  const [cantidad, setCantidad] = useState(String(inicial.cantidad ?? ''));
  const [motivo, setMotivo] = useState(inicial.motivo ?? '');
  const [enviando, setEnviando] = useState(false);
  const valor = n(cantidad) * inicial.costo;

  const guardar = async () => {
    setEnviando(true);
    try {
      await api('/inventario/mermas', {
        body: { productoId: inicial.productoId, loteId: inicial.lote?.id, cantidad: n(cantidad), motivo },
      });
      avisar(`Merma registrada: ${qty(cantidad)} de ${inicial.nombre}`);
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      titulo="Enviar a merma"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={!puede('stock.ajustar') || enviando || n(cantidad) <= 0 || motivo.trim().length < 3}>
            Registrar merma
          </button>
        </>
      }
    >
      <div className="stack">
        {!puede('stock.ajustar') && <div className="alert warn">No tienes permiso para registrar mermas.</div>}
        <div>
          <h3>{inicial.nombre}</h3>
          {inicial.lote && (
            <div className="muted small">
              Lote {inicial.lote.codigo ?? `#${inicial.lote.id}`} · vence {fecha(inicial.lote.fechaVencimiento)} · quedan {qty(inicial.lote.cantidad)}
            </div>
          )}
        </div>
        <div className="grid-2">
          <Campo label="Cantidad">
            <input className="num" type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Valor al costo" ayuda="Para tu contabilidad">
            <input className="num" value={money(valor)} readOnly tabIndex={-1} />
          </Campo>
        </div>
        <Campo label="Motivo">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Vencido, roto, mal estado…" />
        </Campo>
      </div>
    </Modal>
  );
}
