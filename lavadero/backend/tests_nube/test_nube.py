"""Modo nube: varias empresas, cada una con su base, gobernadas por el panel Infosmart (simulado).

Se ejecuta aparte de tests/ porque la configuración se lee del entorno al importar:
    python -m pytest tests_nube
"""
import base64
import os
import tempfile
import uuid

_dir = tempfile.mkdtemp()
os.environ.update(PANEL_URL="http://panel.prueba", CLAVE_INTERNA="interna", DOMINIO_BASE="ciardi.lat",
                  EMPRESA_DATABASE_URL=f"sqlite:///{_dir}/{{db}}.db", JWT_SECRETO="x" * 40, INTERVALO_WORKER_S="3600",
                  PANEL_CACHE_S="0", CERT_RUTA="/no/existe.pfx")

import bcrypt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from fastapi.testclient import TestClient

from app import contexto, db, decolecta, emision, nube
from app.main import app
from app.sunat import firma

HASH_A = bcrypt.hashpw(b"temporal-a1", bcrypt.gensalt(4)).decode()
HASH_B = bcrypt.hashpw(b"temporal-b1", bcrypt.gensalt(4)).decode()
cert = firma.certificado_prueba()
PFX = pkcs12.serialize_key_and_certificates(b"t", cert.clave, cert.cert, None,
                                            serialization.BestAvailableEncryption(b"cl"))


def ficha(sub, ruc, hash_, **extra):
    d = {"empresa": {"razonSocial": f"Empresa {sub} SAC", "ruc": ruc, "subdominio": sub},
         "plan": {"maxUsuarios": 2}, "acceso": {"permitido": True, "motivo": None},
         "baseDatos": f"lavadero_{sub}", "aprovisionado": False,
         "admin": {"usuario": "admin", "claveHash": hash_, "claveTemporal": True},
         "ajustes": {"sunatModo": "BETA", "solUsuario": None, "solClave": None, "certificado": None,
                     "certificadoClave": None, "consultaDocToken": None}}
    for k, v in extra.items():
        d[k] = v
    return d


PANEL = {"empresa1": ficha("empresa1", "20100070970", HASH_A), "empresa2": ficha("empresa2", "20131312955", HASH_B)}
LLAMADAS = []


def panel_falso(metodo, ruta, cuerpo=None):
    LLAMADAS.append((metodo, ruta, cuerpo))
    partes = ruta.strip("/").split("/")
    if partes[0] == "productos":
        return [{"subdominio": s} for s in PANEL]
    if len(partes) == 3:
        return PANEL.get(partes[1])
    return {"ok": True}


@pytest.fixture(autouse=True, scope="module")
def _panel():
    mp = pytest.MonkeyPatch()
    mp.setattr(nube, "_llamar", panel_falso)
    # Los avisos al panel se hacen en el acto para poder comprobarlos.
    mp.setattr(nube.threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: target()})())
    yield
    mp.undo()


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as cliente:
        yield cliente


def h(sub, token=None):
    d = {"host": f"{sub}.ciardi.lat:8093"}
    if token:
        d["authorization"] = f"Bearer {token}"
    return d


def entrar(c, sub, clave, usuario="admin"):
    r = c.post("/auth/login", json={"usuario": usuario, "clave": clave}, headers=h(sub))
    assert r.status_code == 200, r.text
    return r.json()["token"]


def datos_empresa(c, sub, token):
    """Completa la dirección fiscal (la carga la empresa en la app) y devuelve los datos guardados."""
    e = c.get("/empresa", headers=h(sub, token)).json()
    datos = {k: e[k] for k in ("ruc", "razon_social", "nombre_comercial", "direccion", "ubigeo", "departamento",
                               "provincia", "distrito", "telefono", "mensaje_ticket")}
    datos |= {"direccion": "AV. LOS PINOS 123", "ubigeo": "150101", "departamento": "LIMA", "provincia": "LIMA",
              "distrito": "LIMA"}
    r = c.put("/empresa", json=datos, headers=h(sub, token))
    assert r.status_code == 200, r.text
    return datos


def test_sin_empresa(c):
    assert c.get("/health").json() == {"ok": True}
    assert c.get("/me").status_code == 404
    assert c.get("/health", headers={"host": "noexiste.ciardi.lat"}).status_code == 404
    assert c.get("/me", headers={"host": "admin.ciardi.lat"}).status_code == 404


def test_aprovisiona_y_aisla(c):
    ta = entrar(c, "empresa1", "temporal-a1")
    tb = entrar(c, "empresa2", "temporal-b1")
    assert ("POST", "/empresas/empresa1/LAVADERO/reporte", {"aprovisionado": True}) in LLAMADAS
    # Bases separadas, cada una con el RUC y la razón social del panel
    assert c.get("/empresa", headers=h("empresa1", ta)).json()["ruc"] == "20100070970"
    e2 = c.get("/empresa", headers=h("empresa2", tb)).json()
    assert e2["ruc"] == "20131312955" and e2["razon_social"] == "EMPRESA EMPRESA2 SAC" and e2["nube"] is True
    assert os.path.exists(f"{_dir}/lavadero_empresa1.db") and os.path.exists(f"{_dir}/lavadero_empresa2.db")
    # Un token de una empresa no sirve en otra
    assert c.get("/me", headers=h("empresa2", ta)).status_code == 401
    # Cabecera X-Empresa para entrar por IP
    assert c.get("/me", headers={"host": "190.119.59.24:8093", "x-empresa": "empresa1",
                                 "authorization": f"Bearer {ta}"}).status_code == 200
    # Un cliente creado en una empresa no aparece en la otra
    c.post("/clientes", json={"tipo_doc": "1", "num_doc": "12345678", "nombre": "Juan"}, headers=h("empresa1", ta))
    assert len(c.get("/clientes", headers=h("empresa1", ta)).json()) == 1
    assert c.get("/clientes", headers=h("empresa2", tb)).json() == []


def test_ajustes_solo_desde_el_panel(c):
    ta = entrar(c, "empresa1", "temporal-a1")
    for metodo, ruta, cuerpo in [("PUT", "/ajustes/sunat", {"ruc": "20100070970"}),
                                 ("PUT", "/ajustes/sunat/certificado", {"archivo_b64": "eA==", "clave": "x"}),
                                 ("POST", "/ajustes/sunat/activar-produccion", {"confirmacion": "PRODUCCION"}),
                                 ("PUT", "/ajustes/consultas", {"activo": True, "token": "abc"})]:
        r = c.request(metodo, ruta, json=cuerpo, headers=h("empresa1", ta))
        assert r.status_code == 403, (ruta, r.text)
    aj = c.get("/ajustes/sunat", headers=h("empresa1", ta)).json()
    assert aj["nube"] is True and aj["entorno"] == "beta"
    # El RUC no se cambia desde la app
    datos = datos_empresa(c, "empresa1", ta)
    assert c.put("/empresa", json=datos | {"ruc": "20131312955"}, headers=h("empresa1", ta)).status_code == 422
    # Consulta DNI con el token del panel
    assert c.get("/ajustes/consultas", headers=h("empresa1", ta)).json()["activo"] is False
    PANEL["empresa1"]["ajustes"]["consultaDocToken"] = "token-del-panel-1234"
    nube.registro.olvidar("empresa1")
    vistos = []

    def consultar(token, numero):
        vistos.append(token)
        raise decolecta.ErrorConsulta("sin red en pruebas")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(decolecta, "consultar_dni", consultar)
        assert c.get("/consulta/dni/87654321", headers=h("empresa1", ta)).status_code == 422
    assert vistos == ["token-del-panel-1234"]
    assert c.get("/ajustes/consultas", headers=h("empresa1", ta)).json()["activo"] is True


def test_clave_y_limite_de_usuarios(c):
    ta = entrar(c, "empresa1", "temporal-a1")
    r = c.post("/usuarios", json={"usuario": "caja1", "nombre": "Caja", "clave": "clave-caja-1", "rol": "cajero"},
               headers=h("empresa1", ta))
    assert r.status_code == 200
    r = c.post("/usuarios", json={"usuario": "caja2", "nombre": "Caja", "clave": "clave-caja-2", "rol": "cajero"},
               headers=h("empresa1", ta))
    assert r.status_code == 422 and "2 usuarios" in r.json()["detail"]
    # El administrador cambia su clave temporal: se avisa al panel
    yo = c.get("/me", headers=h("empresa1", ta)).json()
    LLAMADAS.clear()
    r = c.patch(f"/usuarios/{yo['id']}", json={"clave": "mi-clave-nueva"}, headers=h("empresa1", ta))
    assert r.status_code == 200
    assert ("POST", "/empresas/empresa1/LAVADERO/reporte", {"claveCambiada": True}) in LLAMADAS
    assert c.get("/me", headers=h("empresa1", ta)).status_code == 401  # el token anterior caduca
    entrar(c, "empresa1", "mi-clave-nueva")
    # Infosmart genera una clave nueva desde el panel: reemplaza a la anterior
    PANEL["empresa1"]["admin"]["claveHash"] = bcrypt.hashpw(b"otra-temporal", bcrypt.gensalt(4)).decode()
    nube.registro.olvidar("empresa1")
    assert c.post("/auth/login", json={"usuario": "admin", "clave": "mi-clave-nueva"}, headers=h("empresa1")).status_code == 401
    entrar(c, "empresa1", "otra-temporal")


def test_suspendida(c):
    PANEL["empresa2"]["acceso"] = {"permitido": False, "motivo": "SUSPENDIDA"}
    nube.registro.olvidar("empresa2")
    r = c.get("/me", headers=h("empresa2"))
    assert r.status_code == 403 and "suspendida" in r.json()["detail"]
    PANEL["empresa2"]["acceso"] = {"permitido": True, "motivo": None}
    nube.registro.olvidar("empresa2")


class SunatFalso:
    def __init__(self):
        self.envios = []

    def enviar_comprobante(self, nombre, xml):
        self.envios.append(nombre)
        from app.sunat import cliente as sc
        return sc.Respuesta(aceptado=True, codigo="0", descripcion="La Boleta ha sido aceptada", cdr_zip=b"cdr")


def test_emision_y_produccion(c, monkeypatch):
    tb = entrar(c, "empresa2", "temporal-b1")
    datos_empresa(c, "empresa2", tb)
    falsos = {}

    def cliente(s):
        f = contexto.actual()
        e = emision.ajustes.efectivo(s)
        falsos.setdefault(f.subdominio, SunatFalso()).ent = (e.entorno, e.ruc, e.usuario)
        return falsos[f.subdominio]
    monkeypatch.setattr(emision, "cliente_sunat", cliente)
    venta = {"clave": str(uuid.uuid4()), "tipo": "03", "medio_pago": "EFECTIVO",
             "items": [{"codigo": "LAV01", "descripcion": "Lavado", "cantidad": "1", "precio": "20"}]}
    r = c.post("/comprobantes", json=venta, headers=h("empresa2", tb))
    assert r.status_code == 200, r.text
    assert falsos["empresa2"].ent == ("beta", "20131312955", "MODDATOS")
    assert falsos["empresa2"].envios == ["20131312955-03-B001-1"]
    # Infosmart pasa la empresa a producción: se borran las ventas de prueba y se reinicia la numeración
    PANEL["empresa2"]["ajustes"] |= {"sunatModo": "PRODUCCION", "solUsuario": "USUARIO1", "solClave": "clave-sol",
                                     "certificado": base64.b64encode(PFX).decode(), "certificadoClave": "cl"}
    nube.registro.olvidar("empresa2")
    assert c.get("/comprobantes", headers=h("empresa2", tb)).json() == []
    r = c.post("/comprobantes", json=venta | {"clave": str(uuid.uuid4())}, headers=h("empresa2", tb))
    assert r.json()["numero"] == "B001-00000001"
    assert falsos["empresa2"].ent == ("produccion", "20131312955", "USUARIO1")
    # La otra empresa sigue en pruebas
    ta = entrar(c, "empresa1", "otra-temporal")
    assert c.get("/ajustes/sunat", headers=h("empresa1", ta)).json()["entorno"] == "beta"


def test_trabajador_recorre_las_empresas():
    vistas = []
    nube.para_cada_empresa("prueba", lambda: vistas.append((contexto.subdominio(), db.Sesion().get(db.Empresa, 1).ruc)))
    assert sorted(vistas) == [("empresa1", "20100070970"), ("empresa2", "20131312955")]
