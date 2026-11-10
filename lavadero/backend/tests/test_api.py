"""Pruebas del flujo completo con SUNAT simulado."""
import base64
import datetime as dt
import hashlib
import os
import uuid
from decimal import Decimal

os.environ.update(DATABASE_URL="sqlite:///:memory:", JWT_SECRETO="x" * 40, ADMIN_CLAVE="clave-de-prueba",
                  SUNAT_RUC="20000000001", CERT_RUTA="", INTERVALO_WORKER_S="3600")

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from lxml import etree

from app import emision
from app.main import app
from app.sunat import cliente as sc, firma, ubl

_llave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "TEST")])
_ahora = dt.datetime.now(dt.timezone.utc)
_cert = (x509.CertificateBuilder().subject_name(_nombre).issuer_name(_nombre).public_key(_llave.public_key())
         .serial_number(1).not_valid_before(_ahora - dt.timedelta(days=1)).not_valid_after(_ahora + dt.timedelta(days=9))
         .sign(_llave, hashes.SHA256()))
CERT = firma.Certificado(_llave, _cert)


class SunatFalso:
    def __init__(self):
        self.modo = "ok"
        self.envios = 0

    def enviar_comprobante(self, nombre, xml):
        self.envios += 1
        if self.modo == "caido":
            raise sc.ErrorTransitorio("sin red")
        if self.modo == "rechazo":
            return sc.Respuesta(False, "2017", "Rechazado")
        return sc.Respuesta(True, "0", "Aceptada", [], b"zip")

    def enviar_resumen(self, nombre, xml):
        return "T1"

    def consultar_ticket(self, ticket):
        return sc.Respuesta(True, "0", "Aceptada", [], b"zip")


@pytest.fixture(scope="module")
def sunat():
    return SunatFalso()


@pytest.fixture(scope="module")
def api(sunat):
    pm = pytest.MonkeyPatch()
    pm.setattr(emision, "cliente_sunat", lambda s=None: sunat)
    pm.setattr(emision, "_certificado", lambda s=None: CERT)
    with TestClient(app) as c:
        t = c.post("/auth/login", json={"usuario": "admin", "clave": "clave-de-prueba"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {t}"
        r = c.put("/empresa", json={"ruc": "20000000001", "razon_social": "El Firme", "nombre_comercial": "El Firme", "direccion": "  av  prueba\n123 ",
                                    "ubigeo": "150101", "departamento": "Lima", "provincia": "Lima", "distrito": "Lima"})
        assert r.status_code == 200 and r.json()["direccion"] == "AV PRUEBA 123"
        yield c
    pm.undo()


def cuerpo(**extra):
    base = {"clave": str(uuid.uuid4()), "tipo": "03", "medio_pago": "YAPE", "placa": "abc 123",
            "items": [{"codigo": "LAV02", "descripcion": "Lavado completo", "cantidad": "1", "precio": "35.00"}]}
    return base | extra


def test_requiere_token():
    with TestClient(app) as c:
        assert c.get("/comprobantes").status_code == 401


def test_igv_y_redondeo():
    l = ubl.calcular_linea("A", "x", Decimal("3"), Decimal("33.33"))
    assert l.total == Decimal("99.99") and l.base + l.igv == l.total and l.base == Decimal("84.74")


def test_letras():
    assert ubl.monto_en_letras(Decimal("1235.50")) == "SON MIL DOSCIENTOS TREINTA Y CINCO CON 50/100 SOLES"
    assert ubl.monto_en_letras(Decimal("21.00")) == "SON VEINTIUN CON 00/100 SOLES"


def test_ruc():
    assert emision.ruc_valido("20100066603")
    assert not emision.ruc_valido("20100066604")


def test_boleta_aceptada_y_entra_a_caja(api):
    r = api.post("/comprobantes", json=cuerpo())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["estado"] == "ACEPTADO" and d["placa"] == "ABC123" and d["igv"] == "5.34"
    caja = api.get("/caja/dia").json()
    assert Decimal(caja["ingresos"]) >= Decimal("35.00") and caja["por_medio"]["YAPE"]


def test_idempotencia_no_duplica(api, sunat):
    c = cuerpo()
    antes = sunat.envios
    a, b = api.post("/comprobantes", json=c).json(), api.post("/comprobantes", json=c).json()
    assert a["id"] == b["id"] and sunat.envios == antes + 1


def test_correlativo_avanza(api):
    a = api.post("/comprobantes", json=cuerpo()).json()
    b = api.post("/comprobantes", json=cuerpo()).json()
    assert b["correlativo"] == a["correlativo"] + 1


def test_factura_exige_ruc(api):
    r = api.post("/comprobantes", json=cuerpo(tipo="01", cliente_tipo_doc="1", cliente_num_doc="12345678"))
    assert r.status_code == 422 and "RUC" in r.json()["detail"]


def test_boleta_mayor_700_exige_cliente(api):
    c = cuerpo()
    c["items"][0]["precio"] = "701.00"
    assert api.post("/comprobantes", json=c).status_code == 422


def test_caido_queda_pendiente_y_se_recupera(api, sunat):
    sunat.modo = "caido"
    d = api.post("/comprobantes", json=cuerpo()).json()
    assert d["estado"] == "POR_ENVIAR" and d["dias_restantes"] == 3
    sunat.modo = "ok"
    assert api.post(f"/comprobantes/{d['id']}/reenviar").json()["estado"] == "ACEPTADO"


def test_rechazo_se_anula_sin_baja(api, sunat):
    sunat.modo = "rechazo"
    d = api.post("/comprobantes", json=cuerpo(medio_pago="PLIN")).json()
    sunat.modo = "ok"
    assert d["estado"] == "RECHAZADO"
    assert any(x["id"] == d["id"] for x in api.get("/sunat/control").json()["por_atender"])
    assert api.post(f"/comprobantes/{d['id']}/anular", json={"motivo": "error"}).json()["estado"] == "ANULADO"


def test_anulacion_con_ticket_saca_de_caja(api):
    d = api.post("/comprobantes", json=cuerpo(medio_pago="TARJETA")).json()
    a = api.post(f"/comprobantes/{d['id']}/anular", json={"motivo": "error de digitacion"}).json()
    assert a["estado"] == "ANULANDO"
    assert "TARJETA" not in api.get("/caja/dia").json()["por_medio"]
    api.post("/sunat/enviar-pendientes")
    assert api.get(f"/comprobantes/{d['id']}").json()["estado"] == "ANULADO"


def test_gasto_reduce_saldo(api):
    antes = Decimal(api.get("/caja/dia").json()["saldo"])
    r = api.post("/movimientos", json={"clave": str(uuid.uuid4()), "tipo": "gasto", "categoria": "Insumos",
                                       "monto": "12.50", "medio_pago": "EFECTIVO"})
    assert r.status_code == 200
    assert Decimal(api.get("/caja/dia").json()["saldo"]) == antes - Decimal("12.50")


def test_cajero_no_anula(api):
    api.post("/usuarios", json={"usuario": "caja1", "nombre": "Caja", "clave": "clave-segura", "rol": "cajero"})
    with TestClient(app) as c:
        t = c.post("/auth/login", json={"usuario": "caja1", "clave": "clave-segura"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {t}"
        assert c.post("/comprobantes/1/anular", json={"motivo": "xxx"}).status_code == 403


def test_bloqueo_por_intentos():
    with TestClient(app) as c:
        for _ in range(5):
            assert c.post("/auth/login", json={"usuario": "nadie", "clave": "x"}).status_code == 401
        assert c.post("/auth/login", json={"usuario": "nadie", "clave": "x"}).status_code == 429


FALLA = ('<e:Envelope xmlns:e="http://schemas.xmlsoap.org/soap/envelope/"><e:Body><e:Fault>'
         "<faultcode>e:Server.{}</faultcode><faultstring>detalle</faultstring></e:Fault></e:Body></e:Envelope>")


def _cliente_con_falla(codigo):
    t = httpx.MockTransport(lambda _: httpx.Response(500, text=FALLA.format(codigo)))
    return sc.ClienteSunat("beta", "20000000001", "MODDATOS", "moddatos", transporte=t)


def test_falla_de_servicio_se_reintenta_no_rechaza():
    with pytest.raises(sc.ErrorTransitorio):
        _cliente_con_falla("200").consultar_ticket("1")


def test_falla_del_documento_es_definitiva():
    r = _cliente_con_falla("2017").enviar_comprobante("x", b"<a/>")
    assert not r.aceptado and r.codigo == "2017"


def test_firma_verificable():
    em = ubl.Emisor("20000000001", "X SAC", "X", "D", "150101", "L", "L", "L")
    l = ubl.calcular_linea("A", "Ñandú á", Decimal("1"), Decimal("10"))
    c = ubl.Comprobante("03", "B001", 1, dt.date(2026, 1, 1), dt.time(10, 0), "0", "00000000", "CLIENTE", "", l.base, l.igv, l.total, [l])
    raiz = ubl.comprobante_xml(c, em)
    digest = firma.firmar(raiz, CERT)
    final = etree.fromstring(firma.serializar(raiz))
    ds = "{http://www.w3.org/2000/09/xmldsig#}"
    sig = final.find(f".//{ds}Signature")
    info = sig.find(f"{ds}SignedInfo")
    valor = base64.b64decode(sig.findtext(f"{ds}SignatureValue"))
    _llave.public_key().verify(valor, etree.tostring(info, method="c14n"), padding.PKCS1v15(), hashes.SHA1())
    sig.getparent().remove(sig)
    assert base64.b64encode(hashlib.sha1(etree.tostring(final, method="c14n")).digest()).decode() == digest
