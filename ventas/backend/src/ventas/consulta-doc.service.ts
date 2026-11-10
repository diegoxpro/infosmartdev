import { Injectable, Logger } from '@nestjs/common';
import { ConfiguracionService } from '../configuracion/configuracion.service';

/** Datos que el formulario de cliente puede autollenar. */
export interface DatosDocumento {
  tipoDoc: 'DNI' | 'RUC';
  numeroDoc: string;
  nombre: string;
  direccion?: string | null;
  /** Solo RUC: ACTIVO / BAJA..., HABIDO / NO HABIDO. */
  estado?: string | null;
  condicion?: string | null;
}

export type ResultadoConsulta =
  | { fuente: 'externa'; datos: DatosDocumento }
  /** Sin datos: el formulario queda para llenarlo a mano. `motivo` se muestra tal cual. */
  | { fuente: null; motivo: 'sin_token' | 'sin_internet' | 'no_encontrado' | 'error'; mensaje: string };

const BASE = 'https://api.decolecta.com/v1';
const ESPERA_MS = 6000;

/**
 * Consulta DNI (RENIEC) y RUC (SUNAT) en Decolecta (antes apis.net.pe), con el token puesto en Configuración.
 * Nunca lanza: si no hay token, internet o datos, responde el motivo para que la venta siga con el nombre a mano.
 */
@Injectable()
export class ConsultaDocService {
  private readonly log = new Logger(ConsultaDocService.name);

  constructor(private readonly config: ConfiguracionService) {}

  async consultar(tipo: 'DNI' | 'RUC', numero: string): Promise<ResultadoConsulta> {
    const token = (await this.config.obtener()).consultaDocToken;
    if (!token) {
      return { fuente: null, motivo: 'sin_token', mensaje: 'La consulta en línea no está configurada. Escribe el nombre a mano.' };
    }
    const url = `${BASE}/${tipo === 'DNI' ? 'reniec/dni' : 'sunat/ruc'}?numero=${numero}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_MS),
      });
    } catch (e) {
      this.log.warn(`Consulta ${tipo} sin conexión: ${(e as Error).message}`);
      return { fuente: null, motivo: 'sin_internet', mensaje: 'Sin conexión con el servicio de consulta. Escribe el nombre a mano.' };
    }
    const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && cuerpo) {
      const datos = tipo === 'DNI' ? deDni(numero, cuerpo) : deRuc(numero, cuerpo);
      if (datos) return { fuente: 'externa', datos };
    }
    if (res.status === 401 || res.status === 403) {
      return { fuente: null, motivo: 'error', mensaje: 'El servicio rechazó el token de consulta. Revísalo en Configuración.' };
    }
    if (res.status === 429) {
      return { fuente: null, motivo: 'error', mensaje: 'Se acabaron las consultas del plan este mes. Escribe el nombre a mano.' };
    }
    if (res.ok || res.status === 404 || res.status === 422 || res.status === 400) {
      return { fuente: null, motivo: 'no_encontrado', mensaje: `No se encontró el ${tipo} ${numero}. Revisa el número o escribe el nombre a mano.` };
    }
    this.log.warn(`Consulta ${tipo} respondió ${res.status}`);
    return { fuente: null, motivo: 'error', mensaje: `El servicio de consulta falló (${res.status}). Escribe el nombre a mano.` };
  }
}

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function deDni(numero: string, j: Record<string, unknown>): DatosDocumento | null {
  // "full_name" viene como APELLIDOS NOMBRES; se arma Nombres Apellidos como en la boleta.
  const armado = [txt(j.first_name), txt(j.first_last_name), txt(j.second_last_name)].filter(Boolean).join(' ');
  const nombre = armado || txt(j.full_name);
  return nombre ? { tipoDoc: 'DNI', numeroDoc: numero, nombre: nombre.toUpperCase() } : null;
}

export function deRuc(numero: string, j: Record<string, unknown>): DatosDocumento | null {
  const nombre = txt(j.razon_social);
  if (!nombre) return null;
  const dir = txt(j.direccion);
  const lugar = [txt(j.distrito), txt(j.provincia), txt(j.departamento)].filter(Boolean).join(' - ');
  const direccion = dir && dir !== '-' ? (lugar && !dir.includes(txt(j.distrito)) ? `${dir}, ${lugar}` : dir) : null;
  return {
    tipoDoc: 'RUC',
    numeroDoc: numero,
    nombre: nombre.toUpperCase(),
    direccion,
    estado: txt(j.estado) || null,
    condicion: txt(j.condicion) || null,
  };
}
