"""Clientes, consultas, logo y configuración de SUNAT. Se ejecuta después del flujo principal."""
import base64
import datetime as dt
import uuid

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from fastapi.testclient import TestClient

from app import ajustes, db, decolecta, emision
from app.main import app
from test_api import CERT, SunatFalso, _ahora, _cert, _llave, _nombre, cuerpo, x509

TOKEN = "token-secreto-de-prueba-abcd"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 40


def pfx(clave=b"clave"):
    return base64.b64encode(pkcs12.serialize_key_and_certificates(
        b"t", _llave, _cert, None, serialization.BestAvailableEncryption(clave))).decode()


def manejador(request: httpx.Request) -> httpx.Response:
    if request.headers["Authorization"] != f"Bearer {TOKEN}":
        return httpx.Response(401, json={"message": "no autorizado"})
    numero = request.url.params["numero"]
    if numero == "99999999":
        return httpx.Response(400, json={"error": "Invalid request"})
    if request.url.path.endswith("/reniec/dni"):
        return httpx.Response(200, json={"first_name": "ROXANA", "full_name": "DELGADO HUAMANI ROXANA", "document_number": numero})
    return httpx.Response(200, json={"razon_social": "EMPRESA S.A.C.", "numero_documento": numero, "estado": "ACTIVO",
                                     "condicion": "NO HABIDO", "direccion": "AV. LIMA 123 ", "distrito": "SAN ISIDRO",
                                     "provincia": "LIMA", "departamento": "LIMA"})


@pytest.fixture(scope="module")
def api():
    pm = pytest.MonkeyPatch()
    pm.setattr(decolecta, "transporte", httpx.MockTransport(manejador))
    pm.setattr(emision, "cliente_sunat", lambda s=None: SunatFalso())
    pm.setattr(emision, "_certificado", lambda s=None: CERT)
    with TestClient(app) as c:
        t = c.post("/auth/login", json={"usuario": "admin", "clave": "clave-de-prueba"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {t}"
        yield c
    pm.undo()


def test_leer_configuracion_no_abre_escrituras(api):
    with db.Sesion() as s:
        ajustes.efectivo(s)
        assert not s.new and not s.dirty


def test_crud_clientes(api):
    c = api.post("/clientes", json={"tipo_doc": "1", "num_doc": "45678912", "nombre": "maría quispe", "telefono": "987 654 321", "placa": "abc 123"})
    assert c.status_code == 200, c.text
    d = c.json()
    assert d["nombre"] == "MARÍA QUISPE" and d["telefono"] == "987654321" and d["placa"] == "ABC123"
    assert api.post("/clientes", json={"tipo_doc": "1", "num_doc": "45678912", "nombre": "otro"}).status_code == 422
    assert any(x["id"] == d["id"] for x in api.get("/clientes", params={"q": "987654"}).json())
    r = api.put(f"/clientes/{d['id']}", json={"tipo_doc": "1", "num_doc": "45678912", "nombre": "Maria Q", "telefono": ""})
    assert r.json()["nombre"] == "MARIA Q"
    assert api.delete(f"/clientes/{d['id']}").status_code == 200
    assert api.get(f"/clientes/{d['id']}").status_code == 404


def test_cliente_siempre_en_mayusculas(api):
    d = api.post("/clientes", json={"tipo_doc": "1", "num_doc": "55667788", "nombre": " josé   peña ", "direccion": "jr  bolognesi\t1091"}).json()
    assert d["nombre"] == "JOSÉ PEÑA" and d["direccion"] == "JR BOLOGNESI 1091"
    assert api.post("/clientes", json={"tipo_doc": "1", "num_doc": "55667789", "nombre": "ana", "direccion": "x"}).status_code == 422


def test_sin_direccion_fiscal_no_emite(api):
    with db.Sesion() as s:
        original = s.get(db.Empresa, 1).direccion
        s.get(db.Empresa, 1).direccion = ""
        s.commit()
    r = api.post("/comprobantes", json=cuerpo())
    assert r.status_code == 422 and "dirección fiscal" in r.json()["detail"]
    assert api.put("/empresa", json={"ruc": "20000000001", "razon_social": "El Firme", "nombre_comercial": "El Firme", "direccion": " ", "ubigeo": "150101",
                                     "departamento": "L", "provincia": "L", "distrito": "L"}).status_code == 422
    with db.Sesion() as s:
        s.get(db.Empresa, 1).direccion = original
        s.commit()


@pytest.mark.parametrize("codigo,esquema", [("20", "9997"), ("30", "9998")])
def test_venta_sin_igv(api, codigo, esquema):
    assert api.put("/ajustes/ventas", json={"afectacion": codigo}).status_code == 200
    d = api.post("/comprobantes", json=cuerpo(medio_pago="EFECTIVO")).json()
    assert d["afectacion"] == codigo and d["igv"] == "0.00" and d["op_gravada"] == "35.00" and d["total"] == "35.00"
    with db.Sesion() as s:
        xml = s.get(db.Comprobante, d["id"]).xml.decode()
    assert f">{esquema}<" in xml and "<cbc:TaxExemptionReasonCode>" + codigo in xml
    assert api.put("/ajustes/ventas", json={"afectacion": "10"}).json()["afectacion"] == "10"


def test_ruc_de_empresa_editable(api):
    base = {"razon_social": "El Firme SAC", "nombre_comercial": "El Firme", "direccion": "Av 1", "ubigeo": "150101",
            "departamento": "L", "provincia": "L", "distrito": "L"}
    r = api.put("/empresa", json=base | {"ruc": "20100066604"})
    assert r.status_code == 422 and "RUC" in r.json()["detail"]
    assert api.put("/empresa", json=base | {"ruc": "20100066603"}).json()["ruc"] == "20100066603"
    assert "ubigeo" in api.put("/empresa", json=base | {"ruc": "20100066603", "ubigeo": ""}).json()["detail"]
    assert api.put("/empresa", json=base | {"ruc": "20000000001", "razon_social": "El Firme"}).status_code == 200


def test_datos_de_relleno_se_limpian_una_vez():
    from app import main

    with db.Sesion() as s:
        e = s.get(db.Empresa, 1)
        guardado = (e.ruc, e.razon_social, e.direccion, e.ubigeo, e.nombre_comercial, e.departamento, e.provincia, e.distrito)
        e.ruc, e.razon_social, e.direccion, e.ubigeo = "20000000001", "EL FIRME", "", "150101"
        s.commit()
    main._sembrar()
    with db.Sesion() as s:
        e = s.get(db.Empresa, 1)
        assert (e.ruc, e.razon_social, e.ubigeo, e.departamento) == ("", "", "", "")
        e.ruc, e.razon_social, e.direccion, e.ubigeo, e.nombre_comercial, e.departamento, e.provincia, e.distrito = guardado
        s.commit()
    main._sembrar()
    with db.Sesion() as s:
        assert s.get(db.Empresa, 1).ruc == guardado[0]


def test_afectacion_invalida(api):
    assert api.put("/ajustes/ventas", json={"afectacion": "99"}).status_code == 422


def test_cliente_ruc_invalido(api):
    assert api.post("/clientes", json={"tipo_doc": "6", "num_doc": "20100066604", "nombre": "X SAC"}).status_code == 422


def test_consulta_sin_token_avisa(api):
    r = api.get("/consulta/dni/12345678")
    assert r.status_code == 409


def test_token_guardado_nunca_se_devuelve(api):
    r = api.put("/ajustes/consultas", json={"activo": True, "token": TOKEN})
    assert r.status_code == 200 and TOKEN not in r.text and r.json()["token_final"] == "abcd"
    assert TOKEN not in api.get("/ajustes/consultas").text
    with db.Sesion() as s:
        assert TOKEN not in ajustes.obtener(s).decolecta_token_cif


def test_consulta_dni_y_ruc(api):
    d = api.get("/consulta/dni/46027897").json()
    assert d["nombre"] == "DELGADO HUAMANI ROXANA" and d["origen"] == "decolecta"
    r = api.get("/consulta/ruc/20100066603").json()
    assert r["nombre"] == "EMPRESA S.A.C." and r["condicion"] == "NO HABIDO" and r["direccion"] == "AV. LIMA 123 SAN ISIDRO LIMA LIMA"


def test_consulta_no_encontrada_y_token_malo(api):
    assert "No se encontró" in api.get("/consulta/dni/99999999").json()["detail"]
    r = api.post("/ajustes/consultas/probar", json={"token": "malo"})
    assert r.status_code == 422 and "rechazó" in r.json()["detail"]
    assert api.post("/ajustes/consultas/probar", json={}).json()["ok"]


def test_consulta_prefiere_cliente_guardado(api):
    api.post("/clientes", json={"tipo_doc": "1", "num_doc": "11223344", "nombre": "Local", "telefono": "912345678"})
    d = api.get("/consulta/dni/11223344").json()
    assert d["origen"] == "clientes" and d["telefono"] == "912345678"


def test_logo(api):
    assert api.put("/empresa/logo", content=b"no es imagen").status_code == 422
    assert api.put("/empresa/logo", content=b"\x89PNG\r\n\x1a\n" + b"0" * 600_000).status_code == 422
    v = api.put("/empresa/logo", content=PNG).json()["logo_version"]
    e = api.get("/empresa").json()
    assert e["tiene_logo"] and e["logo_version"] == v
    r = api.get("/empresa/logo")
    assert r.content == PNG and r.headers["content-type"] == "image/png"
    api.delete("/empresa/logo")
    assert not api.get("/empresa").json()["tiene_logo"]


def test_certificado_y_clave(api):
    assert api.put("/ajustes/sunat/certificado", json={"archivo_b64": pfx(), "clave": "incorrecta"}).status_code == 422
    r = api.put("/ajustes/sunat/certificado", json={"archivo_b64": pfx(), "clave": "clave"})
    assert r.status_code == 200 and r.json()["certificado"]["valido"]
    assert "clave" not in r.json()["certificado"]


def test_certificado_vencido_rechazado(api):
    viejo = (x509.CertificateBuilder().subject_name(_nombre).issuer_name(_nombre).public_key(_llave.public_key())
             .serial_number(2).not_valid_before(_ahora - dt.timedelta(days=9)).not_valid_after(_ahora - dt.timedelta(days=1))
             .sign(_llave, hashes.SHA256()))
    b = base64.b64encode(pkcs12.serialize_key_and_certificates(b"t", _llave, viejo, None, serialization.BestAvailableEncryption(b"c"))).decode()
    assert "venció" in api.put("/ajustes/sunat/certificado", json={"archivo_b64": b, "clave": "c"}).json()["detail"]


def test_beta_no_usa_credenciales_reales(api):
    r = api.put("/ajustes/sunat", json={"ruc": "20100066603", "usuario": "miusuario", "clave": "ClaveSOL1"})
    assert r.status_code == 200 and "ClaveSOL1" not in r.text and r.json()["clave_guardada"]
    with db.Sesion() as s:
        e = ajustes.efectivo(s)
        assert (e.usuario, e.clave, e.ruc) == ("MODDATOS", "moddatos", "20100066603")
        assert "ClaveSOL1" not in ajustes.obtener(s).sunat_clave_cif


def test_activar_produccion(api):
    assert api.post("/ajustes/sunat/activar-produccion", json={"confirmacion": "si"}).status_code == 422
    falta = api.post("/ajustes/sunat/activar-produccion", json={"confirmacion": "PRODUCCION"}).json()["detail"]
    assert "razón social" in falta
    api.put("/empresa", json={"ruc": "20100066603", "razon_social": "Autolavado El Firme SAC", "nombre_comercial": "El Firme", "direccion": "Av 1",
                              "ubigeo": "150101", "departamento": "Lima", "provincia": "Lima", "distrito": "Lima"})
    assert api.get("/sunat/control").json()["conteo"]
    r = api.post("/ajustes/sunat/activar-produccion", json={"confirmacion": "PRODUCCION"})
    assert r.status_code == 200 and r.json()["entorno"] == "produccion" and r.json()["comprobantes"] == 0
    assert api.get("/caja/dia").json()["movimientos"] == []
    with db.Sesion() as s:
        e = ajustes.efectivo(s)
        assert (e.usuario, e.clave) == ("MIUSUARIO", "ClaveSOL1") and s.get(db.Serie, "03").ultimo == 0
    assert api.put("/ajustes/sunat", json={"ruc": "20131312955"}).status_code == 422
    r = api.put("/empresa", json={"ruc": "20131312955", "razon_social": "X SAC", "nombre_comercial": "X", "direccion": "Av 1", "ubigeo": "150101",
                                  "departamento": "L", "provincia": "L", "distrito": "L"})
    assert r.status_code == 422 and "producción" in r.json()["detail"]
    assert api.get("/clientes").json()
