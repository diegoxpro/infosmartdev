import { montoEnLetras } from './numero-letras';

describe('montoEnLetras', () => {
  it.each([
    [0.5, 'CERO CON 50/100 SOLES'],
    [1, 'UNO CON 00/100 SOLES'],
    [21.1, 'VEINTIUNO CON 10/100 SOLES'],
    [100, 'CIEN CON 00/100 SOLES'],
    [125.5, 'CIENTO VEINTICINCO CON 50/100 SOLES'],
    [1000, 'MIL CON 00/100 SOLES'],
    [2345.99, 'DOS MIL TRESCIENTOS CUARENTA Y CINCO CON 99/100 SOLES'],
    [1_000_000, 'UN MILLON CON 00/100 SOLES'],
  ])('%s', (n, texto) => expect(montoEnLetras(n)).toBe(texto));
});
