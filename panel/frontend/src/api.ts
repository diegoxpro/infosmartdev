export type Producto = 'VENTAS' | 'LAVADERO';
export type Estado = 'PRUEBA' | 'ACTIVA' | 'SUSPENDIDA';

export interface Plan { id: number; codigo: string; nombre: string; precioMensual: string; maxUsuarios: number }
export interface ProductoEmpresa {
  id: number; producto: Producto; baseDatos: string; adminUsuario: string;
  adminClaveTemporal: boolean; aprovisionado: boolean; creadoEl: string;
}
export interface Evento { id: number; tipo: string; detalle: string | null; usuario: string | null; creadoEl: string }
export interface Empresa {
  id: number; razonSocial: string; ruc: string; subdominio: string; url: string;
  contacto: string | null; telefono: string | null; correo: string | null; notas: string | null;
  estado: Estado; venceEl: string; creadoEl: string; plan: Plan; productos: ProductoEmpresa[];
  acceso: { permitido: boolean; motivo: 'SUSPENDIDA' | 'VENCIDA' | null };
  eventos?: Evento[];
}
export interface Clave { producto: Producto; usuario: string; clave: string }
export interface Resumen { dominioBase: string; total: number; activas: number; prueba: number; suspendidas: number; vencidas: number; porVencer: number }

const LLAVE = 'infosmart.sesion';

export function sesion(): { token: string; nombre: string } | null {
  try { return JSON.parse(localStorage.getItem(LLAVE) ?? 'null'); } catch { return null; }
}
export function guardarSesion(s: { token: string; nombre: string } | null) {
  try { s ? localStorage.setItem(LLAVE, JSON.stringify(s)) : localStorage.removeItem(LLAVE); } catch { /* sin almacenamiento */ }
}

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  const s = sesion();
  const r = await fetch(`/api${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(s && { Authorization: `Bearer ${s.token}` }),
    },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  });
  if (r.status === 401 && s) {
    guardarSesion(null);
    location.reload();
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (datos as any).message;
    throw new Error(Array.isArray(m) ? m.join('. ') : m ?? `Error ${r.status}`);
  }
  return datos as T;
}

export const NOMBRE_PRODUCTO: Record<Producto, string> = { VENTAS: 'Sistema de ventas', LAVADERO: 'App lavadero' };

export function fecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface Ajustes {
  sunatModo: 'DESACTIVADO' | 'BETA' | 'PRODUCCION';
  solUsuario: string | null; solConfigurada: boolean;
  certificado: { sujeto: string | null; venceEl: string | null } | null;
  consultaDocConfigurado: boolean; backupHora: string; backupConservar: number;
}
export interface Respaldo { id: number; ok: boolean; motivo: string; nombre: string | null; bytes: number | null; error: string | null; disponible: boolean; creadoEl: string }

/** Descarga un archivo de la API con la sesión del superadmin. */
export async function descargar(ruta: string, nombre: string) {
  const s = sesion();
  const r = await fetch(`/api${ruta}`, { headers: s ? { Authorization: `Bearer ${s.token}` } : {} });
  if (!r.ok) throw new Error('No se pudo descargar el archivo');
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
  URL.revokeObjectURL(url);
}

export function tamano(bytes: number | null) {
  if (bytes == null) return '';
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
