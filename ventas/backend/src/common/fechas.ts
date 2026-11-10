/** Fecha de hoy (sin hora) en la zona horaria del servidor, como Date UTC para columnas @db.Date. */
export function hoy(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}
