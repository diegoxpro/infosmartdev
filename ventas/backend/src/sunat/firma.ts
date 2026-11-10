import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { Certificado } from './certificado';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * Firma el comprobante como pide SUNAT: firma XMLDSig envuelta (RSA-SHA1)
 * dentro de ext:ExtensionContent, con Id="SignatureSP". Devuelve el XML
 * firmado y el DigestValue, que es el "código hash" del ticket y del QR.
 */
export function firmarXml(xml: string, cert: Certificado): { xml: string; hash: string } {
  const sig = new SignedXml({
    privateKey: cert.clavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: '/*',
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    isEmptyUri: true,
  });
  sig.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignatureSP' },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  });
  const firmado = sig.getSignedXml();
  return { xml: firmado, hash: leerHash(firmado) };
}

export function leerHash(xmlFirmado: string): string {
  const doc = new DOMParser().parseFromString(xmlFirmado, 'text/xml');
  const nodo = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'DigestValue')[0];
  return nodo?.textContent ?? '';
}

/** Verifica la firma (para pruebas y diagnóstico). */
export function verificarFirma(xmlFirmado: string, certificadoPem: string): boolean {
  const doc = new DOMParser().parseFromString(xmlFirmado, 'text/xml');
  const firma = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const sig = new SignedXml({ publicCert: certificadoPem });
  sig.loadSignature(firma as unknown as Node);
  return sig.checkSignature(xmlFirmado);
}
