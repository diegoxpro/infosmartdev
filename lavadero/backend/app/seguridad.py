"""Claves, tokens y limitación de intentos de acceso."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt

from .config import CFG

_N, _R, _P = 2**15, 8, 1
_MEM = 64 * 1024 * 1024


def hash_clave(clave: str) -> str:
    sal = os.urandom(16)
    d = hashlib.scrypt(clave.encode(), salt=sal, n=_N, r=_R, p=_P, maxmem=_MEM)
    return f"{base64.b64encode(sal).decode()}${base64.b64encode(d).decode()}"


def verificar_clave(clave: str, almacenado: str) -> bool:
    sal_b64, d_b64 = almacenado.split("$", 1)
    d = hashlib.scrypt(clave.encode(), salt=base64.b64decode(sal_b64), n=_N, r=_R, p=_P, maxmem=_MEM)
    return hmac.compare_digest(d, base64.b64decode(d_b64))


def crear_token(usuario_id: int, version: int) -> str:
    ahora = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(usuario_id), "v": version, "exp": ahora + timedelta(days=30)},
                      CFG.jwt_secreto, algorithm="HS256")


def leer_token(token: str) -> tuple[int, int] | None:
    try:
        datos = jwt.decode(token, CFG.jwt_secreto, algorithms=["HS256"])
        return int(datos["sub"]), int(datos["v"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


class Limitador:
    """Bloquea 15 minutos tras 5 fallos seguidos por usuario + IP."""

    MAX, VENTANA = 5, 900

    def __init__(self) -> None:
        self._fallos: dict[str, tuple[int, float]] = {}
        self._cerrojo = threading.Lock()

    def bloqueado(self, clave: str) -> bool:
        with self._cerrojo:
            n, t = self._fallos.get(clave, (0, 0.0))
            if time.monotonic() - t > self.VENTANA:
                self._fallos.pop(clave, None)
                return False
            return n >= self.MAX

    def fallo(self, clave: str) -> None:
        with self._cerrojo:
            n, _ = self._fallos.get(clave, (0, 0.0))
            self._fallos[clave] = (n + 1, time.monotonic())

    def exito(self, clave: str) -> None:
        with self._cerrojo:
            self._fallos.pop(clave, None)


limitador = Limitador()
