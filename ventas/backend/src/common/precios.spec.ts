import { margenReal, precioSugerido } from './precios';

describe('precioSugerido', () => {
  it('aplica el margen y redondea hacia arriba a 0.10', () => {
    expect(precioSugerido(2, 25)).toBe(2.5);
    expect(precioSugerido(2.13, 25)).toBe(2.7);
    expect(precioSugerido(10, 0)).toBe(10);
  });

  it('respeta otros pasos de redondeo', () => {
    expect(precioSugerido(3.33, 20, 0.5)).toBe(4);
    expect(precioSugerido(3.33, 20, 0)).toBe(4);
  });
});

describe('margenReal', () => {
  it('calcula el porcentaje sobre el costo', () => {
    expect(margenReal(4, 5)).toBe(25);
    expect(margenReal(0, 5)).toBeNull();
  });
});
