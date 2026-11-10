import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

// SUNAT_URL permite apuntar a un servidor simulado en pruebas.
export const ENDPOINTS = {
  BETA: process.env.SUNAT_URL ?? 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  PRODUCCION: process.env.SUNAT_URL ?? 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
} as const;

export interface Credenciales {
  url: string;
  /** RUC + usuario SOL (en beta: RUC + MODDATOS). */
  usuario: string;
  clave: string;
}

export interface Cdr {
  codigo: string;
  descripcion: string;
  observaciones: string[];
}

/** Error que devolvió SUNAT (no un problema de conexión). */
export class ErrorSunat extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
  /** 2000-3999: comprobante rechazado. Otros: error del servicio o de autenticación. */
  get rechazo() {
    const n = Number(this.codigo);
    return n >= 2000 && n < 4000;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function comprimir(nombre: string, xml: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${nombre}.xml`, Buffer.from(xml, 'utf-8'));
  return zip.toBuffer();
}

function sobre(c: Credenciales, cuerpo: string) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
<soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>${esc(c.usuario)}</wsse:Username><wsse:Password>${esc(c.clave)}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>
<soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;
}

const texto = (doc: Document, tag: string) => {
  const n = doc.getElementsByTagName(tag)[0] ?? doc.getElementsByTagNameNS('*', tag)[0];
  return n?.textContent?.trim() ?? '';
};

async function llamar(c: Credenciales, accion: string, cuerpo: string): Promise<Document> {
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `urn:${accion}` },
    body: sobre(c, cuerpo),
    signal: AbortSignal.timeout(60_000),
  });
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  const falla = texto(doc, 'faultstring');
  if (falla || !res.ok) {
    // El código viene como "soap-env:Client.2335" o en el mensaje.
    const codigo = (texto(doc, 'faultcode').match(/(\d{3,4})/) ?? falla.match(/(\d{4})/))?.[1] ?? String(res.status);
    throw new ErrorSunat(codigo, falla || `HTTP ${res.status}`);
  }
  return doc;
}

export function leerCdr(zipBase64: string): Cdr {
  const zip = new AdmZip(Buffer.from(zipBase64, 'base64'));
  const entrada = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.xml'));
  if (!entrada) throw new Error('La constancia (CDR) de SUNAT vino vacía');
  const doc = new DOMParser().parseFromString(entrada.getData().toString('utf-8'), 'text/xml') as unknown as Document;
  const notas = Array.from(doc.getElementsByTagNameNS('*', 'Note')).map((n) => n.textContent?.trim() ?? '');
  return { codigo: texto(doc, 'ResponseCode'), descripcion: texto(doc, 'Description'), observaciones: notas.filter(Boolean) };
}

/** Envía un comprobante y devuelve su CDR (respuesta inmediata). */
export async function sendBill(c: Credenciales, nombre: string, xml: string): Promise<Cdr> {
  const doc = await llamar(
    c,
    'sendBill',
    `<ser:sendBill><fileName>${nombre}.zip</fileName><contentFile>${comprimir(nombre, xml).toString('base64')}</contentFile></ser:sendBill>`,
  );
  return leerCdr(texto(doc, 'applicationResponse'));
}

/** Envía un resumen diario; SUNAT responde con un ticket para consultar luego. */
export async function sendSummary(c: Credenciales, nombre: string, xml: string): Promise<string> {
  const doc = await llamar(
    c,
    'sendSummary',
    `<ser:sendSummary><fileName>${nombre}.zip</fileName><contentFile>${comprimir(nombre, xml).toString('base64')}</contentFile></ser:sendSummary>`,
  );
  return texto(doc, 'ticket');
}

/** Estado de un ticket: 0 procesado, 98 en proceso, 99 con errores. */
export async function getStatus(c: Credenciales, ticket: string): Promise<{ estado: string; cdr: Cdr | null }> {
  const doc = await llamar(c, 'getStatus', `<ser:getStatus><ticket>${esc(ticket)}</ticket></ser:getStatus>`);
  const estado = texto(doc, 'statusCode');
  const contenido = texto(doc, 'content');
  return { estado, cdr: contenido && estado !== '98' ? leerCdr(contenido) : null };
}
