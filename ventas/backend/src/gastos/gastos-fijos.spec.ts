import { fechaPago, pendientesGastoFijo } from './gastos-fijos';

const d = (anio: number, mes: number, dia: number) => ({ anio, mes, dia });

describe('gastos fijos', () => {
  it('usa el último día en meses cortos', () => {
    expect(fechaPago(2026, 2, 31).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(fechaPago(2026, 11, 31).toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('avisa 3 días antes, el mismo día y cuando ya venció', () => {
    const creado = d(2026, 1, 1);
    const est = (hoy: number) => pendientesGastoFijo(15, d(2026, 11, hoy), new Set(['2026-10']), creado).at(-1)!.estado;
    expect(est(10)).toBe('PENDIENTE');
    expect(est(12)).toBe('PROXIMO');
    expect(est(15)).toBe('HOY');
    expect(est(16)).toBe('VENCIDO');
  });

  it('marca pagado el mes ya pagado', () => {
    const r = pendientesGastoFijo(5, d(2026, 11, 20), new Set(['2026-10', '2026-11']), d(2026, 1, 1));
    expect(r).toEqual([expect.objectContaining({ periodo: '2026-11', estado: 'PAGADO' })]);
  });

  it('recuerda el mes anterior sin pagar, en enero mira diciembre', () => {
    const r = pendientesGastoFijo(28, d(2027, 1, 3), new Set(), d(2026, 6, 1));
    expect(r.map((x) => [x.periodo, x.estado])).toEqual([['2026-12', 'VENCIDO'], ['2027-01', 'PENDIENTE']]);
  });

  it('no pide meses anteriores a su creación', () => {
    const r = pendientesGastoFijo(5, d(2026, 11, 2), new Set(), d(2026, 11, 1));
    expect(r.map((x) => x.periodo)).toEqual(['2026-11']);
  });

  it('creado después del día de pago: empieza el mes siguiente', () => {
    expect(pendientesGastoFijo(5, d(2026, 11, 8), new Set(), d(2026, 11, 8))).toEqual([]);
    const dic = pendientesGastoFijo(5, d(2026, 12, 3), new Set(), d(2026, 11, 8));
    expect(dic.map((x) => [x.periodo, x.estado])).toEqual([['2026-12', 'PROXIMO']]);
  });
});
