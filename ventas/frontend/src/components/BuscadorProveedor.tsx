import { useMemo, useState } from 'react';
import { Proveedor } from '../types';

const MAX = 8;
const etiqueta = (p: Proveedor) => `${p.nombreComercial ? `${p.nombreComercial} · ` : ''}${p.razonSocial}`;
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Elegir el proveedor de la compra escribiendo RUC o nombre (↑/↓ y Enter).
 * Si no existe, la última opción abre su registro con lo escrito ya puesto.
 */
export default function BuscadorProveedor({
  proveedores,
  elegido,
  onElegir,
  onNuevo,
}: {
  proveedores: Proveedor[];
  elegido: Proveedor | null;
  onElegir: (p: Proveedor) => void;
  onNuevo: (texto: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(0);
  const t = texto.trim();

  const opciones = useMemo(() => {
    const q = normal(t);
    if (!q) return proveedores.slice(0, MAX);
    return proveedores
      .filter((p) => p.ruc?.startsWith(q) || normal(p.razonSocial).includes(q) || normal(p.nombreComercial ?? '').includes(q) || normal(p.contacto ?? '').includes(q))
      .slice(0, MAX);
  }, [proveedores, t]);
  const conNuevo = t.length > 0;
  const total = opciones.length + (conNuevo ? 1 : 0);

  const elegir = (p: Proveedor) => {
    onElegir(p);
    setTexto('');
    setAbierto(false);
  };
  const nuevo = () => {
    setAbierto(false);
    onNuevo(t);
    setTexto('');
  };

  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setAbierto(true), setActiva((a) => Math.min(a + 1, total - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActiva((a) => Math.max(a - 1, 0)));
    else if (e.key === 'Escape' && abierto) (e.preventDefault(), e.stopPropagation(), setAbierto(false), setTexto(''));
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (opciones[activa]) elegir(opciones[activa]);
      else if (conNuevo) nuevo();
    }
  };

  return (
    <div className="search">
      <input
        value={abierto ? texto : elegido ? etiqueta(elegido) : texto}
        onChange={(e) => (setTexto(e.target.value), setAbierto(true), setActiva(0))}
        onFocus={(e) => (setAbierto(true), setActiva(0), e.target.select())}
        onBlur={() => setTimeout(() => (setAbierto(false), setTexto('')), 150)}
        onKeyDown={tecla}
        placeholder="Escribe el RUC o el nombre del proveedor"
        autoComplete="off"
        role="combobox"
        aria-label="Proveedor"
        aria-expanded={abierto && total > 0}
        aria-controls="proveedor-opciones"
        aria-activedescendant={abierto && activa < total ? `proveedor-op-${activa}` : undefined}
      />
      {abierto && total > 0 && (
        <div className="sugerencias" id="proveedor-opciones" role="listbox">
          {opciones.map((p, i) => (
            <div
              key={p.id}
              id={`proveedor-op-${i}`}
              role="option"
              aria-selected={i === activa}
              className="sugerencia"
              onMouseDown={() => elegir(p)}
              onMouseEnter={() => setActiva(i)}
            >
              <div className="grow">
                <div>{p.nombreComercial ? <><b>{p.nombreComercial}</b> · {p.razonSocial}</> : p.razonSocial}</div>
                <div className="small muted mono">{p.ruc ?? 'sin RUC'}{p.contacto && ` · ${p.contacto}`}</div>
              </div>
              {!!p.diasCredito && <span className="badge info">Crédito {p.diasCredito} d</span>}
            </div>
          ))}
          {conNuevo && (
            <div
              id={`proveedor-op-${opciones.length}`}
              role="option"
              aria-selected={activa === opciones.length}
              className="sugerencia sugerencia-nueva"
              onMouseDown={nuevo}
              onMouseEnter={() => setActiva(opciones.length)}
            >
              <div className="grow">
                <div>+ Registrar proveedor nuevo</div>
                <div className="small muted">{opciones.length ? 'No es ninguno de estos: ' : 'No hay proveedores con '}«{t}»</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
