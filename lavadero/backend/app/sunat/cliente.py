"""Cliente SOAP de los servicios SEE-Del Contribuyente de SUNAT."""
from __future__ import annotations

import base64
import io
import logging
import re
import zipfile
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

import httpx
from lxml import etree

from .ubl import NS_CBC

log = logging.getLogger("sunat")

URLS = {
    "beta": "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
    "produccion": "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
}
NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
TIMEOUT = httpx.Timeout(25.0, connect=10.0)


class ErrorTransitorio(Exception):
    """SUNAT no respondió o está saturado: se reintenta más tarde."""


@dataclass(frozen=True)
class Respuesta:
    aceptado: bool
    codigo: str
    descripcion: str
    observaciones: list[str] = field(default_factory=list)
    cdr_zip: bytes | None = None

    @property
    def observado(self) -> bool:
        return self.aceptado and bool(self.observaciones)


def empaquetar(nombre: str, xml: bytes) -> bytes:
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{nombre}.xml", xml)
    return salida.getvalue()


def leer_cdr(cdr_zip: bytes) -> Respuesta:
    with zipfile.ZipFile(io.BytesIO(cdr_zip)) as z:
        xml = next(n for n in z.namelist() if n.lower().endswith(".xml"))
        raiz = etree.fromstring(z.read(xml))
    codigo = raiz.findtext(f".//{{{NS_CBC}}}ResponseCode", default="").strip()
    descripcion = raiz.findtext(f".//{{{NS_CBC}}}Description", default="").strip()
    notas = [n.text.strip() for n in raiz.iter(f"{{{NS_CBC}}}Note") if n.text]
    # Códigos del CDR: 0 aceptado; 4000 o más, aceptado con observaciones; 2000-3999, rechazado.
    numero = int(codigo) if codigo.isdigit() else -1
    aceptado = numero == 0 or numero >= 4000
    return Respuesta(aceptado, codigo, descripcion, notas, cdr_zip)


@dataclass(frozen=True)
class Falla:
    codigo: str
    mensaje: str


def _falla(contenido: bytes) -> Falla | None:
    try:
        raiz = etree.fromstring(contenido)
    except etree.XMLSyntaxError:
        return None
    nodo = raiz.find(f".//{{{NS_SOAP}}}Fault")
    if nodo is None:
        return None
    crudo = nodo.findtext("faultcode", default="")
    encontrado = re.search(r"(\d+)", crudo)
    mensaje = nodo.findtext("faultstring", default="") or nodo.findtext("message", default="")
    if not encontrado:
        encontrado = re.search(r"(\d{3,4})", mensaje)
    return Falla(encontrado.group(1) if encontrado else crudo, mensaje.strip())


class ClienteSunat:
    def __init__(self, entorno: str, ruc: str, usuario: str, clave: str,
                 transporte: httpx.BaseTransport | None = None) -> None:
        self.url = URLS[entorno]
        self.credencial = f"{ruc}{usuario}"
        self.clave = clave
        self.transporte = transporte

    def _sobre(self, cuerpo: str) -> str:
        return (
            f'<soapenv:Envelope xmlns:soapenv="{NS_SOAP}" xmlns:ser="http://service.sunat.gob.pe" '
            'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
            f"<soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>{escape(self.credencial)}</wsse:Username>"
            f"<wsse:Password>{escape(self.clave)}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>"
            f"<soapenv:Body>{cuerpo}</soapenv:Body></soapenv:Envelope>"
        )

    def _llamar(self, cuerpo: str, timeout: httpx.Timeout = TIMEOUT) -> tuple[etree._Element | None, Falla | None]:
        # SUNAT responde 401 si se reutiliza la sesión de una llamada anterior: una conexión por envío.
        try:
            with httpx.Client(timeout=timeout, transport=self.transporte) as http:
                r = http.post(self.url, content=self._sobre(cuerpo).encode(),
                              headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""})
        except httpx.HTTPError as exc:
            raise ErrorTransitorio(f"Sin respuesta de SUNAT: {exc.__class__.__name__}") from exc
        falla = _falla(r.content)
        if falla is not None:
            return None, falla
        if r.status_code >= 400:
            raise ErrorTransitorio(f"SUNAT respondió HTTP {r.status_code}")
        try:
            return etree.fromstring(r.content), None
        except etree.XMLSyntaxError as exc:
            raise ErrorTransitorio("Respuesta de SUNAT ilegible") from exc

    @staticmethod
    def _es_transitoria(f: Falla) -> bool:
        # Códigos bajo 1000: fallas de servicio o autenticación de SUNAT, no un veredicto sobre el documento.
        return f.codigo.isdigit() and int(f.codigo) < 1000

    def enviar_comprobante(self, nombre: str, xml: bytes) -> Respuesta:
        contenido = base64.b64encode(empaquetar(nombre, xml)).decode()
        raiz, falla = self._llamar(
            f"<ser:sendBill><fileName>{nombre}.zip</fileName><contentFile>{contenido}</contentFile></ser:sendBill>"
        )
        if falla is not None:
            if self._es_transitoria(falla):
                raise ErrorTransitorio(f"{falla.codigo}: {falla.mensaje}")
            return Respuesta(False, falla.codigo, falla.mensaje)
        cdr = raiz.findtext(".//applicationResponse")  # type: ignore[union-attr]
        if not cdr:
            raise ErrorTransitorio("SUNAT no devolvió constancia")
        return leer_cdr(base64.b64decode(cdr))

    def enviar_resumen(self, nombre: str, xml: bytes) -> str:
        contenido = base64.b64encode(empaquetar(nombre, xml)).decode()
        raiz, falla = self._llamar(
            f"<ser:sendSummary><fileName>{nombre}.zip</fileName><contentFile>{contenido}</contentFile></ser:sendSummary>"
        )
        if falla is not None:
            if self._es_transitoria(falla):
                raise ErrorTransitorio(f"{falla.codigo}: {falla.mensaje}")
            raise ValueError(f"{falla.codigo}: {falla.mensaje}")
        ticket = raiz.findtext(".//ticket")  # type: ignore[union-attr]
        if not ticket:
            raise ErrorTransitorio("SUNAT no devolvió ticket")
        return ticket

    def consultar_ticket(self, ticket: str) -> Respuesta | None:
        """Devuelve None mientras SUNAT sigue procesando (código 98)."""
        # Solo la usa el trabajador en segundo plano, y SUNAT puede tardar más de un minuto en contestar.
        raiz, falla = self._llamar(f"<ser:getStatus><ticket>{escape(ticket)}</ticket></ser:getStatus>",
                                   httpx.Timeout(90.0, connect=10.0))
        if falla is not None:
            if self._es_transitoria(falla):
                raise ErrorTransitorio(f"{falla.codigo}: {falla.mensaje}")
            return Respuesta(False, falla.codigo, falla.mensaje)
        codigo = raiz.findtext(".//statusCode", default="").strip()  # type: ignore[union-attr]
        if codigo == "98":
            return None
        contenido = raiz.findtext(".//content")  # type: ignore[union-attr]
        if contenido:
            return leer_cdr(base64.b64decode(contenido))
        return Respuesta(False, codigo, "Proceso con errores en SUNAT")
