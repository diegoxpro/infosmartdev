process.env.JWT_SECRETO = 'x';
process.env.CLAVE_INTERNA = 'x';
process.env.CLAVE_CIFRADO = 'x';
process.env.DATABASE_URL = 'postgresql://u:c@db:5432/infosmart_panel?schema=public';
import { horaProgramada, urlDeBase } from './respaldos.service';

describe('respaldos', () => {
  it('calcula la hora programada en hora de Lima', () => {
    // 10 nov 2026 15:00 UTC = 10:00 en Lima → el de las 03:00 de Lima fue a las 08:00 UTC
    expect(horaProgramada('03:00', new Date('2026-11-10T15:00:00Z')).toISOString()).toBe('2026-11-10T08:00:00.000Z');
    // 11 nov 02:00 UTC = 10 nov 21:00 en Lima → sigue siendo el día 10 en Lima
    expect(horaProgramada('22:00', new Date('2026-11-11T02:00:00Z')).toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });

  it('arma la URL de la base de cada empresa', () => {
    expect(urlDeBase('ventas_empresa1')).toBe('postgresql://u:c@db:5432/ventas_empresa1');
  });
});
