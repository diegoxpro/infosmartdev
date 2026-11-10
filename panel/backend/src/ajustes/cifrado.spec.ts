process.env.JWT_SECRETO = 'x';
process.env.CLAVE_INTERNA = 'x';
process.env.CLAVE_CIFRADO = 'una clave de prueba';
process.env.DATABASE_URL = 'postgresql://u:c@db:5432/p';
import { cifrar, descifrar } from './cifrado';

describe('cifrado', () => {
  it('cifra y descifra', () => {
    const c = cifrar('clave SOL ñ');
    expect(c).not.toContain('clave');
    expect(c).not.toBe(cifrar('clave SOL ñ'));
    expect(descifrar(c)).toBe('clave SOL ñ');
    expect(descifrar(null)).toBeNull();
  });

  it('rechaza datos alterados', () => {
    const [v, iv, tag, datos] = cifrar('hola').split('.');
    const alterado = [v, iv, tag, Buffer.from('chau').toString('base64url')].join('.');
    expect(() => descifrar(alterado)).toThrow();
  });
});
