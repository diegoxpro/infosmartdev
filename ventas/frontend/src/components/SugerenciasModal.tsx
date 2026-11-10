import { useState } from 'react';
import { api } from '../api';
import { margenReal, money } from '../format';
import { Sugerencia } from '../types';
import { Modal, useToast } from './ui';

/** Tras una compra, propone nuevos precios según el margen de cada producto. */
export default function SugerenciasModal({ sugerencias, onClose }: { sugerencias: Sugerencia[]; onClose: () => void }) {
  const avisar = useToast();
  // Por defecto solo se marcan los precios que suben: bajar un precio debe ser decisión explícita.
  const [filas, setFilas] = useState(() =>
    sugerencias.map((s) => ({
      ...s,
      nuevos: s.sugeridos.map((v, k) => String(v > s.actuales[k] ? v : s.actuales[k])),
      aplicar: s.sugeridos.some((v, k) => v > s.actuales[k]),
    })),
  );
  const [enviando, setEnviando] = useState(false);

  const setPrecio = (i: number, k: number, v: string) =>
    setFilas((f) => f.map((x, j) => (j === i ? { ...x, nuevos: x.nuevos.map((p, m) => (m === k ? v : p)) } : x)));
  const usarSugeridos = (i: number) =>
    setFilas((f) => f.map((x, j) => (j === i ? { ...x, aplicar: true, nuevos: x.sugeridos.map(String) } : x)));

  const aplicar = async () => {
    const items = filas
      .filter((f) => f.aplicar)
      .map((f) => ({ productoId: f.productoId, presentacionId: f.presentacionId ?? undefined, precio1: Number(f.nuevos[0]), precio2: Number(f.nuevos[1]), precio3: Number(f.nuevos[2]) }));
    if (!items.length) return onClose();
    setEnviando(true);
    try {
      await api('/productos/precios', { method: 'PATCH', body: { items } });
      avisar(`Precios actualizados en ${items.length} producto${items.length > 1 ? 's' : ''}`);
      onClose();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  const n = filas.filter((f) => f.aplicar).length;
  return (
    <Modal
      ancho
      titulo="¿Actualizar precios de venta?"
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Dejar como están</button>
          <button className="btn btn-primary" onClick={aplicar} disabled={enviando}>
            {n ? `Actualizar ${n} producto${n > 1 ? 's' : ''}` : 'Cerrar'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        El costo cambió en estos productos. Los precios sugeridos aplican tu margen a cada precio. Puedes editar cualquier precio antes de guardar.
        {filas.some((f) => f.presentacionId) && ' Las cajetillas, paquetes y cajas aparecen aparte, con el costo de todas sus unidades.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Producto</th>
              <th className="num">Costo</th>
              {[1, 2, 3].map((k) => <th key={k} className="num">Precio {k}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={`${f.productoId}-${f.presentacionId ?? 0}`}>
                <td>
                  <input type="checkbox" checked={f.aplicar} onChange={(e) => setFilas((x) => x.map((r, j) => (j === i ? { ...r, aplicar: e.target.checked } : r)))} />
                </td>
                <td>
                  {f.nombre}
                  <div>
                    <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 22, color: 'var(--accent)' }} onClick={() => usarSugeridos(i)}>
                      Usar los 3 sugeridos
                    </button>
                  </div>
                </td>
                <td className="num">
                  {f.costoAnterior != null && f.costoAnterior > 0 && <div className="small muted"><s>{money(f.costoAnterior)}</s></div>}
                  {money(f.costoNuevo)}
                </td>
                {[0, 1, 2].map((k) => {
                  const sube = f.sugeridos[k] > f.actuales[k];
                  const real = margenReal(f.costoNuevo, Number(f.nuevos[k]));
                  return (
                    <td key={k} className="num" style={{ minWidth: 130 }}>
                      <div className="small muted">
                        Actual {money(f.actuales[k])} · sug.{' '}
                        <span style={{ color: sube ? 'var(--ok)' : 'var(--warn)' }}>{money(f.sugeridos[k])}</span>
                      </div>
                      <input
                        className="num"
                        style={{ height: 30, marginTop: 2 }}
                        type="number"
                        step="0.01"
                        value={f.nuevos[k]}
                        disabled={!f.aplicar}
                        onChange={(e) => setPrecio(i, k, e.target.value)}
                      />
                      <div className="small muted">{real != null ? `${real}% (meta ${f.margenes[k]}%)` : ''}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
