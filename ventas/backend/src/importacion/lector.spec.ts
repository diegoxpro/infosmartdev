import ExcelJS from 'exceljs';
import { fecha, leerArchivo, numero, siNo, texto } from './lector';

describe('lector de Excel de productos', () => {
  it('reconoce los títulos sin importar tildes, orden ni filas previas', async () => {
    const libro = new ExcelJS.Workbook();
    const h = libro.addWorksheet('Hoja1');
    h.addRow(['MI TIENDA']);
    h.addRow([]);
    h.addRow(['Producto', 'Cod. Barra', 'Notas', 'Precio', 'Stock', 'Otra cosa']);
    h.addRow(['Gaseosa', 7751731002971, 'x', 2.5, 12, 'y']);
    h.addRow([]);
    h.addRow(['Galleta', null, null, '0,70', null, null]);
    const pres = libro.addWorksheet('Presentaciones');
    pres.addRow(['Código del producto', 'Presentación', 'Unidades que trae', 'Código de barras', 'Precio 1']);
    pres.addRow(['7751731002971', 'Paquete x6', 6, '123', 14]);
    const r = await leerArchivo(Buffer.from(await libro.xlsx.writeBuffer()), 'p.xlsx');
    expect(r.productos).toHaveLength(2);
    expect(r.productos[0]).toEqual({ fila: 4, datos: expect.objectContaining({ nombre: 'Gaseosa', codigo: 7751731002971, precio1: 2.5, stock: 12 }) });
    expect(r.productos[1].fila).toBe(6);
    expect(r.ignoradas).toEqual(['Notas', 'Otra cosa']);
    expect(r.presentaciones[0].datos).toMatchObject({ productoCodigo: '7751731002971', nombre: 'Paquete x6', factor: 6, codigo: '123', precio1: 14 });
  });

  it('lee CSV con punto y coma', async () => {
    const r = await leerArchivo(Buffer.from('﻿Código;Nombre;Precio 1\n775;Arroz;4,20\n'), 'a.csv');
    expect(r.productos[0].datos).toEqual({ codigo: '775', nombre: 'Arroz', precio1: '4,20' });
  });

  it('avisa si no encuentra los títulos', async () => {
    await expect(leerArchivo(Buffer.from('a,b\n1,2\n'), 'a.csv')).rejects.toThrow('fila de títulos');
  });

  it('convierte valores', () => {
    expect(texto(7751731002971)).toBe('7751731002971');
    expect(numero('S/ 1,234.50')).toBe(1234.5);
    expect(numero('2,50')).toBe(2.5);
    expect(numero('abc')).toBeUndefined();
    expect(numero('')).toBeNull();
    expect(siNo('Sí')).toBe(true);
    expect(siNo('no')).toBe(false);
    expect(siNo('quizá')).toBeUndefined();
    expect(fecha('31/03/2027')).toEqual(new Date(Date.UTC(2027, 2, 31)));
    expect(fecha('2027-03-31')).toEqual(new Date(Date.UTC(2027, 2, 31)));
    expect(fecha('31/02/2027')).toBeUndefined();
    expect(fecha(46477)).toEqual(new Date(Date.UTC(2027, 2, 31)));
  });
});
