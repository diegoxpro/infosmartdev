import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icono } from './icons';

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  titulo,
  onClose,
  children,
  pie,
  ancho,
  className,
}: {
  titulo: ReactNode;
  onClose: () => void;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: boolean;
  /** Clase extra de la caja, para modales con diseño propio (por ejemplo el cobro). */
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  // Foco: entra al primer campo (o al que tenga autoFocus), queda atrapado dentro y vuelve al salir.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const el = caja.current!;
    if (!el.contains(document.activeElement)) {
      const primero = el.querySelector<HTMLElement>('.modal-body ' + ENFOCABLES.split(', ').join(', .modal-body ')) ?? el;
      primero.focus();
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return cerrar.current();
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
      else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
    };
    el.addEventListener('keydown', tecla);
    return () => {
      el.removeEventListener('keydown', tecla);
      previo?.focus?.();
    };
  }, []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={caja} className={`modal${ancho ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-titulo" tabIndex={-1}>
        <div className="modal-head">
          <h2 id="modal-titulo">{titulo}</h2>
          <button className="close" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <Icono nombre="cerrar" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {pie && <div className="modal-foot">{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({ label, ayuda, children, className }: { label: string; ayuda?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

type Toast = { id: number; texto: string; error?: boolean };
const ToastCtx = createContext<(texto: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const avisar = useCallback((texto: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texto, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`} role={t.error ? 'alert' : 'status'}>
            <Icono nombre={t.error ? 'alerta' : 'ok'} />
            <span className="grow">{t.texto}</span>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Cerrar aviso">
              <Icono nombre="cerrar" tam={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Carga datos y expone recargar(). */
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    cargar()
      .then((d) => vigente && (setData(d), setError(null)))
      .catch((e) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, vuelta]);
  return { data, error, cargando, recargar: () => setVuelta((v) => v + 1), setData };
}

export function useDebounce<T>(valor: T, ms = 250) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/**
 * Atajos de teclado de una pantalla: { F2: () => ..., F9: () => ... }.
 * No se disparan mientras hay un modal abierto, salvo que la pantalla sea el propio modal (enModal).
 */
export function useAtajos(mapa: Record<string, (e: KeyboardEvent) => void>, { activo = true, enModal = false } = {}) {
  const ref = useRef(mapa);
  ref.current = mapa;
  useEffect(() => {
    if (!activo) return;
    const tecla = (e: KeyboardEvent) => {
      const fn = ref.current[e.key];
      if (!fn) return;
      if (!enModal && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [activo, enModal]);
}
