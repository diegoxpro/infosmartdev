"""Consulta de DNI (RENIEC) y RUC (SUNAT) mediante la API de Decolecta."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

URL_BASE = "https://api.decolecta.com/v1"
TIMEOUT = httpx.Timeout(15.0, connect=8.0)
# Punto de inyección para las pruebas.
transporte: httpx.BaseTransport | None = None


class ErrorConsulta(Exception):
    """El mensaje se muestra tal cual al usuario."""


@dataclass(frozen=True)
class Persona:
    tipo_doc: str
    num_doc: str
    nombre: str
    direccion: str = ""
    estado: str = ""
    condicion: str = ""


def _pedir(token: str, ruta: str, numero: str, que: str) -> dict:
    try:
        with httpx.Client(timeout=TIMEOUT, transport=transporte) as http:
            r = http.get(f"{URL_BASE}{ruta}", params={"numero": numero},
                         headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    except httpx.HTTPError as exc:
        raise ErrorConsulta("Decolecta no respondió. Inténtalo en unos segundos.") from exc
    if r.status_code in (401, 403):
        raise ErrorConsulta("Decolecta rechazó el token. Revísalo en Ajustes › Consulta DNI y RUC.")
    if r.status_code == 429:
        raise ErrorConsulta("Se agotaron las consultas de tu plan de Decolecta.")
    if r.status_code in (400, 404, 422):
        raise ErrorConsulta(f"No se encontró ese {que}.")
    if r.status_code != 200:
        raise ErrorConsulta(f"Decolecta respondió con un error ({r.status_code}).")
    try:
        datos = r.json()
    except ValueError as exc:
        raise ErrorConsulta("Decolecta devolvió una respuesta ilegible.") from exc
    if not isinstance(datos, dict):
        raise ErrorConsulta("Decolecta devolvió una respuesta ilegible.")
    return datos


def consultar_dni(token: str, numero: str) -> Persona:
    d = _pedir(token, "/reniec/dni", numero, "DNI")
    nombre = str(d.get("full_name") or "").strip()
    if not nombre:
        raise ErrorConsulta("No se encontró ese DNI.")
    return Persona("1", numero, nombre.upper())


def consultar_ruc(token: str, numero: str) -> Persona:
    d = _pedir(token, "/sunat/ruc", numero, "RUC")
    nombre = str(d.get("razon_social") or "").strip()
    if not nombre:
        raise ErrorConsulta("No se encontró ese RUC.")
    partes = [str(d.get(c) or "").strip() for c in ("direccion", "distrito", "provincia", "departamento")]
    direccion = " ".join(p for p in partes if p and p != "-")
    return Persona("6", numero, nombre.upper(), direccion, str(d.get("estado") or ""), str(d.get("condicion") or ""))
