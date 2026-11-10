"""Empresa que se está atendiendo en modo nube (Infosmart). Sin dependencias, para evitar ciclos."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class Ficha:
    """Lo que el panel Infosmart dice de una empresa: acceso, base de datos, administrador y credenciales."""

    subdominio: str
    razon_social: str
    ruc: str
    acceso: bool
    motivo: str | None
    max_usuarios: int
    base_datos: str
    aprovisionado: bool
    admin_usuario: str
    admin_hash: str
    admin_temporal: bool
    sunat_modo: str  # DESACTIVADO | BETA | PRODUCCION
    sol_usuario: str
    sol_clave: str
    certificado: bytes
    certificado_clave: str
    consulta_token: str


empresa_actual: ContextVar[Ficha | None] = ContextVar("empresa_actual", default=None)


def actual() -> Ficha | None:
    return empresa_actual.get()


def subdominio() -> str:
    f = empresa_actual.get()
    return f.subdominio if f else ""
