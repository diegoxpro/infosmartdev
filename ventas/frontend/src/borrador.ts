/**
 * Borradores de trabajo en curso (venta, compra) guardados en el navegador.
 * Sobreviven a cambiar de módulo, recargar o cerrar la pestaña, y se limpian al terminar.
 */
export function leerBorrador<T>(clave: string): Partial<T> | null {
  try {
    const v = localStorage.getItem(clave);
    return v ? (JSON.parse(v) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function guardarBorrador(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function borrarBorrador(clave: string) {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* sin almacenamiento */
  }
}

export const BORRADOR_VENTA = 'candys.venta';
export const BORRADOR_COMPRA = 'candys.compra';
