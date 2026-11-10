import { useState } from 'react';
import { api } from '../api';
import { money, n } from '../format';
import { AvisoGastoFijo, CategoriaGasto, Gasto, MEDIO_LABEL, MedioPago, MEDIOS, OrigenGasto } from '../types';
import OrigenPago from './OrigenPago';
import { Campo, Modal, useCarga, useToast } from './ui';

const nombreMes = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
};

/**
 * Registrar un gasto. Por defecto sale del acumulado; `soloCaja` es el gasto de
 * emergencia desde la pantalla de Caja. `fijo` paga un gasto fijo de un mes.
 */
export default function GastoModal({
  onClose,
  onListo,
  soloCaja,
  fijo,
}: {
  onClose: () => void;
  onListo: (g: Gasto) => void;
  soloCaja?: boolean;
  fijo?: AvisoGastoFijo;
}) {
  const avisar = useToast();
  const { data: categorias } = useCarga(() => api<CategoriaGasto[]>('/gastos/categorias'), []);
  const { data: trabajadores } = useCarga(() => api<string[]>('/gastos/trabajadores').catch(() => []), []);
  const [categoriaId, setCategoria] = useState<number | ''>(fijo?.categoria.id ?? '');
  const [concepto, setConcepto] = useState(fijo ? `${fijo.nombre} ${nombreMes(fijo.periodo)}` : '');
  const [monto, setMonto] = useState(fijo?.monto != null ? String(n(fijo.monto)) : '');
  const [medioPago, setMedio] = useState<MedioPago>('EFECTIVO');
  const [origen, setOrigen] = useState<OrigenGasto>(soloCaja ? 'CAJA' : 'ACUMULADO');
  const [numeroOperacion, setOperacion] = useState('');
  const [trabajador, setTrabajador] = useState(fijo?.trabajador ?? '');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  const activas = categorias?.filter((c) => c.activo || c.id === categoriaId) ?? [];
  const cat = categorias?.find((c) => c.id === categoriaId);
  const listo = categoriaId !== '' && concepto.trim().length >= 3 && n(monto) > 0 && (!cat?.pideTrabajador || trabajador.trim() !== '');

  const guardar = async () => {
    if (!listo) return;
    setEnviando(true);
    try {
      const g = await api<Gasto>('/gastos', {
        body: {
          categoriaId,
          concepto: concepto.trim(),
          monto: n(monto),
          origen,
          medioPago: origen === 'CAJA' ? 'EFECTIVO' : medioPago,
          numeroOperacion: numeroOperacion.trim() || undefined,
          trabajador: trabajador.trim() || undefined,
          nota: nota.trim() || undefined,
          gastoFijoId: fijo?.gastoFijoId,
          periodo: fijo?.periodo,
        },
      });
      avisar(`Gasto de ${money(g.monto)} registrado`);
      onListo(g);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      titulo={fijo ? `Pagar ${fijo.nombre}` : soloCaja ? 'Gasto desde la caja del día' : 'Registrar gasto'}
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={enviando || !listo}>Registrar gasto</button>
        </>
      }
    >
      <form className="grid-2" onSubmit={(e) => (e.preventDefault(), guardar())}>
        <Campo label="Categoría">
          <select value={categoriaId} onChange={(e) => setCategoria(e.target.value ? Number(e.target.value) : '')} autoFocus={!fijo} disabled={!!fijo}>
            <option value="">Elige…</option>
            {activas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Monto" ayuda={fijo?.monto != null ? `Referencia: ${money(fijo.monto)}` : undefined}>
          <input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" autoFocus={!!fijo} />
        </Campo>
        <Campo label="Concepto" className="span-2">
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: recibo de luz de octubre, pasaje al mercado" />
        </Campo>
        {cat?.pideTrabajador && (
          <Campo label="Trabajador" className="span-2" ayuda="A quién se le pagó (sueldo o adelanto)">
            <input list="trabajadores-gasto" value={trabajador} onChange={(e) => setTrabajador(e.target.value)} />
            <datalist id="trabajadores-gasto">
              {trabajadores?.map((t) => <option key={t} value={t} />)}
            </datalist>
          </Campo>
        )}
        {!soloCaja && (
          <Campo label="Medio de pago">
            <select value={medioPago} onChange={(e) => setMedio(e.target.value as MedioPago)}>
              {MEDIOS.map((m) => <option key={m} value={m}>{MEDIO_LABEL[m]}</option>)}
            </select>
          </Campo>
        )}
        {!soloCaja && medioPago !== 'EFECTIVO' && (
          <Campo label="N.º de operación" ayuda="Opcional">
            <input className="mono" value={numeroOperacion} onChange={(e) => setOperacion(e.target.value)} />
          </Campo>
        )}
        <Campo label="Nota" className="span-2" ayuda="Opcional: boleta o recibo, número, a quién se pagó…">
          <input value={nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
        {!soloCaja && (
          <div className="span-2 stack" style={{ gap: 6 }}>
            <b className="small">¿De dónde sale el dinero?</b>
            <OrigenPago origen={origen} onChange={setOrigen} medio={medioPago} monto={n(monto)} />
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
