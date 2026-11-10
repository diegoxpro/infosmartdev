"""Firma XMLDSig enveloped (RSA-SHA1, C14N inclusivo) que exige SUNAT, con el CDT."""
from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from lxml import etree

from .ubl import ID_FIRMA, NS_DS, NS_EXT

C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1"


@dataclass(frozen=True)
class Certificado:
    clave: rsa.RSAPrivateKey
    cert: x509.Certificate


def cargar_certificado(ruta: str, clave: str) -> Certificado:
    return cargar_bytes(Path(ruta).read_bytes(), clave)


def cargar_bytes(contenido: bytes, clave: str) -> Certificado:
    llave, cert, _ = pkcs12.load_key_and_certificates(contenido, clave.encode() or None)
    if not isinstance(llave, rsa.RSAPrivateKey) or cert is None:
        raise ValueError("El certificado debe contener una clave RSA y su certificado X.509")
    return Certificado(llave, cert)


def _ds(padre: etree._Element, nombre: str, texto: str | None = None, **attrs: str) -> etree._Element:
    nodo = etree.SubElement(padre, f"{{{NS_DS}}}{nombre}", attrs)
    if texto is not None:
        nodo.text = texto
    return nodo


def _c14n(nodo: etree._Element) -> bytes:
    return etree.tostring(nodo, method="c14n", exclusive=False, with_comments=False)


def firmar(raiz: etree._Element, certificado: Certificado) -> str:
    """Inserta la firma en ExtensionContent y devuelve el DigestValue (hash del comprobante)."""
    destino = raiz.find(f".//{{{NS_EXT}}}ExtensionContent")
    if destino is None:
        raise ValueError("El XML no tiene ExtensionContent")

    # Con ExtensionContent aún vacío, el canon coincide con el resultado de la transformación enveloped.
    digest = base64.b64encode(hashlib.sha1(_c14n(raiz)).digest()).decode()  # noqa: S324 (exigido por SUNAT)

    firma = _ds(destino, "Signature", Id=ID_FIRMA)
    info = _ds(firma, "SignedInfo")
    _ds(info, "CanonicalizationMethod", Algorithm=C14N)
    _ds(info, "SignatureMethod", Algorithm=RSA_SHA1)
    ref = _ds(info, "Reference", URI="")
    _ds(_ds(ref, "Transforms"), "Transform", Algorithm=ENVELOPED)
    _ds(ref, "DigestMethod", Algorithm=SHA1)
    _ds(ref, "DigestValue", digest)

    valor = certificado.clave.sign(_c14n(info), padding.PKCS1v15(), hashes.SHA1())  # noqa: S303
    _ds(firma, "SignatureValue", base64.b64encode(valor).decode())
    der = certificado.cert.public_bytes(serialization.Encoding.DER)
    _ds(_ds(_ds(firma, "KeyInfo"), "X509Data"), "X509Certificate", base64.b64encode(der).decode())
    return digest


def serializar(raiz: etree._Element) -> bytes:
    return etree.tostring(raiz, xml_declaration=True, encoding="UTF-8", standalone=False)
