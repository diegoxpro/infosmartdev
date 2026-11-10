import type { NextFunction, Request, Response } from 'express';
import { enInquilino, subdominioDe } from './contexto';
import { registro } from './registro';

const MENSAJES = {
  SUSPENDIDA: 'La cuenta de esta empresa está suspendida. Comunícate con Infosmart para reactivarla.',
  VENCIDA: 'La suscripción de esta empresa venció. Comunícate con Infosmart para renovarla.',
};

function responder(req: Request, res: Response, estado: number, titulo: string, mensaje: string) {
  if (req.path.startsWith('/api')) return res.status(estado).json({ statusCode: estado, message: mensaje, infosmart: titulo });
  res.status(estado).type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6f8;color:#16181d}
main{max-width:420px;padding:24px;text-align:center}h1{font-size:22px}@media(prefers-color-scheme:dark){body{background:#111317;color:#eceef2}}</style>
<main><h1>${titulo}</h1><p>${mensaje}</p><p style="opacity:.6">Infosmart</p></main></html>`);
}

/** Atiende cada petición con la empresa de su subdominio. */
export async function middlewareEmpresa(req: Request, res: Response, next: NextFunction) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const sub = subdominioDe(host.split(',')[0]);
  if (!sub) return responder(req, res, 404, 'Empresa no encontrada', 'Entra con la dirección de tu empresa, por ejemplo empresa.infosmart.pe.');
  let inquilino;
  try {
    inquilino = await registro.obtener(sub);
  } catch (e) {
    console.error(`[Empresas] ${sub}: ${(e as Error).message}`);
    return responder(req, res, 503, 'Servicio no disponible', 'No pudimos cargar tu empresa. Inténtalo de nuevo en un momento.');
  }
  if (!inquilino) return responder(req, res, 404, 'Empresa no encontrada', `No existe una empresa con la dirección ${sub}.`);
  const { acceso } = inquilino.info;
  if (!acceso.permitido) return responder(req, res, 403, acceso.motivo === 'VENCIDA' ? 'Suscripción vencida' : 'Cuenta suspendida', MENSAJES[acceso.motivo ?? 'SUSPENDIDA']);
  enInquilino(inquilino, () => next());
}
