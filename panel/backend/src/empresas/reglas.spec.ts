import { accesoEmpresa, claveTemporal, nombreBaseDatos, validarRuc, validarSubdominio } from './reglas';

describe('reglas de empresas', () => {
  it('valida subdominios', () => {
    expect(validarSubdominio('empresa1')).toBeNull();
    expect(validarSubdominio('mi-tienda')).toBeNull();
    expect(validarSubdominio('ab')).not.toBeNull();
    expect(validarSubdominio('-tienda')).not.toBeNull();
    expect(validarSubdominio('Tienda')).not.toBeNull();
    expect(validarSubdominio('mi--tienda')).not.toBeNull();
    expect(validarSubdominio('admin')).not.toBeNull();
    expect(validarSubdominio('a.b.c')).not.toBeNull();
  });

  it('valida el dígito verificador del RUC', () => {
    expect(validarRuc('20100070970')).toBeNull();
    expect(validarRuc('20100070971')).not.toBeNull();
    expect(validarRuc('12345678901')).not.toBeNull();
  });

  it('arma nombres de base seguros', () => {
    expect(nombreBaseDatos('VENTAS', 'mi-tienda')).toBe('ventas_mi_tienda');
    expect(nombreBaseDatos('LAVADERO', 'empresa1')).toBe('lavadero_empresa1');
  });

  it('genera claves temporales sin caracteres confusos', () => {
    const clave = claveTemporal();
    expect(clave).toHaveLength(10);
    expect(clave).not.toMatch(/[01lIoO]/);
  });

  it('bloquea empresas suspendidas o vencidas', () => {
    const futuro = new Date(Date.now() + 86400000);
    const pasado = new Date(Date.now() - 1000);
    expect(accesoEmpresa('ACTIVA', futuro).permitido).toBe(true);
    expect(accesoEmpresa('PRUEBA', futuro).permitido).toBe(true);
    expect(accesoEmpresa('SUSPENDIDA', futuro).motivo).toBe('SUSPENDIDA');
    expect(accesoEmpresa('ACTIVA', pasado).motivo).toBe('VENCIDA');
  });
});
