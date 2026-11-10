"""Modo nube (Infosmart): cada subdominio es una empresa con su propia base de datos.

El panel Infosmart dice qué base usar, si la empresa puede entrar, con qué administrador
se aprovisiona y sus credenciales de SUNAT y de consulta DNI/RUC, que solo se cambian allí.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import threading
import time
from contextlib import contextmanager
from typing import Callable, Iterator

import httpx
from sqlalchemy import create_engine, delete, select, update
from sqlalchemy.orm import sessionmaker
from starlette.concurrency import run_in_threadpool

from . import db, semilla
from .config import CFG
from .contexto import Ficha, empresa_actual

ACTIVO = bool(CFG.panel_url)
PRODUCTO = "LAVADERO"
log = logging.getLogger("nube")
logging.getLogger("httpx").setLevel(logging.WARNING)  # cada consulta al panel no necesita una línea

_SUB = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")
_RESERVADOS = {"admin", "api", "www", "panel"}


# ---------------------------------------------------------------- API interna del panel
def _llamar(metodo: str, ruta: str, cuerpo: dict | None = None):
    r = httpx.request(metodo, f"{CFG.panel_url}/api/interno{ruta}", json=cuerpo, timeout=8,
                      headers={"x-infosmart-clave": CFG.clave_interna})
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def _ficha_de(sub: str, d: dict) -> Ficha:
    a = d.get("ajustes") or {}
    try:
        pfx = base64.b64decode(a.get("certificado") or "", validate=True)
    except binascii.Error:
        log.error("%s: el certificado guardado en el panel no es base64 válido", sub)
        pfx = b""
    return Ficha(
        subdominio=sub,
        razon_social=d["empresa"]["razonSocial"],
        ruc=d["empresa"]["ruc"],
        acceso=bool(d["acceso"]["permitido"]),
        motivo=d["acceso"].get("motivo"),
        max_usuarios=int(d["plan"]["maxUsuarios"]),
        base_datos=d["baseDatos"],
        aprovisionado=bool(d["aprovisionado"]),
        admin_usuario=d["admin"]["usuario"].lower(),
        admin_hash=d["admin"]["claveHash"],
        admin_temporal=bool(d["admin"]["claveTemporal"]),
        sunat_modo=a.get("sunatModo") or "DESACTIVADO",
        sol_usuario=a.get("solUsuario") or "",
        sol_clave=a.get("solClave") or "",
        certificado=pfx,
        certificado_clave=a.get("certificadoClave") or "",
        consulta_token=a.get("consultaDocToken") or "",
    )


def reportar(sub: str, **datos: bool) -> None:
    """Avisa al panel en segundo plano (aprovisionada, clave temporal cambiada)."""
    def _enviar() -> None:
        try:
            _llamar("POST", f"/empresas/{sub}/{PRODUCTO}/reporte", datos)
        except Exception as exc:  # noqa: BLE001 - el aviso no debe romper la petición
            log.warning("%s: no se pudo avisar al panel: %s", sub, exc)
    threading.Thread(target=_enviar, daemon=True).start()


def empresas_activas() -> list[str]:
    return [e["subdominio"] for e in (_llamar("GET", f"/productos/{PRODUCTO}/empresas") or [])]


# ---------------------------------------------------------------- Registro de empresas
class Registro:
    """Fichas del panel (en caché unos segundos), conexiones por base y preparación de cada empresa."""

    def __init__(self) -> None:
        self._cerrojo = threading.Lock()
        self._por_empresa: dict[str, threading.Lock] = {}
        self._fichas: dict[str, tuple[Ficha | None, float]] = {}
        self._fabricas: dict[str, sessionmaker] = {}
        self._preparadas: set[str] = set()
        self._aplicada: dict[str, Ficha] = {}

    def _cerrojo_de(self, sub: str) -> threading.Lock:
        with self._cerrojo:
            return self._por_empresa.setdefault(sub, threading.Lock())

    def _ficha(self, sub: str) -> Ficha | None:
        previa = self._fichas.get(sub)
        if previa and previa[1] > time.monotonic():
            return previa[0]
        try:
            d = _llamar("GET", f"/empresas/{sub}/{PRODUCTO}")
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            if previa:  # el panel no responde: se sigue con la última ficha conocida
                log.warning("%s: panel no disponible (%s); se usa la ficha anterior", sub, exc)
                self._fichas[sub] = (previa[0], time.monotonic() + 5)
                return previa[0]
            raise
        f = _ficha_de(sub, d) if d else None
        self._fichas[sub] = (f, time.monotonic() + CFG.panel_cache_s)
        return f

    def olvidar(self, sub: str) -> None:
        self._fichas.pop(sub, None)

    def fabrica(self, f: Ficha) -> sessionmaker:
        with self._cerrojo:
            fab = self._fabricas.get(f.base_datos)
            if fab is None:
                if "{db}" not in CFG.empresa_database_url:
                    raise RuntimeError("Falta EMPRESA_DATABASE_URL con {db}, p. ej. postgresql+psycopg://u:c@db:5432/{db}")
                motor = create_engine(CFG.empresa_database_url.replace("{db}", f.base_datos), pool_pre_ping=True,
                                      pool_size=2, max_overflow=4, pool_recycle=1800)
                fab = self._fabricas[f.base_datos] = sessionmaker(motor, expire_on_commit=False)
            return fab

    def obtener(self, sub: str) -> Ficha | None:
        with self._cerrojo_de(sub):
            f = self._ficha(sub)
            if f is None:
                return None
            fab = self.fabrica(f)
            if sub not in self._preparadas:
                self._preparar(f, fab)
                self._preparadas.add(sub)
            if self._aplicada.get(sub) is not f:
                self._sincronizar(f, fab)
                self._aplicada[sub] = f
            return f

    def _preparar(self, f: Ficha, fab: sessionmaker) -> None:
        """Una vez por proceso y empresa: crea las tablas que falten y los datos iniciales."""
        inicio = time.monotonic()
        db.crear_tablas(fab.kw["bind"])
        with fab() as s:
            semilla.sembrar(s, admin_usuario=f.admin_usuario, admin_hash=f.admin_hash, ruc=f.ruc,
                            razon_social=f.razon_social)
        if not f.aprovisionado:
            reportar(f.subdominio, aprovisionado=True)
        log.info("%s: base %s lista en %d ms", f.subdominio, f.base_datos, (time.monotonic() - inicio) * 1000)

    def _sincronizar(self, f: Ficha, fab: sessionmaker) -> None:
        """Aplica lo que cambió en el panel: clave del administrador, RUC y paso a producción."""
        with fab() as s:
            c = s.get(db.Configuracion, 1)
            e = s.get(db.Empresa, 1)
            if c.nube_admin_hash != f.admin_hash:
                u = s.execute(select(db.Usuario).where(db.Usuario.usuario == f.admin_usuario)).scalar_one_or_none()
                if u is None:
                    s.add(db.Usuario(usuario=f.admin_usuario, nombre="Administrador", rol="admin", clave_hash=f.admin_hash))
                else:
                    u.clave_hash, u.rol, u.activo = f.admin_hash, "admin", True
                    u.version_token += 1
                c.nube_admin_hash = f.admin_hash
                log.info("%s: clave del administrador actualizada desde Infosmart", f.subdominio)
            if e.ruc != f.ruc:
                e.ruc = f.ruc
            if f.sunat_modo == "PRODUCCION" and c.sunat_entorno != "produccion":
                # Igual que «Activar producción» en la app: las ventas y gastos de prueba no son reales.
                s.execute(delete(db.Movimiento))
                s.execute(delete(db.LineaComprobante))
                s.execute(delete(db.Comprobante))
                s.execute(update(db.Serie).values(ultimo=0))
                c.sunat_entorno = "produccion"
                log.warning("%s: activada en producción desde Infosmart; datos de prueba eliminados", f.subdominio)
            s.commit()


registro = Registro()


@contextmanager
def en_empresa(f: Ficha) -> Iterator[None]:
    t1 = empresa_actual.set(f)
    t2 = db.fabrica_actual.set(registro.fabrica(f))
    try:
        yield
    finally:
        db.fabrica_actual.reset(t2)
        empresa_actual.reset(t1)


def para_cada_empresa(nombre: str, fn: Callable[[], None]) -> None:
    """Corre `fn` dentro de cada empresa activa, una tras otra (tareas en segundo plano)."""
    try:
        subs = empresas_activas()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s: no se pudo listar las empresas: %s", nombre, exc)
        return
    for sub in subs:
        try:
            f = registro.obtener(sub)
            if f is not None and f.acceso:
                with en_empresa(f):
                    fn()
        except Exception:  # noqa: BLE001 - una empresa con problemas no detiene a las demás
            log.exception("%s en %s", nombre, sub)


# ---------------------------------------------------------------- Middleware
def subdominio_de(host: str) -> str | None:
    host = host.split(",")[0].strip().lower()
    host = host.rsplit(":", 1)[0] if not host.endswith("]") else host
    if not CFG.dominio_base or not host.endswith("." + CFG.dominio_base):
        return None
    sub = host[: -len(CFG.dominio_base) - 1]
    return sub if _SUB.match(sub) and sub not in _RESERVADOS else None


_MENSAJES = {
    "SUSPENDIDA": "La cuenta de esta empresa está suspendida. Comunícate con Infosmart para reactivarla.",
    "VENCIDA": "La suscripción de esta empresa venció. Comunícate con Infosmart para renovarla.",
}


class MiddlewareEmpresa:
    """Atiende cada petición con la empresa de su subdominio (o de la cabecera X-Empresa)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        cab = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        sub = subdominio_de(cab.get("x-forwarded-host") or cab.get("host", ""))
        if sub is None:
            pedido = cab.get("x-empresa", "").strip().lower()
            sub = pedido if _SUB.match(pedido) and pedido not in _RESERVADOS else None
        if sub is None:
            if scope["path"] == "/health":
                await _responder(send, 200, {"ok": True})
            else:
                await _responder(send, 404, {"detail": "Escribe el código de tu empresa."})
            return
        try:
            f = await run_in_threadpool(registro.obtener, sub)
        except Exception:  # noqa: BLE001
            log.exception("%s: no se pudo cargar la empresa", sub)
            await _responder(send, 503, {"detail": "No pudimos cargar tu empresa. Inténtalo de nuevo en un momento."})
            return
        if f is None:
            await _responder(send, 404, {"detail": f"No existe una empresa con el código {sub}."})
            return
        if not f.acceso:
            await _responder(send, 403, {"detail": _MENSAJES.get(f.motivo or "", _MENSAJES["SUSPENDIDA"])})
            return
        with en_empresa(f):
            await self.app(scope, receive, send)


async def _responder(send, estado: int, cuerpo: dict) -> None:
    datos = json.dumps(cuerpo, ensure_ascii=False).encode()
    await send({"type": "http.response.start", "status": estado,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(datos)).encode())]})
    await send({"type": "http.response.body", "body": datos})
