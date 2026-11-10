import { calcularPagos, calcularTotales } from './calculos';

const ex = (cantidad: number, precioUnitario: number, descuento = 0) => ({ cantidad, precioUnitario, descuento, afectacionIgv: 'EXONERADO' as const });

describe('calcularTotales', () => {
  it('suma productos exonerados sin IGV', () => {
    const t = calcularTotales([ex(2, 2.5), ex(1, 6.5)]);
    expect(t).toMatchObject({ subtotal: 11.5, total: 11.5, opExonerada: 11.5, igv: 0 });
  });

  it('aplica descuento por línea y global', () => {
    const t = calcularTotales([ex(3, 2, 0.5), ex(1, 4)], 1);
    expect(t.subtotales).toEqual([5.5, 4]);
    expect(t.total).toBe(8.5);
  });

  it('separa el IGV de los productos gravados', () => {
    const t = calcularTotales([{ cantidad: 1, precioUnitario: 11.8, descuento: 0, afectacionIgv: 'GRAVADO' }, ex(1, 5)]);
    expect(t).toMatchObject({ total: 16.8, opGravada: 10, igv: 1.8, opExonerada: 5 });
  });

  it('rechaza descuentos mayores al importe', () => {
    expect(() => calcularTotales([ex(1, 2)], 3)).toThrow();
  });
});

describe('calcularPagos', () => {
  it('da vuelto del efectivo', () => {
    expect(calcularPagos(13.5, [{ medioPago: 'EFECTIVO', monto: 20 }])).toEqual({ efectivoRecibido: 20, vuelto: 6.5, efectivoAplicado: 13.5 });
  });

  it('acepta pago mixto', () => {
    expect(calcularPagos(30, [{ medioPago: 'YAPE', monto: 20 }, { medioPago: 'EFECTIVO', monto: 10 }]).vuelto).toBe(0);
  });

  it('rechaza pagos incompletos o tarjeta de más', () => {
    expect(() => calcularPagos(30, [{ medioPago: 'EFECTIVO', monto: 20 }])).toThrow('Falta cobrar S/ 10.00');
    expect(() => calcularPagos(30, [{ medioPago: 'TARJETA', monto: 40 }])).toThrow();
  });
});
