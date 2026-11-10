import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { BadRequestException } from '@nestjs/common';
import { join, resolve } from 'path';
import { inquilinoActual, NUBE } from '../nube/contexto';

const DEL_PANEL = 'El certificado y la clave SOL se administran desde el panel Infosmart';

/** En la nube el certificado y las claves llegan del panel Infosmart con la ficha de la empresa. */
function ajustesNube() {
  const i = inquilinoActual();
  if (!i) throw new Error('Sin empresa');
  return i.info.ajustes;
}

/**
 * Certificado y claves SOL viven en archivos locales, fuera de la base de
 * datos: así no viajan en los backups de Google Drive ni en el repositorio.
 */
export const CARPETA_SECRETOS = resolve(process.env.SECRETOS_DIR ?? join(process.cwd(), 'secretos'));
const ARCHIVO_CERT = join(CARPETA_SECRETOS, 'certificado.pfx');
const ARCHIVO_CLAVES = join(CARPETA_SECRETOS, 'sunat.json');

export interface ClavesSunat {
  certificadoClave?: string;
  solUsuario?: string;
  solClave?: string;
}

async function guardar(archivo: string, datos: Buffer | string) {
  await mkdir(CARPETA_SECRETOS, { recursive: true, mode: 0o700 });
  await writeFile(archivo, datos, { mode: 0o600 });
  await chmod(archivo, 0o600).catch(() => undefined);
}

export async function leerClaves(): Promise<ClavesSunat> {
  if (NUBE) {
    const a = ajustesNube();
    return { certificadoClave: a.certificadoClave ?? undefined, solUsuario: a.solUsuario ?? undefined, solClave: a.solClave ?? undefined };
  }
  try {
    return JSON.parse(await readFile(ARCHIVO_CLAVES, 'utf-8'));
  } catch {
    return {};
  }
}

export async function guardarClaves(cambios: ClavesSunat) {
  if (NUBE) throw new BadRequestException(DEL_PANEL);
  const actual = await leerClaves();
  // Un campo vacío no borra la clave guardada.
  const limpio = Object.fromEntries(Object.entries(cambios).filter(([, v]) => typeof v === 'string' && v.length > 0));
  await guardar(ARCHIVO_CLAVES, JSON.stringify({ ...actual, ...limpio }, null, 2));
}

export async function leerCertificado(): Promise<Buffer | null> {
  if (NUBE) {
    const pfx = ajustesNube().certificado;
    return pfx ? Buffer.from(pfx, 'base64') : null;
  }
  try {
    return await readFile(ARCHIVO_CERT);
  } catch {
    return null;
  }
}

export const guardarCertificado = async (pfx: Buffer) => {
  if (NUBE) throw new BadRequestException(DEL_PANEL);
  return guardar(ARCHIVO_CERT, pfx);
};
