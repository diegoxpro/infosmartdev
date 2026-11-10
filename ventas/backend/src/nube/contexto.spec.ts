import { PorEmpresa, enInquilino, subdominioDe, urlPublica } from './contexto';

describe('modo nube', () => {
  it('saca el subdominio del host', () => {
    expect(subdominioDe('empresa1.infosmart.pe', 'infosmart.pe')).toBe('empresa1');
    expect(subdominioDe('Mi-Tienda.infosmart.pe:443', 'infosmart.pe')).toBe('mi-tienda');
    expect(subdominioDe('empresa1.190.119.59.24.nip.io:8092', '190.119.59.24.nip.io')).toBe('empresa1');
    expect(subdominioDe('infosmart.pe', 'infosmart.pe')).toBeNull();
    expect(subdominioDe('a.b.infosmart.pe', 'infosmart.pe')).toBeNull();
    expect(subdominioDe('empresa1.otro.pe', 'infosmart.pe')).toBeNull();
  });

  it('separa el estado en memoria por empresa', async () => {
    const contador = new PorEmpresa(() => ({ n: 0 }));
    const falsa = (subdominio: string) => ({ subdominio, info: {} as never, cliente: {} as never });
    enInquilino(falsa('a'), () => (contador.actual.n += 2));
    enInquilino(falsa('b'), () => (contador.actual.n += 5));
    await enInquilino(falsa('a'), async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(contador.actual.n).toBe(2);
    });
    expect(contador.actual.n).toBe(0); // fuera de toda empresa
  });

  it('arma la URL pública de la empresa', () => {
    process.env.URL_PUBLICA = 'http://{sub}.1.2.3.4.nip.io:8092';
    expect(enInquilino({ subdominio: 'x1', info: {} as never, cliente: {} as never }, () => urlPublica('/i/abc'))).toBe('http://x1.1.2.3.4.nip.io:8092/i/abc');
    delete process.env.URL_PUBLICA;
  });
});
