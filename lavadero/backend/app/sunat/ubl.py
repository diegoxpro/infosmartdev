"""Generación de XML UBL 2.1 (boleta/factura) y resúmenes SUNAT (RA y RC)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence

from lxml import etree

from ..config import TASA_IGV

NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
NS_EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
NS_DS = "http://www.w3.org/2000/09/xmldsig#"
NS_SAC = "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"
NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
NS_VOIDED = "urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1"
NS_SUMMARY = "urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1"
ID_FIRMA = "SIGN"
MONEDA = "PEN"

# Afectación (catálogo 07): 10 gravada, 20 exonerada, 30 inafecta.
GRAVADA, EXONERADA, INAFECTA = "10", "20", "30"
ESQUEMAS = {GRAVADA: ("1000", "IGV", "VAT"), EXONERADA: ("9997", "EXO", "VAT"), INAFECTA: ("9998", "INA", "FRE")}
INSTRUCCION_RESUMEN = {GRAVADA: "01", EXONERADA: "02", INAFECTA: "03"}


@dataclass(frozen=True)
class Emisor:
    ruc: str
    razon_social: str
    nombre_comercial: str
    direccion: str
    ubigeo: str
    departamento: str
    provincia: str
    distrito: str


@dataclass(frozen=True)
class Linea:
    codigo: str
    descripcion: str
    cantidad: Decimal
    precio_unitario: Decimal  # incluye IGV
    base: Decimal
    igv: Decimal
    total: Decimal


@dataclass(frozen=True)
class Comprobante:
    tipo: str  # 01 factura, 03 boleta
    serie: str
    correlativo: int
    fecha: date
    hora: time
    cliente_tipo_doc: str  # 6 RUC, 1 DNI, 0 sin documento
    cliente_num_doc: str
    cliente_nombre: str
    cliente_direccion: str
    op_gravada: Decimal
    igv: Decimal
    total: Decimal
    lineas: Sequence[Linea]
    afectacion: str = GRAVADA

    @property
    def numero(self) -> str:
        return f"{self.serie}-{self.correlativo}"


def _m(valor: Decimal) -> str:
    return str(valor.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def calcular_linea(codigo: str, descripcion: str, cantidad: Decimal, precio: Decimal, afectacion: str = GRAVADA) -> Linea:
    """Desglosa el IGV de un precio que ya lo incluye, sin descuadres de centavos."""
    total = (cantidad * precio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if afectacion != GRAVADA:
        return Linea(codigo, descripcion, cantidad, precio, total, Decimal("0.00"), total)
    divisor = Decimal(100 + TASA_IGV) / Decimal(100)
    base = (total / divisor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Linea(codigo, descripcion, cantidad, precio, base, total - base, total)


_UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ",
             "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO",
             "DIECINUEVE", "VEINTE", "VEINTIUN", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO",
             "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"]
_DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
_CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
             "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"]


def _bajo_mil(n: int) -> str:
    if n == 100:
        return "CIEN"
    partes: list[str] = []
    if n >= 100:
        partes.append(_CENTENAS[n // 100])
        n %= 100
    if n < 30:
        if n:
            partes.append(_UNIDADES[n])
    else:
        d, u = divmod(n, 10)
        partes.append(_DECENAS[d] + (f" Y {_UNIDADES[u]}" if u else ""))
    return " ".join(partes)


def monto_en_letras(total: Decimal) -> str:
    entero = int(total)
    centimos = int((total - entero) * 100)
    if entero == 0:
        texto = "CERO"
    else:
        partes: list[str] = []
        millones, resto = divmod(entero, 1_000_000)
        miles, cientos = divmod(resto, 1000)
        if millones:
            partes.append("UN MILLON" if millones == 1 else f"{_bajo_mil(millones)} MILLONES")
        if miles:
            partes.append("MIL" if miles == 1 else f"{_bajo_mil(miles)} MIL")
        if cientos:
            partes.append(_bajo_mil(cientos))
        texto = " ".join(partes)
    return f"SON {texto} CON {centimos:02d}/100 SOLES"


class _X:
    """Pequeño ayudante para construir el árbol con prefijos legibles."""

    MAPA = {"cac": NS_CAC, "cbc": NS_CBC, "ext": NS_EXT, "sac": NS_SAC}

    @classmethod
    def q(cls, nombre: str) -> str:
        prefijo, local = nombre.split(":")
        return f"{{{cls.MAPA[prefijo]}}}{local}"

    @classmethod
    def sub(cls, padre: etree._Element, nombre: str, texto: str | None = None, **attrs: str) -> etree._Element:
        nodo = etree.SubElement(padre, cls.q(nombre), attrs)
        if texto is not None:
            nodo.text = texto
        return nodo

    @classmethod
    def monto(cls, padre: etree._Element, nombre: str, valor: Decimal) -> None:
        cls.sub(padre, nombre, _m(valor), currencyID=MONEDA)


def _extension(raiz: etree._Element) -> None:
    exts = _X.sub(raiz, "ext:UBLExtensions")
    _X.sub(_X.sub(exts, "ext:UBLExtension"), "ext:ExtensionContent")


def _firma_ref(raiz: etree._Element, id_doc: str, em: Emisor) -> None:
    firma = _X.sub(raiz, "cac:Signature")
    _X.sub(firma, "cbc:ID", id_doc)
    parte = _X.sub(firma, "cac:SignatoryParty")
    _X.sub(_X.sub(parte, "cac:PartyIdentification"), "cbc:ID", em.ruc)
    _X.sub(_X.sub(parte, "cac:PartyName"), "cbc:Name", em.razon_social)
    adj = _X.sub(firma, "cac:DigitalSignatureAttachment")
    _X.sub(_X.sub(adj, "cac:ExternalReference"), "cbc:URI", f"#{ID_FIRMA}")


def _esquema(padre: etree._Element, afectacion: str = GRAVADA) -> None:
    codigo, nombre, tipo = ESQUEMAS[afectacion]
    esquema = _X.sub(padre, "cac:TaxScheme")
    _X.sub(esquema, "cbc:ID", codigo)
    _X.sub(esquema, "cbc:Name", nombre)
    _X.sub(esquema, "cbc:TaxTypeCode", tipo)


def _emisor_ubl(raiz: etree._Element, em: Emisor) -> None:
    parte = _X.sub(_X.sub(raiz, "cac:AccountingSupplierParty"), "cac:Party")
    _X.sub(_X.sub(parte, "cac:PartyIdentification"), "cbc:ID", em.ruc, schemeID="6")
    _X.sub(_X.sub(parte, "cac:PartyName"), "cbc:Name", em.nombre_comercial)
    legal = _X.sub(parte, "cac:PartyLegalEntity")
    _X.sub(legal, "cbc:RegistrationName", em.razon_social)
    dom = _X.sub(legal, "cac:RegistrationAddress")
    _X.sub(dom, "cbc:ID", em.ubigeo)
    _X.sub(dom, "cbc:AddressTypeCode", "0000")
    _X.sub(dom, "cbc:CityName", em.provincia)
    _X.sub(dom, "cbc:CountrySubentity", em.departamento)
    _X.sub(dom, "cbc:District", em.distrito)
    _X.sub(_X.sub(dom, "cac:AddressLine"), "cbc:Line", em.direccion)
    _X.sub(_X.sub(dom, "cac:Country"), "cbc:IdentificationCode", "PE")


def _cliente_ubl(raiz: etree._Element, c: Comprobante) -> None:
    parte = _X.sub(_X.sub(raiz, "cac:AccountingCustomerParty"), "cac:Party")
    _X.sub(_X.sub(parte, "cac:PartyIdentification"), "cbc:ID", c.cliente_num_doc, schemeID=c.cliente_tipo_doc)
    legal = _X.sub(parte, "cac:PartyLegalEntity")
    _X.sub(legal, "cbc:RegistrationName", c.cliente_nombre)
    if c.cliente_direccion:
        dom = _X.sub(legal, "cac:RegistrationAddress")
        _X.sub(_X.sub(dom, "cac:AddressLine"), "cbc:Line", c.cliente_direccion)
        _X.sub(_X.sub(dom, "cac:Country"), "cbc:IdentificationCode", "PE")


def _total_impuestos(padre: etree._Element, base: Decimal, igv: Decimal, linea: bool, afectacion: str) -> None:
    total = _X.sub(padre, "cac:TaxTotal")
    _X.monto(total, "cbc:TaxAmount", igv)
    sub = _X.sub(total, "cac:TaxSubtotal")
    _X.monto(sub, "cbc:TaxableAmount", base)
    _X.monto(sub, "cbc:TaxAmount", igv)
    cat = _X.sub(sub, "cac:TaxCategory")
    if linea:
        _X.sub(cat, "cbc:Percent", f"{TASA_IGV if afectacion == GRAVADA else 0:.2f}")
        _X.sub(cat, "cbc:TaxExemptionReasonCode", afectacion)
    _esquema(cat, afectacion)


def comprobante_xml(c: Comprobante, em: Emisor) -> etree._Element:
    raiz = etree.Element(
        f"{{{NS_INVOICE}}}Invoice",
        nsmap={None: NS_INVOICE, "cac": NS_CAC, "cbc": NS_CBC, "ds": NS_DS, "ext": NS_EXT},
    )
    _extension(raiz)
    _X.sub(raiz, "cbc:UBLVersionID", "2.1")
    _X.sub(raiz, "cbc:CustomizationID", "2.0")
    _X.sub(raiz, "cbc:ID", c.numero)
    _X.sub(raiz, "cbc:IssueDate", c.fecha.isoformat())
    _X.sub(raiz, "cbc:IssueTime", c.hora.strftime("%H:%M:%S"))
    _X.sub(raiz, "cbc:InvoiceTypeCode", c.tipo, listID="0101")
    _X.sub(raiz, "cbc:Note", monto_en_letras(c.total), languageLocaleID="1000")
    _X.sub(raiz, "cbc:DocumentCurrencyCode", MONEDA)
    _firma_ref(raiz, c.numero, em)
    _emisor_ubl(raiz, em)
    _cliente_ubl(raiz, c)
    terminos = _X.sub(raiz, "cac:PaymentTerms")
    _X.sub(terminos, "cbc:ID", "FormaPago")
    _X.sub(terminos, "cbc:PaymentMeansID", "Contado")
    _total_impuestos(raiz, c.op_gravada, c.igv, linea=False, afectacion=c.afectacion)
    totales = _X.sub(raiz, "cac:LegalMonetaryTotal")
    _X.monto(totales, "cbc:LineExtensionAmount", c.op_gravada)
    _X.monto(totales, "cbc:TaxInclusiveAmount", c.total)
    _X.monto(totales, "cbc:PayableAmount", c.total)

    for i, l in enumerate(c.lineas, 1):
        nodo = _X.sub(raiz, "cac:InvoiceLine")
        _X.sub(nodo, "cbc:ID", str(i))
        _X.sub(nodo, "cbc:InvoicedQuantity", str(l.cantidad.normalize().quantize(Decimal("1"))
                                                 if l.cantidad == l.cantidad.to_integral() else l.cantidad),
               unitCode="ZZ")
        _X.monto(nodo, "cbc:LineExtensionAmount", l.base)
        precio_ref = _X.sub(_X.sub(nodo, "cac:PricingReference"), "cac:AlternativeConditionPrice")
        _X.monto(precio_ref, "cbc:PriceAmount", l.precio_unitario)
        _X.sub(precio_ref, "cbc:PriceTypeCode", "01")
        _total_impuestos(nodo, l.base, l.igv, linea=True, afectacion=c.afectacion)
        item = _X.sub(nodo, "cac:Item")
        _X.sub(item, "cbc:Description", l.descripcion)
        _X.sub(_X.sub(item, "cac:SellersItemIdentification"), "cbc:ID", l.codigo)
        valor_unit = (l.base / l.cantidad).quantize(Decimal("0.0000000001"), rounding=ROUND_HALF_UP)
        _X.sub(_X.sub(nodo, "cac:Price"), "cbc:PriceAmount", str(valor_unit), currencyID=MONEDA)
    return raiz


def _emisor_resumen(raiz: etree._Element, em: Emisor) -> None:
    prov = _X.sub(raiz, "cac:AccountingSupplierParty")
    _X.sub(prov, "cbc:CustomerAssignedAccountID", em.ruc)
    _X.sub(prov, "cbc:AdditionalAccountID", "6")
    legal = _X.sub(_X.sub(prov, "cac:Party"), "cac:PartyLegalEntity")
    _X.sub(legal, "cbc:RegistrationName", em.razon_social)


def baja_xml(identificador: str, fecha_doc: date, fecha_envio: date, em: Emisor,
             tipo: str, serie: str, correlativo: int, motivo: str) -> etree._Element:
    """Comunicación de baja (RA) de una factura."""
    raiz = etree.Element(
        f"{{{NS_VOIDED}}}VoidedDocuments",
        nsmap={None: NS_VOIDED, "cac": NS_CAC, "cbc": NS_CBC, "ds": NS_DS, "ext": NS_EXT, "sac": NS_SAC},
    )
    _extension(raiz)
    _X.sub(raiz, "cbc:UBLVersionID", "2.0")
    _X.sub(raiz, "cbc:CustomizationID", "1.0")
    _X.sub(raiz, "cbc:ID", identificador)
    _X.sub(raiz, "cbc:ReferenceDate", fecha_doc.isoformat())
    _X.sub(raiz, "cbc:IssueDate", fecha_envio.isoformat())
    _firma_ref(raiz, identificador, em)
    _emisor_resumen(raiz, em)
    linea = _X.sub(raiz, "sac:VoidedDocumentsLine")
    _X.sub(linea, "cbc:LineID", "1")
    _X.sub(linea, "cbc:DocumentTypeCode", tipo)
    _X.sub(linea, "sac:DocumentSerialID", serie)
    _X.sub(linea, "sac:DocumentNumberID", str(correlativo))
    _X.sub(linea, "sac:VoidReasonDescription", motivo)
    return raiz


def resumen_anulacion_xml(identificador: str, c: Comprobante, fecha_envio: date, em: Emisor) -> etree._Element:
    """Resumen diario (RC) con estado 3 para anular una boleta."""
    raiz = etree.Element(
        f"{{{NS_SUMMARY}}}SummaryDocuments",
        nsmap={None: NS_SUMMARY, "cac": NS_CAC, "cbc": NS_CBC, "ds": NS_DS, "ext": NS_EXT, "sac": NS_SAC},
    )
    _extension(raiz)
    _X.sub(raiz, "cbc:UBLVersionID", "2.0")
    _X.sub(raiz, "cbc:CustomizationID", "1.1")
    _X.sub(raiz, "cbc:ID", identificador)
    _X.sub(raiz, "cbc:ReferenceDate", c.fecha.isoformat())
    _X.sub(raiz, "cbc:IssueDate", fecha_envio.isoformat())
    _firma_ref(raiz, identificador, em)
    _emisor_resumen(raiz, em)
    linea = _X.sub(raiz, "sac:SummaryDocumentsLine")
    _X.sub(linea, "cbc:LineID", "1")
    _X.sub(linea, "cbc:DocumentTypeCode", c.tipo)
    _X.sub(linea, "cbc:ID", c.numero)
    cliente = _X.sub(linea, "cac:AccountingCustomerParty")
    _X.sub(cliente, "cbc:CustomerAssignedAccountID", c.cliente_num_doc)
    _X.sub(cliente, "cbc:AdditionalAccountID", c.cliente_tipo_doc)
    _X.sub(_X.sub(linea, "cac:Status"), "cbc:ConditionCode", "3")
    _X.monto(linea, "sac:TotalAmount", c.total)
    pago = _X.sub(linea, "sac:BillingPayment")
    _X.monto(pago, "cbc:PaidAmount", c.op_gravada)
    _X.sub(pago, "cbc:InstructionID", INSTRUCCION_RESUMEN[c.afectacion])
    impuesto = _X.sub(linea, "cac:TaxTotal")
    _X.monto(impuesto, "cbc:TaxAmount", c.igv)
    sub = _X.sub(impuesto, "cac:TaxSubtotal")
    _X.monto(sub, "cbc:TaxableAmount", c.op_gravada)
    _X.monto(sub, "cbc:TaxAmount", c.igv)
    categoria = _X.sub(sub, "cac:TaxCategory")
    _X.sub(categoria, "cbc:Percent", f"{TASA_IGV:.2f}")
    _esquema(categoria)
    return raiz
