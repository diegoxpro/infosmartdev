import { BadRequestException } from '@nestjs/common';
import { exigirLotes, juntarLotes, normalizarLotes, sumaLotes } from './lotes-inventario';

describe('lotes del inventario', () => {
  it('junta fechas repetidas, quita ceros y ordena', () => {
    expect(normalizarLotes([{ fecha: '2027-01-20', cantidad: 6 }, { fecha: '2026-12-15', cantidad: 4 }, { fecha: '2026-12-15', cantidad: 6 }, { fecha: '2027-03-01', cantidad: 0 }])).toEqual([
      { fecha: '2026-12-15', cantidad: 10 },
      { fecha: '2027-01-20', cantidad: 6 },
    ]);
  });

  it('sumar dos conteos junta sus lotes', () => {
    const r = juntarLotes([{ fecha: '2026-12-15', cantidad: 10 }], [{ fecha: '2026-12-15', cantidad: 2 }, { fecha: '2027-03-01', cantidad: 4 }]);
    expect(r).toEqual([{ fecha: '2026-12-15', cantidad: 12 }, { fecha: '2027-03-01', cantidad: 4 }]);
    expect(sumaLotes(r)).toBe(16);
  });

  it('exige fechas si el producto controla vencimiento y que la suma cuadre', () => {
    expect(() => exigirLotes(5, [], true)).toThrow(BadRequestException);
    expect(() => exigirLotes(0, [], true)).not.toThrow();
    expect(() => exigirLotes(5, [], false)).not.toThrow();
    expect(() => exigirLotes(5, [{ fecha: '2026-12-15', cantidad: 4 }], false)).toThrow(/no coincide/);
    expect(() => exigirLotes(5, [{ fecha: '2026-12-15', cantidad: 5 }], true)).not.toThrow();
  });
});
