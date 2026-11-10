import * as forge from 'node-forge';

/** Valida un .pfx/.p12 con su contraseña y devuelve a quién pertenece y cuándo vence. */
export function leerPfx(pfx: Buffer, clave: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), clave);
  } catch {
    throw new Error('No se pudo abrir el certificado: revisa el archivo y su contraseña');
  }
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const llaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const cert = certs.find((b) => b.cert)?.cert;
  if (!cert || !llaves.some((b) => b.key)) throw new Error('El archivo no tiene un certificado con su llave privada');
  const campo = (n: string) => cert.subject.getField(n)?.value as string | undefined;
  return { sujeto: campo('CN') ?? campo('O') ?? 'Sin nombre', venceEl: cert.validity.notAfter };
}
