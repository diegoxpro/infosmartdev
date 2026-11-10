import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { money, n } from '../format';
import { MEDIO_LABEL, MedioPago } from '../types';
import { useMarca } from '../marca';
import { Icono } from './icons';
import { Kbd, Modal, useAtajos } from './ui';
import logoEfectivo from '../assets/pagos/efectivo.png';
import logoYape from '../assets/pagos/yape.png';
import logoPlin from '../assets/pagos/plin.png';
import logoTarjeta from '../assets/pagos/tarjeta.png';

export interface PagoVenta {
  medioPago: MedioPago;
  monto: number;
  numeroOperacion?: string;
}

const OTROS: MedioPago[] = ['YAPE', 'PLIN', 'TARJETA'];
const MEDIOS: MedioPago[] = ['EFECTIVO', ...OTROS];
const BILLETES = [10, 20, 50, 100, 200];
const LOGO: Record<string, string> = { EFECTIVO: logoEfectivo, YAPE: logoYape, PLIN: logoPlin, TARJETA: logoTarjeta };
/** Tecla de cada medio de pago dentro del modal. */
const TECLA: Record<string, string> = { EFECTIVO: 'F1', YAPE: 'F2', PLIN: 'F3', TARJETA: 'F4' };
const r2 = (x: number) => Math.round(x * 100) / 100;

export default function CobroModal({
  total,
  enviando,
  onClose,
  onConfirmar,
  inicial,
  titulo,
  onCambio,
}: {
  total: number;
  enviando: boolean;
  onClose: () => void;
  onConfirmar: (pagos: PagoVenta[], imprimir: boolean) => void;
  /** Pagos con los que se abre el modal, al corregir una venta ya hecha. */
  inicial?: PagoVenta[];
  titulo?: string;
  /** Avisa los pagos escritos hasta ahora, para guardarlos como borrador. */
  onCambio?: (pagos: PagoVenta[]) => void;
}) {
  const [efectivo, setEfectivo] = useState(() => {
    const e = inicial?.filter((p) => p.medioPago === 'EFECTIVO').reduce((s, p) => s + p.monto, 0) ?? 0;
    return inicial && (e > 0 || inicial.some((p) => p.medioPago !== 'EFECTIVO')) ? String(r2(e)) : '';
  });
  const [otros, setOtros] = useState<Record<string, { monto: string; op: string }>>(() =>
    Object.fromEntries(
      OTROS.map((m) => {
        const p = inicial?.find((x) => x.medioPago === m);
        return [m, { monto: p ? String(p.monto) : '', op: p?.numeroOperacion ?? '' }];
      }),
    ),
  );
  const [imprimir, setImprimir] = useState(() => {
    try {
      return localStorage.getItem('candys.imprimir') !== '0';
    } catch {
      return true;
    }
  });

  const { marca } = useMarca();
  /** Medio marcado en la lista: el último elegido o el que se está escribiendo. */
  const [activo, setActivo] = useState<MedioPago>(() => {
    const otro = inicial?.find((p) => p.medioPago !== 'EFECTIVO');
    return otro && !inicial?.some((p) => p.medioPago === 'EFECTIVO') ? otro.medioPago : 'EFECTIVO';
  });

  const sumaOtros = r2(OTROS.reduce((s, m) => s + n(otros[m].monto), 0));
  // Sin monto escrito en efectivo se asume pago exacto.
  const efectivoUsado = efectivo === '' ? Math.max(0, r2(total - sumaOtros)) : n(efectivo);
  const pagado = r2(efectivoUsado + sumaOtros);
  const falta = r2(total - pagado);
  const vuelto = falta < 0 ? -falta : 0;
  const valido = falta <= 0 && sumaOtros <= total && vuelto <= efectivoUsado;

  const setOtro = (m: string, k: 'monto' | 'op', v: string) => setOtros((o) => ({ ...o, [m]: { ...o[m], [k]: v } }));

  const campos = useRef<Partial<Record<MedioPago, HTMLInputElement | null>>>({});
  const enfocar = (m: MedioPago) =>
    setTimeout(() => {
      campos.current[m]?.focus();
      campos.current[m]?.select();
    }, 0);

  /**
   * Elige un medio de pago con su tecla o su botón. Yape, Plin y tarjeta se llenan con lo que falta
   * (todo el total si aún no se escribió efectivo); el efectivo queda en "exacto" para escribir lo recibido.
   * Si ya no falta nada, el monto se pasa al medio elegido: por ejemplo F2 y luego F3 cambia de Yape a Plin.
   */
  const elegir = (m: MedioPago) => {
    setActivo(m);
    const sinMontos = (excepto?: MedioPago) =>
      Object.fromEntries(OTROS.map((x) => [x, x === excepto ? otros[x] : { ...otros[x], monto: '' }]));
    if (m === 'EFECTIVO') {
      // Si Yape, Plin o tarjeta ya cubren el total, el cobro pasa entero a efectivo.
      if (sumaOtros >= total) setOtros(sinMontos());
      setEfectivo('');
    } else {
      const efectivoEscrito = efectivo === '' ? 0 : n(efectivo);
      const otrosSinEste = OTROS.filter((x) => x !== m).reduce((s, x) => s + n(otros[x].monto), 0);
      const falta = r2(total - efectivoEscrito - otrosSinEste);
      if (falta > 0) {
        setOtro(m, 'monto', String(falta));
        if (efectivo === '') setEfectivo('0');
      } else {
        // Ya estaba pagado: se cambia de medio. Se respeta el efectivo escrito si no cubre todo.
        const resto = r2(total - efectivoEscrito);
        const nuevos = sinMontos(m);
        nuevos[m] = { ...otros[m], monto: String(resto > 0 ? resto : total) };
        setOtros(nuevos);
        if (efectivo === '' || resto <= 0) setEfectivo('0');
      }
    }
    enfocar(m);
  };

  useAtajos(Object.fromEntries(Object.entries(TECLA).map(([m, tecla]) => [tecla, () => elegir(m as MedioPago)])), { enModal: true });

  const pagos: PagoVenta[] = [
    ...(efectivoUsado > 0 ? [{ medioPago: 'EFECTIVO' as MedioPago, monto: efectivoUsado }] : []),
    ...OTROS.filter((m) => n(otros[m].monto) > 0).map((m) => ({ medioPago: m, monto: n(otros[m].monto), numeroOperacion: otros[m].op.trim() || undefined })),
  ];
  const clavePagos = JSON.stringify(pagos);
  const avisarCambio = useRef(onCambio);
  avisarCambio.current = onCambio;
  useEffect(() => avisarCambio.current?.(JSON.parse(clavePagos)), [clavePagos]);

  const confirmar = () => {
    if (!valido || enviando) return;
    try {
      localStorage.setItem('candys.imprimir', imprimir ? '1' : '0');
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
    onConfirmar(pagos, imprimir);
  };

  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmar();
    }
  };

  return (
    <Modal
      className="cobro"
      ancho
      titulo={
        <span className="cobro-titulo">
          <Icono nombre="compras" tam={30} />
          <span>
            {titulo ?? 'Cobrar venta'}
            <small>{marca.nombre}</small>
          </span>
        </span>
      }
      onClose={onClose}
      pie={
        <>
          <label className="check grow cobro-imprimir">
            <Icono nombre="imprimir" tam={22} />
            <input type="checkbox" checked={imprimir} onChange={(e) => setImprimir(e.target.checked)} /> Imprimir ticket
          </label>
          <button className="btn btn-lg" onClick={onClose}>
            <Icono nombre="volver" /> Volver <Kbd>Esc</Kbd>
          </button>
          <button className="btn btn-lg btn-confirmar" onClick={confirmar} disabled={!valido || enviando}>
            {enviando ? 'Guardando…' : <><Icono nombre="ok" tam={20} /> Confirmar cobro <span className="kbd">Enter</span></>}
          </button>
        </>
      }
    >
      <div className="stack" onKeyDown={enter}>
        <div className="cobro-grid">
          <section className="cobro-monto">
            <h3><Icono nombre="monedas" tam={24} /> Monto a cobrar</h3>
            <div className="cobro-total" aria-label={`Total ${money(total)}`}>{money(total)}</div>
            <div className="cobro-billetes" aria-label="Efectivo recibido">
              {BILLETES.filter((b) => b >= total - sumaOtros).slice(0, 3).map((b) => (
                <button key={b} className="btn btn-lg" onClick={() => (setEfectivo(String(b)), setActivo('EFECTIVO'))} title={`Recibí S/ ${b} en efectivo`}>
                  S/ {b}
                </button>
              ))}
            </div>
            <div className="cobro-ayuda small muted">
              <div><Kbd>F1</Kbd> Efectivo · <Kbd>F2</Kbd> Yape</div>
              <div><Kbd>F3</Kbd> Plin · <Kbd>F4</Kbd> Tarjeta</div>
              <div>llenan lo que falta · <Kbd>Enter</Kbd> confirma</div>
            </div>
          </section>

          <section className="cobro-medios">
            <h3><Icono nombre="billetera" tam={24} /> Método de pago</h3>
            <div className="cobro-lista" role="radiogroup" aria-label="Método de pago">
              {MEDIOS.map((m) => {
                const efectivoFila = m === 'EFECTIVO';
                const conMonto = efectivoFila ? efectivoUsado > 0 : n(otros[m].monto) > 0;
                return (
                  <div key={m} className={`cobro-fila${activo === m ? ' on' : ''}${conMonto ? ' con-monto' : ''}`}>
                    <button
                      className="cobro-medio"
                      role="radio"
                      aria-checked={activo === m}
                      onClick={() => elegir(m)}
                      title={efectivoFila ? 'Cobrar en efectivo' : `Cobrar lo que falta con ${MEDIO_LABEL[m]}`}
                    >
                      <span className="radio" aria-hidden="true" />
                      <img src={LOGO[m]} alt={MEDIO_LABEL[m]} draggable={false} />
                      <Kbd>{TECLA[m]}</Kbd>
                    </button>
                    {efectivoFila ? (
                      <>
                        <input
                          ref={(el) => (campos.current.EFECTIVO = el)}
                          className="num cobro-importe"
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label="Efectivo recibido"
                          placeholder={Math.max(0, total - sumaOtros).toFixed(2)}
                          value={efectivo}
                          onChange={(e) => setEfectivo(e.target.value)}
                          onFocus={() => setActivo('EFECTIVO')}
                          autoFocus
                        />
                        <span className="small muted cobro-nota">Recibido del cliente. Vacío = pago exacto</span>
                      </>
                    ) : (
                      <>
                        <input
                          ref={(el) => (campos.current[m] = el)}
                          className="num cobro-importe"
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label={`Monto con ${MEDIO_LABEL[m]}`}
                          placeholder="0.00"
                          value={otros[m].monto}
                          onChange={(e) => setOtro(m, 'monto', e.target.value)}
                          onFocus={() => setActivo(m)}
                        />
                        <input
                          className="mono"
                          aria-label={`N.º de operación de ${MEDIO_LABEL[m]}`}
                          placeholder="N.º operación (opcional)"
                          value={otros[m].op}
                          onChange={(e) => setOtro(m, 'op', e.target.value)}
                          onFocus={() => setActivo(m)}
                          disabled={!n(otros[m].monto)}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className={`cobro-resumen${falta > 0 ? ' falta' : ''}`}>
          <span className="cobro-resumen-icono"><Icono nombre={falta > 0 ? 'alerta' : 'ok'} tam={22} /></span>
          <div>
            <div className="etiqueta">A pagar</div>
            <div className="cifra">{money(total)}</div>
          </div>
          <div>
            <div className="etiqueta">Recibido</div>
            <div className="cifra chica">{money(pagado)}</div>
          </div>
          <div className="num">
            <div className="etiqueta">{falta > 0 ? 'Falta' : 'Vuelto'}</div>
            <div className="cifra resalta">{money(falta > 0 ? falta : vuelto)}</div>
          </div>
        </div>
        {sumaOtros > total && <div className="alert danger">Yape, Plin y tarjeta no pueden superar el total.</div>}
      </div>
    </Modal>
  );
}
