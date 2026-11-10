import forge from 'node-forge';
import { leerPfx } from './certificado';
import { firmarXml, verificarFirma } from './firma';
import { boletaUbl, calcularLineas, Emisor, resumenBajaUbl } from './ubl';

/** Certificado de prueba autofirmado, como el que acepta SUNAT beta. */
function pfxDePrueba(clave: string) {
  const llaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = llaves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nombre = [{ name: 'commonName', value: 'CANDYS PRUEBA' }];
  cert.setSubject(nombre);
  cert.setIssuer(nombre);
  cert.sign(llaves.privateKey);
  const p12 = forge.pkcs12.toPkcs12Asn1(llaves.privateKey, [cert], clave, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const emisor: Emisor = {
  ruc: '10715971963',
  razonSocial: 'DIEGO MARTIN GUEVARA VASQUEZ',
  nombreComercial: "CANDY'S MARKET",
  direccion: 'JR. LOS OLIVOS 130 - URB. LOS JARDINES',
  ubigeo: '220901',
  departamento: 'SAN MARTIN',
  provincia: 'SAN MARTIN',
  distrito: 'TARAPOTO',
  codigoEstablecimiento: '0000',
};

const boleta = {
  serie: 'B001',
  numero: 12126,
  fecha: new Date('2026-10-30T03:10:00Z'),
  cliente: null,
  descuento: 0.5,
  items: [
    { codigo: '7750243068055', descripcion: 'ACEITE CIL 900ML', cantidad: 2, precioUnitario: 9.8, descuento: 0, afectacion: 'EXONERADO' as const },
    { codigo: '7751580000821', descripcion: '7 UP 1.5L & <más>', cantidad: 1, precioUnitario: 6, descuento: 0, afectacion: 'EXONERADO' as const },
  ],
};

describe('facturación electrónica', () => {
  const cert = leerPfx(pfxDePrueba('clave123'), 'clave123');

  it('rechaza una contraseña de certificado incorrecta', () => {
    expect(() => leerPfx(pfxDePrueba('buena'), 'mala')).toThrow('No se pudo abrir el certificado');
  });

  it('reparte el descuento global y cuadra los totales', () => {
    const c = calcularLineas(boleta);
    expect(c.total).toBe(25.1);
    expect(c.op.EXONERADO).toBe(25.1);
    expect(c.lineas.reduce((s, l) => s + l.descuento, 0)).toBeCloseTo(0.5);
  });

  it('separa el IGV de un producto gravado', () => {
    const c = calcularLineas({ ...boleta, descuento: 0, items: [{ ...boleta.items[0], cantidad: 1, precioUnitario: 11.8, afectacion: 'GRAVADO' }] });
    expect(c).toMatchObject({ igv: 1.8, total: 11.8, op: { GRAVADO: 10 } });
  });

  it('genera la boleta UBL 2.1 y la firma de forma verificable', () => {
    const xml = boletaUbl(boleta, emisor);
    expect(xml).toContain('<cbc:ID>B001-12126</cbc:ID>');
    expect(xml).toContain('<cbc:IssueDate>2026-10-29</cbc:IssueDate>'); // hora de Lima
    expect(xml).toContain('VEINTICINCO CON 10/100 SOLES');
    expect(xml).toContain('languageLocaleID="2001"');
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">25.10</cbc:PayableAmount>');
    expect(xml).toContain('<![CDATA[7 UP 1.5L & <más>]]>');

    const firmado = firmarXml(xml, cert);
    expect(firmado.hash).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    expect(firmado.xml).toContain('Id="SignatureSP"');
    expect(verificarFirma(firmado.xml, cert.certificadoPem)).toBe(true);
    // Cualquier cambio después de firmar invalida la firma.
    expect(verificarFirma(firmado.xml.replace('25.10', '15.10'), cert.certificadoPem)).toBe(false);
  });

  it('genera el resumen diario de bajas firmado', () => {
    const xml = resumenBajaUbl('RC-20261030-1', '2026-10-29', '2026-10-30', [
      { serie: 'B001', numero: 12126, cliente: null, total: 25.1, opGravada: 0, opExonerada: 25.1, opInafecta: 0, igv: 0 },
    ], emisor);
    expect(xml).toContain('<cbc:ConditionCode>3</cbc:ConditionCode>');
    expect(xml).toContain('<cbc:InstructionID>02</cbc:InstructionID>');
    const firmado = firmarXml(xml, cert);
    expect(verificarFirma(firmado.xml, cert.certificadoPem)).toBe(true);
  });
});
