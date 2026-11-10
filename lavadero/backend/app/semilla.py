"""Datos iniciales de una base: empresa, configuración, series, administrador y servicios de ejemplo."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ajustes, db, emision, seguridad


def sembrar(s: Session, *, admin_usuario: str, admin_clave: str = "", admin_hash: str = "",
            ruc: str = "", razon_social: str = "") -> None:
    """Idempotente: solo crea lo que falta. Confirma la sesión al final."""
    if s.get(db.Empresa, 1) is None:
        nombre = emision.normalizar(razon_social)
        s.add(db.Empresa(id=1, ruc=ruc, razon_social=nombre, nombre_comercial=nombre, ubigeo="", departamento="",
                         provincia="", distrito="", mensaje_ticket=""))
    else:
        # Instalaciones anteriores: se quitan los valores de relleno mientras nadie haya cargado datos reales.
        e = s.get(db.Empresa, 1)
        if e.ruc == ajustes.RUC_BETA and e.razon_social == "EL FIRME" and not e.direccion.strip():
            e.ruc = e.razon_social = e.nombre_comercial = e.ubigeo = e.departamento = e.provincia = e.distrito = e.mensaje_ticket = ""
    c = s.get(db.Configuracion, 1)
    if c is None:
        c = db.Configuracion(id=1)
        s.add(c)
    for tipo, serie in (("01", "F001"), ("03", "B001")):
        if s.get(db.Serie, tipo) is None:
            s.add(db.Serie(tipo=tipo, serie=serie, ultimo=0))
    # Clientes registrados antes de estandarizar a mayúsculas.
    for cliente in s.execute(select(db.Cliente)).scalars():
        cliente.nombre = emision.normalizar(cliente.nombre)
        cliente.direccion = emision.normalizar(cliente.direccion)
    hay_usuarios = s.execute(select(db.Usuario.id).limit(1)).first() is not None
    if not hay_usuarios and (admin_clave or admin_hash):
        s.add(db.Usuario(usuario=admin_usuario.lower(), nombre="Administrador", rol="admin",
                         clave_hash=admin_hash or seguridad.hash_clave(admin_clave)))
        if admin_hash:
            c.nube_admin_hash = admin_hash
    if s.execute(select(db.Servicio.id).limit(1)).first() is None:
        base = [("LAV01", "Lavado exterior auto", "20.00", "Lavado"),
                ("LAV02", "Lavado completo auto", "35.00", "Lavado"),
                ("LAV03", "Lavado completo camioneta", "45.00", "Lavado"),
                ("LAV04", "Lavado de motor", "40.00", "Lavado"),
                ("LAV05", "Lavado de salón", "120.00", "Lavado"),
                ("OTR01", "Encerado", "30.00", "Otros"),
                ("OTR02", "Aspirado", "10.00", "Otros")]
        s.add_all(db.Servicio(codigo=c_, nombre=n, precio=Decimal(p), categoria=k, orden=i)
                  for i, (c_, n, p, k) in enumerate(base))
    s.commit()
