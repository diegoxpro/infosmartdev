"""Configuración efectiva: lo guardado desde la app manda; el entorno del servidor es el respaldo."""
from __future__ import annotations

import base64
import hashlib
import logging
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from . import contexto, db
from .config import CFG

log = logging.getLogger("ajustes")

# Credenciales públicas del ambiente de pruebas de SUNAT.
USUARIO_BETA, CLAVE_BETA = "MODDATOS", "moddatos"
RUC_BETA = "20000000001"


def _fernet() -> Fernet:
    base = CFG.clave_cifrado or CFG.jwt_secreto
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f"elfirme-cifrado:{base}".encode()).digest()))


def cifrar(valor: bytes) -> str:
    return _fernet().encrypt(valor).decode() if valor else ""


def descifrar(valor: str) -> bytes:
    if not valor:
        return b""
    try:
        return _fernet().decrypt(valor.encode())
    except InvalidToken:
        log.error("No se pudo descifrar un dato guardado: cambió la clave de cifrado")
        return b""


def obtener(s: Session) -> db.Configuracion:
    # La fila se crea al arrancar: aquí nunca debe abrirse una escritura que quede
    # sin confirmar mientras se espera a SUNAT o a Decolecta.
    c = s.get(db.Configuracion, 1)
    if c is None:
        raise RuntimeError("Falta la fila de configuración")
    return c


@dataclass(frozen=True)
class Efectivo:
    entorno: str
    ruc: str
    usuario: str
    clave: str
    pfx: bytes
    pfx_clave: str


def efectivo(s: Session) -> Efectivo:
    f = contexto.actual()
    if f is not None:
        # Modo nube: SUNAT y el certificado se administran solo desde el panel Infosmart.
        # «Desactivado» se trata como pruebas: los comprobantes van al ambiente beta.
        if f.sunat_modo == "PRODUCCION":
            return Efectivo("produccion", f.ruc, f.sol_usuario, f.sol_clave, f.certificado, f.certificado_clave)
        return Efectivo("beta", f.ruc, USUARIO_BETA, CLAVE_BETA, f.certificado, f.certificado_clave)
    c = obtener(s)
    empresa = s.get(db.Empresa, 1)
    entorno = c.sunat_entorno or CFG.sunat_entorno
    ruc = empresa.ruc if empresa else CFG.sunat_ruc
    if entorno == "beta":
        # Las credenciales reales cargadas de antemano nunca se envían al ambiente de pruebas.
        usuario, clave = USUARIO_BETA, CLAVE_BETA
    else:
        usuario = c.sunat_usuario or CFG.sunat_usuario
        clave = descifrar(c.sunat_clave_cif).decode() or CFG.sunat_clave
    return Efectivo(entorno, ruc, usuario, clave, descifrar(c.cert_pfx_cif), descifrar(c.cert_clave_cif).decode())


def consulta(s: Session) -> tuple[bool, str]:
    """(activa, token) de la consulta DNI/RUC en línea."""
    f = contexto.actual()
    if f is not None:
        return bool(f.consulta_token), f.consulta_token
    c = obtener(s)
    return c.decolecta_activo, descifrar(c.decolecta_token_cif).decode()
