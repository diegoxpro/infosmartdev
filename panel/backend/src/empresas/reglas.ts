import { randomInt } from 'crypto';
import { EstadoEmpresa, Producto } from '@prisma/client';

export const SUBDOMINIOS_RESERVADOS = new Set([
  'admin', 'panel', 'api', 'www', 'mail', 'correo', 'app', 'soporte', 'infosmart', 'demo', 'static',
  // Nombres que en ciardi.lat ya usan otros servicios (túneles de Cloudflare): un registro con nombre
  // propio gana al comodín, así que una empresa con ese subdominio nunca llegaría a Infosmart.
  ...(process.env.SUBDOMINIOS_OCUPADOS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
]);

// empresa1, mi-tienda: minúsculas, números y guiones; 3 a 30 caracteres, sin guion al inicio o al final
const PATRON_SUBDOMINIO = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export function validarSubdominio(sub: string): string | null {
  if (!PATRON_SUBDOMINIO.test(sub)) {
    return 'El subdominio debe tener de 3 a 30 letras minúsculas, números o guiones, sin guion al inicio ni al final';
  }
  if (sub.includes('--')) return 'El subdominio no puede tener dos guiones seguidos';
  if (SUBDOMINIOS_RESERVADOS.has(sub)) return `El subdominio "${sub}" está reservado`;
  return null;
}

export function validarRuc(ruc: string): string | null {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return 'El RUC debe tener 11 dígitos y empezar con 10, 15, 17 o 20';
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const digito = (11 - (suma % 11)) % 10;
  if (digito !== Number(ruc[10])) return 'El RUC no es válido (dígito verificador)';
  return null;
}

// Nombre de la base de datos de un producto de una empresa. Solo usa caracteres seguros
// porque se interpola en CREATE DATABASE.
export function nombreBaseDatos(producto: Producto, sub: string): string {
  const nombre = `${producto.toLowerCase()}_${sub.replace(/-/g, '_')}`;
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(nombre)) throw new Error(`Nombre de base inválido: ${nombre}`);
  return nombre;
}

// Clave temporal fácil de dictar por teléfono: sin 0/O ni 1/l/I
export function claveTemporal(largo = 10): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let clave = '';
  for (let i = 0; i < largo; i++) clave += letras[randomInt(letras.length)];
  return clave;
}

// Si la empresa puede usar el sistema ahora mismo y, si no, por qué
export function accesoEmpresa(estado: EstadoEmpresa, venceEl: Date, ahora = new Date()) {
  if (estado === 'SUSPENDIDA') return { permitido: false, motivo: 'SUSPENDIDA' as const };
  if (venceEl.getTime() < ahora.getTime()) return { permitido: false, motivo: 'VENCIDA' as const };
  return { permitido: true, motivo: null };
}
