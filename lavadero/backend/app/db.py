"""Modelos y sesión de base de datos."""
from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, Time,
                        UniqueConstraint, cast, create_engine, inspect, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import CFG

_args: dict = {}
if CFG.database_url.startswith("sqlite"):
    _args = {"connect_args": {"check_same_thread": False}}
    if ":memory:" in CFG.database_url:
        _args["poolclass"] = StaticPool
motor = create_engine(CFG.database_url, pool_pre_ping=True, **_args)
Sesion = sessionmaker(motor, expire_on_commit=False)

Dinero = Numeric(12, 2)


class Base(DeclarativeBase):
    pass


class Empresa(Base):
    __tablename__ = "empresa"
    id: Mapped[int] = mapped_column(primary_key=True)
    ruc: Mapped[str] = mapped_column(String(11))
    razon_social: Mapped[str] = mapped_column(String(200))
    nombre_comercial: Mapped[str] = mapped_column(String(200), default="El Firme")
    direccion: Mapped[str] = mapped_column(String(250), default="")
    ubigeo: Mapped[str] = mapped_column(String(6), default="150101")
    departamento: Mapped[str] = mapped_column(String(60), default="LIMA")
    provincia: Mapped[str] = mapped_column(String(60), default="LIMA")
    distrito: Mapped[str] = mapped_column(String(60), default="LIMA")
    telefono: Mapped[str] = mapped_column(String(20), default="")
    mensaje_ticket: Mapped[str] = mapped_column(String(200), default="Gracias por su preferencia")


class Configuracion(Base):
    """Opciones editables desde la app. Los campos *_cif van cifrados y nunca salen del servidor."""

    __tablename__ = "configuracion"
    id: Mapped[int] = mapped_column(primary_key=True)
    logo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    logo_tipo: Mapped[str] = mapped_column(String(20), default="")
    logo_version: Mapped[int] = mapped_column(Integer, default=0)
    sunat_entorno: Mapped[str] = mapped_column(String(12), default="")
    sunat_usuario: Mapped[str] = mapped_column(String(40), default="")
    sunat_clave_cif: Mapped[str] = mapped_column(Text, default="")
    cert_pfx_cif: Mapped[str] = mapped_column(Text, default="")
    cert_clave_cif: Mapped[str] = mapped_column(Text, default="")
    decolecta_token_cif: Mapped[str] = mapped_column(Text, default="")
    decolecta_activo: Mapped[bool] = mapped_column(Boolean, default=True)
    afectacion: Mapped[str] = mapped_column(String(2), default="10", server_default="10")


class Usuario(Base):
    __tablename__ = "usuarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    usuario: Mapped[str] = mapped_column(String(40), unique=True)
    nombre: Mapped[str] = mapped_column(String(100))
    clave_hash: Mapped[str] = mapped_column(String(200))
    rol: Mapped[str] = mapped_column(String(10), default="cajero")  # admin | cajero
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # Se incrementa al cambiar la clave o desactivar: invalida los tokens anteriores.
    version_token: Mapped[int] = mapped_column(Integer, default=0)


class Servicio(Base):
    __tablename__ = "servicios"
    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20))
    nombre: Mapped[str] = mapped_column(String(120))
    precio: Mapped[Decimal] = mapped_column(Dinero)
    categoria: Mapped[str] = mapped_column(String(40), default="Lavado")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)


class Cliente(Base):
    __tablename__ = "clientes"
    __table_args__ = (UniqueConstraint("tipo_doc", "num_doc"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tipo_doc: Mapped[str] = mapped_column(String(1))
    num_doc: Mapped[str] = mapped_column(String(15))
    nombre: Mapped[str] = mapped_column(String(200))
    direccion: Mapped[str] = mapped_column(String(250), default="")
    telefono: Mapped[str] = mapped_column(String(20), default="")
    placa: Mapped[str] = mapped_column(String(10), default="", index=True)


class Serie(Base):
    __tablename__ = "series"
    tipo: Mapped[str] = mapped_column(String(2), primary_key=True)
    serie: Mapped[str] = mapped_column(String(4))
    ultimo: Mapped[int] = mapped_column(Integer, default=0)


class Comprobante(Base):
    __tablename__ = "comprobantes"
    __table_args__ = (UniqueConstraint("serie", "correlativo"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    clave: Mapped[str] = mapped_column(String(36), unique=True)  # idempotencia desde la app
    tipo: Mapped[str] = mapped_column(String(2))
    serie: Mapped[str] = mapped_column(String(4))
    correlativo: Mapped[int] = mapped_column(Integer)
    fecha: Mapped[date] = mapped_column(Date, index=True)
    hora: Mapped[time] = mapped_column(Time)
    cliente_tipo_doc: Mapped[str] = mapped_column(String(1))
    cliente_num_doc: Mapped[str] = mapped_column(String(15))
    cliente_nombre: Mapped[str] = mapped_column(String(200))
    cliente_direccion: Mapped[str] = mapped_column(String(250), default="")
    cliente_telefono: Mapped[str] = mapped_column(String(20), default="")
    placa: Mapped[str] = mapped_column(String(10), default="")
    medio_pago: Mapped[str] = mapped_column(String(20))
    afectacion: Mapped[str] = mapped_column(String(2), default="10", server_default="10")
    op_gravada: Mapped[Decimal] = mapped_column(Dinero)
    igv: Mapped[Decimal] = mapped_column(Dinero)
    total: Mapped[Decimal] = mapped_column(Dinero)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))

    estado: Mapped[str] = mapped_column(String(20), default="POR_ENVIAR", index=True)
    # POR_ENVIAR → ACEPTADO | OBSERVADO | RECHAZADO → ANULANDO → ANULADO
    hash: Mapped[str] = mapped_column(String(60), default="")
    xml: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    cdr: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    sunat_codigo: Mapped[str] = mapped_column(String(10), default="")
    sunat_mensaje: Mapped[str] = mapped_column(Text, default="")
    intentos: Mapped[int] = mapped_column(Integer, default=0)
    ultimo_intento: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    en_envio_desde: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    anulacion_motivo: Mapped[str] = mapped_column(String(100), default="")
    anulacion_id: Mapped[str] = mapped_column(String(30), default="")
    anulacion_ticket: Mapped[str] = mapped_column(String(40), default="")

    lineas: Mapped[list["LineaComprobante"]] = relationship(cascade="all, delete-orphan", order_by="LineaComprobante.id")
    usuario: Mapped[Usuario] = relationship()


class LineaComprobante(Base):
    __tablename__ = "lineas_comprobante"
    id: Mapped[int] = mapped_column(primary_key=True)
    comprobante_id: Mapped[int] = mapped_column(ForeignKey("comprobantes.id"), index=True)
    codigo: Mapped[str] = mapped_column(String(20))
    descripcion: Mapped[str] = mapped_column(String(200))
    cantidad: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    precio_unitario: Mapped[Decimal] = mapped_column(Dinero)
    base: Mapped[Decimal] = mapped_column(Dinero)
    igv: Mapped[Decimal] = mapped_column(Dinero)
    total: Mapped[Decimal] = mapped_column(Dinero)


class Movimiento(Base):
    __tablename__ = "movimientos"
    __table_args__ = (UniqueConstraint("clave"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    clave: Mapped[str] = mapped_column(String(36))
    tipo: Mapped[str] = mapped_column(String(10))  # ingreso | gasto
    categoria: Mapped[str] = mapped_column(String(40))
    descripcion: Mapped[str] = mapped_column(String(200), default="")
    monto: Mapped[Decimal] = mapped_column(Dinero)
    medio_pago: Mapped[str] = mapped_column(String(20))
    fecha: Mapped[date] = mapped_column(Date, index=True)
    hora: Mapped[time] = mapped_column(Time)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    comprobante_id: Mapped[int | None] = mapped_column(ForeignKey("comprobantes.id"), nullable=True)
    anulado: Mapped[bool] = mapped_column(Boolean, default=False)
    usuario: Mapped[Usuario] = relationship()
    comprobante: Mapped[Comprobante | None] = relationship()


def cast_correlativo():
    """Correlativo como texto, para buscar por número de comprobante."""
    return cast(Comprobante.correlativo, String)


def crear_tablas() -> None:
    Base.metadata.create_all(motor)
    # create_all no agrega columnas a tablas ya existentes.
    for tabla in ("comprobantes", "configuracion"):
        if "afectacion" not in {c["name"] for c in inspect(motor).get_columns(tabla)}:
            with motor.begin() as conexion:
                conexion.execute(text(f"ALTER TABLE {tabla} ADD COLUMN afectacion VARCHAR(2) NOT NULL DEFAULT '10'"))
