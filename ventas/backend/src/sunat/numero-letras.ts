const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const ESPECIALES = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const VEINTES = ['VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function hasta999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [CENTENAS[c]];
  if (r < 10) partes.push(UNIDADES[r]);
  else if (r < 20) partes.push(ESPECIALES[r - 10]);
  else if (r < 30) partes.push(VEINTES[r - 20]);
  else partes.push(DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : ''));
  return partes.filter(Boolean).join(' ');
}

function entero(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLON' : `${hasta999(millones)} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${hasta999(miles)} MIL`);
  if (resto) partes.push(hasta999(resto));
  return partes.join(' ');
}

/** 125.5 → "CIENTO VEINTICINCO CON 50/100 SOLES" (leyenda 1000 de SUNAT). */
export function montoEnLetras(monto: number): string {
  const centimos = Math.round(monto * 100);
  const soles = Math.floor(centimos / 100);
  return `${entero(soles)} CON ${String(centimos % 100).padStart(2, '0')}/100 SOLES`;
}
