import type { InfoEmpresa } from './contexto';

/** Cliente de la API interna del panel Infosmart. */
const base = () => (process.env.PANEL_URL ?? '').replace(/\/$/, '') + '/api/interno';
const cabeceras = () => ({ 'x-infosmart-clave': process.env.CLAVE_INTERNA ?? '', 'content-type': 'application/json' });
const PRODUCTO = 'VENTAS';

async function llamar(ruta: string, init: RequestInit = {}) {
  const res = await fetch(base() + ruta, { ...init, headers: cabeceras(), signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Panel Infosmart respondió ${res.status} en ${ruta}`);
  return res.json();
}

export const panel = {
  empresa: (sub: string) => llamar(`/empresas/${encodeURIComponent(sub)}/${PRODUCTO}`) as Promise<InfoEmpresa | null>,

  /** Subdominios de las empresas con este producto que pueden entrar hoy. */
  async empresasActivas(): Promise<string[]> {
    const r = (await llamar(`/productos/${PRODUCTO}/empresas`)) as { subdominio: string }[] | null;
    return (r ?? []).map((e) => e.subdominio);
  },

  reportar: (sub: string, datos: { aprovisionado?: boolean; claveCambiada?: boolean }) =>
    llamar(`/empresas/${encodeURIComponent(sub)}/${PRODUCTO}/reporte`, { method: 'POST', body: JSON.stringify(datos) }),

  pedirRespaldo: (sub: string, motivo: string) =>
    llamar(`/empresas/${encodeURIComponent(sub)}/${PRODUCTO}/respaldar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
};
