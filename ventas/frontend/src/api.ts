const CLAVE_TOKEN = 'candys.token';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const sesion = {
  token: () => localStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => localStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

export async function api<T = unknown>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = sesion.token();
  const res = await fetch(`/api${ruta}`, {
    method: opciones.method ?? (opciones.body ? 'POST' : 'GET'),
    headers: {
      ...(opciones.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  if (res.status === 401 && token) {
    sesion.borrar();
    window.location.assign('/login');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(msg ?? 'No se pudo completar la operación', res.status);
  }
  return data as T;
}

/** Arma ?a=1&b=2 omitiendo valores vacíos. */
export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}

/** Descarga un archivo de la API (con la sesión) y lo guarda con ese nombre. */
export async function descargar(ruta: string, nombre: string) {
  const res = await fetch(`/api${ruta}`, { headers: { authorization: `Bearer ${sesion.token()}` } });
  if (!res.ok) throw new ApiError('No se pudo descargar el archivo', res.status);
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
  URL.revokeObjectURL(url);
}
