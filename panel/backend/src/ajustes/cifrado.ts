import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

// AES-256-GCM con una llave derivada de CLAVE_CIFRADO. Formato: v1.<iv>.<tag>.<datos> en base64url.
const llave = () => createHash('sha256').update(config.claveCifrado).digest();

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), datos].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}

export function descifrar(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  const [v, iv, tag, datos] = guardado.split('.');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64url')), d.final()]).toString('utf8');
}
