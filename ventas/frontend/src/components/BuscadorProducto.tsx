import { forwardRef, KeyboardEvent, useEffect, useState } from 'react';
import { api, ApiError, qs } from '../api';
import { money, qty } from '../format';
import { Presentacion, Producto } from '../types';
import { useDebounce, useToast } from './ui';

interface Opcion {
  producto: Producto;
  presentacion: Presentacion | null;
}

interface Props {
  onElegir: (p: Producto, presentacion: Presentacion | null) => void;
  placeholder?: string;
  /** Lista también cada presentación (cajetilla, paquete…) como opción propia. */
  conPresentaciones?: boolean;
  /**
   * Si se pasa, ofrece registrar un producto nuevo con lo escrito o escaneado
   * cuando no existe (el lector abre el registro directo al no encontrar el código).
   */
  onNuevo?: (texto: string) => void;
}

/**
 * Campo para escanear o buscar productos. Con el lector, el código llega
 * seguido de Enter y se elige directo; escribiendo, muestra coincidencias.
 * El código de una presentación elige el producto con esa presentación.
 */
const BuscadorProducto = forwardRef<HTMLInputElement, Props>(
  function BuscadorProducto({ onElegir, placeholder, conPresentaciones, onNuevo }, ref) {
    const avisar = useToast();
    const [texto, setTexto] = useState('');
    const [opciones, setOpciones] = useState<Opcion[]>([]);
    const [activa, setActiva] = useState(0);
    // Texto de la última búsqueda terminada: con onNuevo se muestra "Registrar producto nuevo" aunque no haya coincidencias.
    const [buscado, setBuscado] = useState('');
    const q = useDebounce(texto.trim(), 200);
    const conNuevo = !!onNuevo && buscado !== '' && buscado === texto.trim();

    useEffect(() => {
      if (q.length < 2 || /^\d{6,}$/.test(q)) {
        setBuscado('');
        return setOpciones([]);
      }
      let vigente = true;
      api<{ items: Producto[] }>(`/productos${qs({ q, porPagina: 12 })}`).then((r) => {
        if (!vigente) return;
        const lista: Opcion[] = r.items.flatMap((p) => [
          { producto: p, presentacion: null },
          ...(conPresentaciones ? (p.presentaciones ?? []).map((x) => ({ producto: p, presentacion: x })) : []),
        ]);
        // Si lo escrito es el código exacto de una opción, esa va primero (Enter la elige).
        const exacta = lista.findIndex((o) => (o.presentacion ? o.presentacion.codigoBarra : o.producto.codigoBarra) === q);
        if (exacta > 0) lista.unshift(...lista.splice(exacta, 1));
        setOpciones(lista);
        setBuscado(q);
        setActiva(0);
      });
      return () => {
        vigente = false;
      };
    }, [q, conPresentaciones]);

    const elegir = ({ producto, presentacion }: Opcion) => {
      onElegir(producto, conPresentaciones ? presentacion : null);
      setTexto('');
      setOpciones([]);
      setBuscado('');
    };

    const nuevo = (t: string) => {
      setTexto('');
      setOpciones([]);
      setBuscado('');
      onNuevo?.(t);
    };

    const tecla = async (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') setActiva((a) => Math.min(a + 1, opciones.length - (conNuevo ? 0 : 1)));
      else if (e.key === 'ArrowUp') setActiva((a) => Math.max(a - 1, 0));
      else if (e.key === 'Escape') {
        setOpciones([]);
        setBuscado('');
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const t = texto.trim();
        if (!t) return;
        if (opciones[activa] && !/^\d{6,}$/.test(t)) return elegir(opciones[activa]);
        if (conNuevo && opciones.length > 0 && activa === opciones.length) return nuevo(t);
        try {
          const p = await api<Producto>(`/productos/codigo/${encodeURIComponent(t)}`);
          elegir({ producto: p, presentacion: p.presentacion ?? null });
        } catch (err) {
          if (onNuevo && err instanceof ApiError && err.status === 404) return nuevo(t);
          avisar((err as Error).message, true);
          setTexto('');
        }
      }
    };

    return (
      <div className="search">
        <input
          ref={ref}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
          onBlur={() =>
            setTimeout(() => {
              setOpciones([]);
              setBuscado('');
            }, 150)
          }
          placeholder={placeholder ?? 'Escanea el código o escribe el nombre'}
          autoComplete="off"
          role="combobox"
          aria-expanded={opciones.length > 0 || conNuevo}
          aria-controls="buscador-opciones"
          aria-activedescendant={opciones[activa] || (conNuevo && activa === opciones.length) ? `buscador-op-${activa}` : undefined}
        />
        {(opciones.length > 0 || conNuevo) && (
          <div className="sugerencias" id="buscador-opciones" role="listbox">
            {opciones.map((o, i) => {
              const { producto: p, presentacion: x } = o;
              return (
                <div
                  key={`${p.id}-${x?.id ?? 0}`}
                  id={`buscador-op-${i}`}
                  role="option"
                  aria-selected={i === activa}
                  className="sugerencia"
                  onMouseDown={() => elegir(o)}
                  onMouseEnter={() => setActiva(i)}
                  style={x ? { paddingLeft: 28 } : undefined}
                >
                  <div className="grow">
                    <div>
                      {x ? <>{x.nombre} <span className="badge">{qty(x.factor)} und</span></> : p.nombre}
                    </div>
                    <div className="small muted mono">{(x ? x.codigoBarra : p.codigoBarra) ?? 'sin código'}</div>
                  </div>
                  <div className="num small">
                    <div>{money((x ?? p).precio1)}</div>
                    {!x && <div className="muted">Stock {qty(p.stock)}</div>}
                  </div>
                </div>
              );
            })}
            {conNuevo && (
              <div
                id={`buscador-op-${opciones.length}`}
                role="option"
                aria-selected={activa === opciones.length}
                className="sugerencia sugerencia-nueva"
                onMouseDown={() => nuevo(texto.trim())}
                onMouseEnter={() => setActiva(opciones.length)}
              >
                <div className="grow">
                  <div>+ Registrar producto nuevo</div>
                  <div className="small muted">
                    {opciones.length ? 'No es ninguno de estos: ' : 'No hay productos con '}«{texto.trim()}»
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

export default BuscadorProducto;
