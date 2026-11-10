import { deDni, deRuc } from './consulta-doc.service';

describe('consulta DNI/RUC', () => {
  it('arma el nombre del DNI como nombres y apellidos', () => {
    expect(deDni('46027897', { first_name: 'ROXANA KARINA', first_last_name: 'DELGADO', second_last_name: 'HUAMANI', full_name: 'DELGADO HUAMANI ROXANA KARINA' }))
      .toEqual({ tipoDoc: 'DNI', numeroDoc: '46027897', nombre: 'ROXANA KARINA DELGADO HUAMANI' });
    expect(deDni('1', {})).toBeNull();
  });

  it('toma razón social, dirección y estado del RUC', () => {
    const d = deRuc('20601030013', { razon_social: 'Rexticorp S.A.C.', direccion: 'AV. GRAU 123', distrito: 'TARAPOTO', provincia: 'SAN MARTIN', departamento: 'SAN MARTIN', estado: 'ACTIVO', condicion: 'HABIDO' });
    expect(d).toMatchObject({ nombre: 'REXTICORP S.A.C.', direccion: 'AV. GRAU 123, TARAPOTO - SAN MARTIN - SAN MARTIN', estado: 'ACTIVO', condicion: 'HABIDO' });
    expect(deRuc('1', { razon_social: 'X', direccion: '-' })?.direccion).toBeNull();
  });
});
