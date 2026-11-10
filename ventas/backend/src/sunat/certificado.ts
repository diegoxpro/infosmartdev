import forge from 'node-forge';

export interface Certificado {
  clavePrivadaPem: string;
  certificadoPem: string;
  sujeto: string;
  emisor: string;
  venceEl: Date;
}

/** Lee un certificado .pfx/.p12 con su contraseña. */
export function leerPfx(pfx: Buffer, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), clave);
  } catch {
    throw new Error('No se pudo abrir el certificado: revisa la contraseña o el archivo');
  }
  const llaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const llave = llaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  // El certificado del titular es el que comparte el módulo con la llave privada.
  const cert = certs.map((b) => b.cert!).find((c) => llave && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(llave.n)) ?? certs[0]?.cert;
  if (!llave || !cert) throw new Error('El archivo no contiene una llave privada y su certificado');
  const nombre = (attrs: forge.pki.CertificateField[]) => attrs.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ');
  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(llave),
    certificadoPem: forge.pki.certificateToPem(cert),
    sujeto: nombre(cert.subject.attributes),
    emisor: nombre(cert.issuer.attributes),
    venceEl: cert.validity.notAfter,
  };
}
