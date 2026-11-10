"""Configuración leída del entorno. Ningún secreto se versiona."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta, timezone

# Perú no aplica horario de verano: UTC-5 fijo.
LIMA = timezone(timedelta(hours=-5), "America/Lima")
TASA_IGV = 18


@dataclass(frozen=True)
class Config:
    database_url: str
    jwt_secreto: str
    sunat_entorno: str  # "beta" | "produccion"
    sunat_ruc: str
    sunat_usuario: str
    sunat_clave: str
    cert_ruta: str
    cert_clave: str
    admin_usuario: str
    admin_clave: str
    intervalo_worker_s: int
    clave_cifrado: str
    # Modo nube (Infosmart): con PANEL_URL cada subdominio es una empresa con su propia base.
    panel_url: str
    clave_interna: str
    empresa_database_url: str  # plantilla con {db}
    dominio_base: str
    panel_cache_s: int


def cargar() -> Config:
    e = os.environ.get
    return Config(
        database_url=e("DATABASE_URL", "sqlite:///./elfirme.db"),
        jwt_secreto=e("JWT_SECRETO", ""),
        sunat_entorno=e("SUNAT_ENTORNO", "beta"),
        sunat_ruc=e("SUNAT_RUC", "20000000001"),
        sunat_usuario=e("SUNAT_USUARIO", "MODDATOS"),
        sunat_clave=e("SUNAT_CLAVE", "moddatos"),
        cert_ruta=e("CERT_RUTA", "/secretos/certificado.pfx"),
        cert_clave=e("CERT_CLAVE", ""),
        admin_usuario=e("ADMIN_USUARIO", "admin"),
        admin_clave=e("ADMIN_CLAVE", ""),
        intervalo_worker_s=int(e("INTERVALO_WORKER_S", "60")),
        clave_cifrado=e("CLAVE_CIFRADO", ""),
        panel_url=e("PANEL_URL", "").rstrip("/"),
        clave_interna=e("CLAVE_INTERNA", ""),
        empresa_database_url=e("EMPRESA_DATABASE_URL", ""),
        dominio_base=e("DOMINIO_BASE", "").lower(),
        panel_cache_s=int(e("PANEL_CACHE_S", "30")),
    )


CFG = cargar()
