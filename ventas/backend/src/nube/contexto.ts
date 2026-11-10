import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaClient } from '@prisma/client';

/**
 * Modo nube (Infosmart): una sola instalación atiende a muchas empresas.
 * Cada petición llega por el subdominio de la empresa (empresa1.infosmart.pe),
 * se busca en el panel Infosmart y se atiende con la base de datos de esa empresa.
 * Sin PANEL_URL el sistema funciona como siempre, con una sola base (DATABASE_URL).
 */
export const NUBE = !!process.env.PANEL_URL;

export type ModoSunatNube = 'DESACTIVADO' | 'BETA' | 'PRODUCCION';

/** Lo que el panel controla de cada empresa: no se edita desde el sistema de ventas. */
export interface AjustesNube {
  sunatModo: ModoSunatNube;
  solUsuario: string | null;
  solClave: string | null;
  /** .pfx en base64 */
  certificado: string | null;
  certificadoClave: string | null;
  consultaDocToken: string | null;
}

export interface InfoEmpresa {
  empresa: { id: number; razonSocial: string; ruc: string; subdominio: string; estado: string; venceEl: string };
  plan: { codigo: string; maxUsuarios: number };
  acceso: { permitido: boolean; motivo: 'SUSPENDIDA' | 'VENCIDA' | null };
  baseDatos: string;
  aprovisionado: boolean;
  admin: { usuario: string; claveHash: string; claveTemporal: boolean };
  ajustes: AjustesNube;
}

export interface Inquilino {
  subdominio: string;
  info: InfoEmpresa;
  cliente: PrismaClient;
}

const almacen = new AsyncLocalStorage<Inquilino>();

export const inquilinoActual = () => almacen.getStore();

export function enInquilino<T>(inquilino: Inquilino, fn: () => T): T {
  return almacen.run(inquilino, fn);
}

/** Clave para guardar estado en memoria por empresa ('local' fuera de la nube). */
export const claveEmpresa = () => inquilinoActual()?.subdominio ?? 'local';

/** Mapa en memoria separado por empresa: cachés y colas que antes eran de una sola tienda. */
export class PorEmpresa<T> {
  private datos = new Map<string, T>();
  constructor(private readonly crear: () => T) {}
  get actual(): T {
    const k = claveEmpresa();
    let v = this.datos.get(k);
    if (v === undefined) this.datos.set(k, (v = this.crear()));
    return v;
  }
}

/** empresa1.infosmart.pe → empresa1. Devuelve null si el host no es de una empresa. */
export function subdominioDe(host: string, dominioBase = process.env.DOMINIO_BASE ?? 'infosmart.pe'): string | null {
  const h = host.split(':')[0].trim().toLowerCase().replace(/\.$/, '');
  const base = dominioBase.toLowerCase();
  if (!h.endsWith(`.${base}`)) return null;
  const sub = h.slice(0, -(base.length + 1));
  return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(sub) ? sub : null;
}

/** Dirección pública de la empresa actual (para el QR del inventario). */
export function urlPublica(ruta = '') {
  const i = inquilinoActual();
  const plantilla = process.env.URL_PUBLICA ?? 'https://{sub}.' + (process.env.DOMINIO_BASE ?? 'infosmart.pe');
  return plantilla.replace('{sub}', i?.subdominio ?? 'empresa') + ruta;
}
