"""API de El Firme."""
from __future__ import annotations

import logging
import base64
import binascii
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Iterator

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import ajustes, contexto, db, decolecta, emision, nube, semilla, seguridad
from .config import CFG, TASA_IGV
from .emision import ErrorNegocio
from .sunat import firma, ubl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")


def _sembrar() -> None:
    with db.Sesion() as s:
        semilla.sembrar(s, admin_usuario=CFG.admin_usuario, admin_clave=CFG.admin_clave)


@asynccontextmanager
async def ciclo(_: FastAPI):
    if len(CFG.jwt_secreto) < 32:
        raise RuntimeError("JWT_SECRETO debe tener al menos 32 caracteres")
    if nube.ACTIVO:
        # Cada empresa se prepara en su primera petición (ver nube.Registro).
        if not (CFG.clave_interna and CFG.dominio_base and "{db}" in CFG.empresa_database_url):
            raise RuntimeError("En modo nube faltan CLAVE_INTERNA, DOMINIO_BASE o EMPRESA_DATABASE_URL con {db}")
    else:
        db.crear_tablas()
        _sembrar()
    trabajador = emision.Trabajador()
    trabajador.start()
    yield
    trabajador.parar.set()


app = FastAPI(title="El Firme", lifespan=ciclo, docs_url=None, redoc_url=None, openapi_url=None)
if nube.ACTIVO:
    app.add_middleware(nube.MiddlewareEmpresa)


@app.exception_handler(ErrorNegocio)
async def _negocio(_: Request, exc: ErrorNegocio) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(decolecta.ErrorConsulta)
async def _consulta(_: Request, exc: decolecta.ErrorConsulta) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


def sesion() -> Iterator[Session]:
    with db.Sesion() as s:
        yield s


S = Annotated[Session, Depends(sesion)]


def usuario_actual(request: Request, s: S) -> db.Usuario:
    cabecera = request.headers.get("authorization", "")
    datos = seguridad.leer_token(cabecera[7:], contexto.subdominio()) if cabecera.lower().startswith("bearer ") else None
    if datos is None:
        raise HTTPException(401, "Sesión no válida")
    u = s.get(db.Usuario, datos[0])
    if u is None or not u.activo or u.version_token != datos[1]:
        raise HTTPException(401, "Sesión no válida")
    return u


U = Annotated[db.Usuario, Depends(usuario_actual)]


def solo_admin(u: U) -> db.Usuario:
    if u.rol != "admin":
        raise HTTPException(403, "Solo un administrador puede hacer esto")
    return u


A = Annotated[db.Usuario, Depends(solo_admin)]


def solo_local() -> None:
    if contexto.actual() is not None:
        raise HTTPException(403, "Esto lo configura Infosmart desde su panel. Comunícate con Infosmart para cambiarlo.")


L = Depends(solo_local)


class LoginE(BaseModel):
    usuario: str
    clave: str


def _usuario(u: db.Usuario) -> dict:
    return {"id": u.id, "usuario": u.usuario, "nombre": u.nombre, "rol": u.rol, "activo": u.activo}


@app.get("/health")
def salud(s: S) -> dict:
    f = contexto.actual()
    return {"ok": True, "entorno": ajustes.efectivo(s).entorno, **({"empresa": f.razon_social} if f else {})}


@app.post("/auth/login")
def login(d: LoginE, request: Request, s: S) -> dict:
    ip = request.client.host if request.client else "?"
    clave_lim = f"{contexto.subdominio()}|{d.usuario.lower()}|{ip}"
    if seguridad.limitador.bloqueado(clave_lim):
        raise HTTPException(429, "Demasiados intentos. Espera 15 minutos.")
    u = s.execute(select(db.Usuario).where(db.Usuario.usuario == d.usuario.strip().lower())).scalar_one_or_none()
    if u is None or not u.activo or not seguridad.verificar_clave(d.clave, u.clave_hash):
        seguridad.limitador.fallo(clave_lim)
        raise HTTPException(401, "Usuario o clave incorrectos")
    seguridad.limitador.exito(clave_lim)
    return {"token": seguridad.crear_token(u.id, u.version_token, contexto.subdominio()), "usuario": _usuario(u)}


@app.get("/me")
def yo(u: U) -> dict:
    return _usuario(u)


# ---------- Empresa
class EmpresaE(BaseModel):
    # Los obligatorios se validan en la ruta, para responder con un mensaje claro.
    ruc: str = Field(default="", max_length=11)
    razon_social: str = Field(default="", max_length=200)
    nombre_comercial: str = Field(default="", max_length=200)
    direccion: str = Field(default="", max_length=250)
    ubigeo: str = Field(default="", max_length=6)
    departamento: str = Field(default="", max_length=60)
    provincia: str = Field(default="", max_length=60)
    distrito: str = Field(default="", max_length=60)
    telefono: str = ""
    mensaje_ticket: str = ""


def _empresa(e: db.Empresa) -> dict:
    return {c: getattr(e, c) for c in ("ruc", "razon_social", "nombre_comercial", "direccion", "ubigeo", "departamento",
                                       "provincia", "distrito", "telefono", "mensaje_ticket")}


@app.get("/empresa")
def empresa(_: U, s: S) -> dict:
    c = ajustes.obtener(s)
    return {**_empresa(s.get(db.Empresa, 1)), "entorno": ajustes.efectivo(s).entorno, "tasa_igv": TASA_IGV,
            "tiene_logo": c.logo is not None, "logo_version": c.logo_version, "nube": contexto.actual() is not None}


@app.put("/empresa")
def actualizar_empresa(d: EmpresaE, _: A, s: S) -> dict:
    if d.ruc != ajustes.RUC_BETA and not emision.ruc_valido(d.ruc):
        raise ErrorNegocio("Escribe un RUC válido de 11 dígitos.")
    if len(d.razon_social.strip()) < 2:
        raise ErrorNegocio("Escribe la razón social.")
    if not d.nombre_comercial.strip():
        raise ErrorNegocio("Escribe el nombre comercial.")
    if not emision.direccion_valida(d.direccion):
        raise ErrorNegocio("Escribe la dirección fiscal completa, como figura en tu ficha RUC.")
    if not (len(d.ubigeo) == 6 and d.ubigeo.isdigit()):
        raise ErrorNegocio("El ubigeo debe tener 6 dígitos.")
    if not (d.departamento.strip() and d.provincia.strip() and d.distrito.strip()):
        raise ErrorNegocio("Escribe el departamento, la provincia y el distrito.")
    e = s.get(db.Empresa, 1)
    if contexto.actual() is not None and d.ruc != e.ruc:
        raise ErrorNegocio("El RUC lo cambia Infosmart desde su panel.")
    if ajustes.efectivo(s).entorno == "produccion" and d.ruc != e.ruc:
        raise ErrorNegocio("El RUC no se puede cambiar en producción.")
    for k, v in d.model_dump().items():
        setattr(e, k, emision.normalizar(v) if k in {"razon_social", "direccion", "departamento", "provincia", "distrito"} else v)
    s.commit()
    return _empresa(e)


MAX_LOGO = 512 * 1024


@app.put("/empresa/logo")
async def subir_logo(request: Request, _: A, s: S) -> dict:
    contenido = await request.body()
    if len(contenido) > MAX_LOGO:
        raise ErrorNegocio("El logo es muy pesado. Usa una imagen de menos de 500 KB.")
    if contenido.startswith(b"\x89PNG\r\n\x1a\n"):
        tipo = "image/png"
    elif contenido.startswith(b"\xff\xd8\xff"):
        tipo = "image/jpeg"
    else:
        raise ErrorNegocio("El logo debe ser una imagen PNG o JPG.")
    c = ajustes.obtener(s)
    c.logo, c.logo_tipo = contenido, tipo
    c.logo_version += 1
    s.commit()
    return {"tiene_logo": True, "logo_version": c.logo_version}


@app.get("/empresa/logo")
def ver_logo(_: U, s: S) -> Response:
    c = ajustes.obtener(s)
    if c.logo is None:
        raise HTTPException(404, "Sin logo")
    return Response(c.logo, media_type=c.logo_tipo)


@app.delete("/empresa/logo")
def quitar_logo(_: A, s: S) -> dict:
    c = ajustes.obtener(s)
    c.logo, c.logo_tipo = None, ""
    c.logo_version += 1
    s.commit()
    return {"tiene_logo": False, "logo_version": c.logo_version}


# ---------- Ajustes de SUNAT y certificado
class SunatE(BaseModel):
    ruc: str = Field(pattern=r"^\d{11}$")
    usuario: str = Field(default="", max_length=40)
    clave: str = Field(default="", max_length=100)  # vacía = conservar la guardada


class CertificadoE(BaseModel):
    archivo_b64: str = Field(max_length=200_000)
    clave: str = Field(max_length=200)


class ActivarE(BaseModel):
    confirmacion: str


def _info_certificado(contenido: bytes, clave: str) -> dict:
    if not contenido:
        return {"cargado": False}
    try:
        cert = firma.cargar_bytes(contenido, clave).cert
    except ValueError:
        return {"cargado": True, "valido": False}
    vence = cert.not_valid_after_utc
    return {"cargado": True, "valido": True, "titular": cert.subject.rfc4514_string()[:200],
            "vence": vence.date().isoformat(), "dias_restantes": (vence - datetime.now(timezone.utc)).days}


def _ajustes_sunat(s: Session) -> dict:
    c = ajustes.obtener(s)
    e = ajustes.efectivo(s)
    f = contexto.actual()
    return {
        "entorno": e.entorno, "ruc": e.ruc, "nube": f is not None,
        "usuario": f.sol_usuario if f else c.sunat_usuario,
        "clave_guardada": bool(f.sol_clave) if f else bool(c.sunat_clave_cif),
        "certificado": _info_certificado(e.pfx, e.pfx_clave),
        "comprobantes": s.execute(select(func.count()).select_from(db.Comprobante)).scalar_one(),
    }


@app.get("/ajustes/sunat")
def ver_ajustes_sunat(_: A, s: S) -> dict:
    return _ajustes_sunat(s)


@app.put("/ajustes/sunat")
def guardar_ajustes_sunat(d: SunatE, _: A, s: S, __: None = L) -> dict:
    c = ajustes.obtener(s)
    e = ajustes.efectivo(s)
    if d.ruc != ajustes.RUC_BETA and not emision.ruc_valido(d.ruc):
        raise ErrorNegocio("El RUC no es válido.")
    if e.entorno == "produccion" and d.ruc != e.ruc:
        raise ErrorNegocio("El RUC no se puede cambiar en producción.")
    s.get(db.Empresa, 1).ruc = d.ruc
    c.sunat_usuario = d.usuario.strip().upper()
    if d.clave:
        c.sunat_clave_cif = ajustes.cifrar(d.clave.encode())
    s.commit()
    return _ajustes_sunat(s)


@app.put("/ajustes/sunat/certificado")
def subir_certificado(d: CertificadoE, _: A, s: S, __: None = L) -> dict:
    try:
        contenido = base64.b64decode(d.archivo_b64, validate=True)
    except binascii.Error as exc:
        raise ErrorNegocio("El archivo no se pudo leer.") from exc
    try:
        cert = firma.cargar_bytes(contenido, d.clave).cert
    except ValueError as exc:
        raise ErrorNegocio("El archivo o su contraseña no son correctos. Usa el certificado .pfx o .p12.") from exc
    if cert.not_valid_after_utc <= datetime.now(timezone.utc):
        raise ErrorNegocio("Este certificado ya venció.")
    c = ajustes.obtener(s)
    c.cert_pfx_cif, c.cert_clave_cif = ajustes.cifrar(contenido), ajustes.cifrar(d.clave.encode())
    s.commit()
    return _ajustes_sunat(s)


@app.post("/ajustes/sunat/activar-produccion")
def activar_produccion(d: ActivarE, _: A, s: S, __: None = L) -> dict:
    """Pasa a comprobantes reales. Borra las ventas y gastos de prueba y reinicia la numeración."""
    if d.confirmacion != "PRODUCCION":
        raise ErrorNegocio("Escribe PRODUCCION para confirmar.")
    c = ajustes.obtener(s)
    e = ajustes.efectivo(s)
    empresa = s.get(db.Empresa, 1)
    if e.entorno == "produccion":
        raise ErrorNegocio("Ya estás en producción.")
    faltan: list[str] = []
    if e.ruc == ajustes.RUC_BETA or not emision.ruc_valido(e.ruc):
        faltan.append("tu RUC real")
    if not c.sunat_usuario or not c.sunat_clave_cif:
        faltan.append("el usuario secundario y la clave SOL")
    info = _info_certificado(e.pfx, e.pfx_clave)
    if not info.get("valido") or info.get("dias_restantes", 0) < 1:
        faltan.append("un certificado CDT vigente")
    if not empresa.direccion.strip() or empresa.razon_social.strip() in ("", "EL FIRME"):
        faltan.append("la razón social y la dirección fiscal")
    if faltan:
        raise ErrorNegocio("Falta configurar: " + ", ".join(faltan) + ".")
    s.execute(delete(db.Movimiento))
    s.execute(delete(db.LineaComprobante))
    s.execute(delete(db.Comprobante))
    s.execute(update(db.Serie).values(ultimo=0))
    c.sunat_entorno = "produccion"
    s.commit()
    log.warning("Sistema activado en producción; datos de prueba eliminados")
    return _ajustes_sunat(s)


# ---------- Impuestos de las ventas
class VentasE(BaseModel):
    afectacion: str = Field(pattern="^(10|20|30)$")


@app.get("/ajustes/ventas")
def ver_ajustes_ventas(_: A, s: S) -> dict:
    return {"afectacion": ajustes.obtener(s).afectacion}


@app.put("/ajustes/ventas")
def guardar_ajustes_ventas(d: VentasE, _: A, s: S) -> dict:
    # Solo afecta a lo que se emita después: cada comprobante guarda su propia afectación.
    ajustes.obtener(s).afectacion = d.afectacion
    s.commit()
    return {"afectacion": d.afectacion}


# ---------- Ajustes de consultas DNI / RUC
class ConsultasE(BaseModel):
    activo: bool
    token: str = Field(default="", max_length=500)  # vacío = conservar el guardado


class ProbarE(BaseModel):
    token: str = Field(default="", max_length=500)


def _ajustes_consultas(s: Session) -> dict:
    activo, t = ajustes.consulta(s)
    return {"activo": activo, "token_guardado": bool(t), "token_final": t[-4:] if len(t) >= 12 else "",
            "nube": contexto.actual() is not None}


@app.get("/ajustes/consultas")
def ver_ajustes_consultas(_: A, s: S) -> dict:
    return _ajustes_consultas(s)


@app.put("/ajustes/consultas")
def guardar_ajustes_consultas(d: ConsultasE, _: A, s: S, __: None = L) -> dict:
    c = ajustes.obtener(s)
    c.decolecta_activo = d.activo
    if d.token.strip():
        c.decolecta_token_cif = ajustes.cifrar(d.token.strip().encode())
    s.commit()
    return _ajustes_consultas(s)


@app.post("/ajustes/consultas/probar")
def probar_consultas(d: ProbarE, _: A, s: S) -> dict:
    token = (d.token.strip() if contexto.actual() is None else "") or ajustes.consulta(s)[1]
    if not token:
        raise ErrorNegocio("Escribe el token de Decolecta.")
    # Consume una consulta del plan; se usa el RUC público de la SUNAT.
    p = decolecta.consultar_ruc(token, "20131312955")
    return {"ok": True, "resultado": p.nombre}


@app.get("/consulta/{tipo}/{numero}")
def consultar_documento(tipo: str, numero: str, _: U, s: S) -> dict:
    if tipo == "dni":
        if len(numero) != 8 or not numero.isdigit():
            raise ErrorNegocio("El DNI debe tener 8 dígitos.")
        tipo_doc = "1"
    elif tipo == "ruc":
        if not emision.ruc_valido(numero):
            raise ErrorNegocio("El RUC no es válido.")
        tipo_doc = "6"
    else:
        raise HTTPException(404, "Consulta no disponible")
    guardado = s.execute(select(db.Cliente).where(db.Cliente.tipo_doc == tipo_doc, db.Cliente.num_doc == numero)).scalar_one_or_none()
    if guardado is not None:
        return {**_cliente(guardado), "origen": "clientes"}
    activo, token = ajustes.consulta(s)
    if not activo or not token:
        raise HTTPException(409, "La consulta en línea no está configurada.")
    p = decolecta.consultar_dni(token, numero) if tipo == "dni" else decolecta.consultar_ruc(token, numero)
    return {"tipo_doc": p.tipo_doc, "num_doc": p.num_doc, "nombre": p.nombre, "direccion": p.direccion, "telefono": "",
            "placa": "", "estado": p.estado, "condicion": p.condicion, "origen": "decolecta"}


# ---------- Servicios
class ServicioE(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    precio: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    categoria: str = "Lavado"
    activo: bool = True


def _servicio(v: db.Servicio) -> dict:
    return {"id": v.id, "codigo": v.codigo, "nombre": v.nombre, "precio": str(v.precio), "categoria": v.categoria, "activo": v.activo}


@app.get("/servicios")
def servicios(_: U, s: S, todos: bool = False) -> list[dict]:
    q = select(db.Servicio).order_by(db.Servicio.orden, db.Servicio.id)
    if not todos:
        q = q.where(db.Servicio.activo.is_(True))
    return [_servicio(v) for v in s.execute(q).scalars()]


@app.post("/servicios")
def crear_servicio(d: ServicioE, _: A, s: S) -> dict:
    ultimo = s.execute(select(db.Servicio.id).order_by(db.Servicio.id.desc()).limit(1)).scalar() or 0
    v = db.Servicio(codigo=f"S{ultimo + 1:04d}", orden=ultimo + 1, **d.model_dump())
    s.add(v)
    s.commit()
    return _servicio(v)


@app.put("/servicios/{sid}")
def actualizar_servicio(sid: int, d: ServicioE, _: A, s: S) -> dict:
    v = s.get(db.Servicio, sid)
    if v is None:
        raise HTTPException(404, "Servicio no encontrado")
    for k, val in d.model_dump().items():
        setattr(v, k, val)
    s.commit()
    return _servicio(v)


# ---------- Clientes
class ClienteE(BaseModel):
    tipo_doc: str = Field(pattern="^(1|6)$")
    num_doc: str = Field(pattern=r"^\d{8}$|^\d{11}$")
    nombre: str = Field(min_length=2, max_length=200)
    direccion: str = Field(default="", max_length=250)
    telefono: str = Field(default="", max_length=20)
    placa: str = Field(default="", max_length=10)


def _cliente(c: db.Cliente) -> dict:
    return {"id": c.id, "tipo_doc": c.tipo_doc, "num_doc": c.num_doc, "nombre": c.nombre, "direccion": c.direccion,
            "telefono": c.telefono, "placa": c.placa}


def _aplicar_cliente(c: db.Cliente, d: ClienteE) -> None:
    if d.tipo_doc == "1" and len(d.num_doc) != 8:
        raise ErrorNegocio("El DNI debe tener 8 dígitos.")
    if d.tipo_doc == "6" and not emision.ruc_valido(d.num_doc):
        raise ErrorNegocio("El RUC no es válido.")
    telefono = "".join(ch for ch in d.telefono if ch.isdigit())
    if telefono and len(telefono) not in (9, 11):
        raise ErrorNegocio("El teléfono debe tener 9 dígitos.")
    if d.direccion.strip() and not emision.direccion_valida(d.direccion):
        raise ErrorNegocio("Escribe la dirección completa o déjala vacía.")
    c.tipo_doc, c.num_doc, c.nombre = d.tipo_doc, d.num_doc, emision.normalizar(d.nombre)
    c.direccion, c.telefono = emision.normalizar(d.direccion), telefono
    c.placa = d.placa.strip().upper().replace(" ", "")


@app.get("/clientes")
def clientes(_: U, s: S, q: str = Query(default="", max_length=60), limite: int = Query(100, le=300)) -> list[dict]:
    c = select(db.Cliente).order_by(db.Cliente.nombre).limit(limite)
    if q.strip():
        patron = f"%{q.strip().upper()}%"
        c = c.where(or_(db.Cliente.num_doc.like(patron), db.Cliente.nombre.like(patron), db.Cliente.placa.like(patron),
                        db.Cliente.telefono.like(patron)))
    return [_cliente(x) for x in s.execute(c).scalars()]


@app.get("/clientes/{cid}")
def ver_cliente(cid: int, _: U, s: S) -> dict:
    c = s.get(db.Cliente, cid)
    if c is None:
        raise HTTPException(404, "Cliente no encontrado")
    return _cliente(c)


def _guardar_cliente(s: Session, c: db.Cliente) -> dict:
    try:
        s.commit()
    except IntegrityError as exc:
        s.rollback()
        raise ErrorNegocio("Ya existe un cliente con ese documento.") from exc
    return _cliente(c)


@app.post("/clientes")
def crear_cliente(d: ClienteE, _: U, s: S) -> dict:
    c = db.Cliente()
    _aplicar_cliente(c, d)
    s.add(c)
    return _guardar_cliente(s, c)


@app.put("/clientes/{cid}")
def actualizar_cliente(cid: int, d: ClienteE, _: U, s: S) -> dict:
    c = s.get(db.Cliente, cid)
    if c is None:
        raise HTTPException(404, "Cliente no encontrado")
    _aplicar_cliente(c, d)
    return _guardar_cliente(s, c)


@app.delete("/clientes/{cid}")
def eliminar_cliente(cid: int, _: A, s: S) -> dict:
    # Los comprobantes guardan su propia copia de los datos: borrar el cliente no los altera.
    c = s.get(db.Cliente, cid)
    if c is None:
        raise HTTPException(404, "Cliente no encontrado")
    s.delete(c)
    s.commit()
    return {"ok": True}


# ---------- Comprobantes
class ItemE(BaseModel):
    codigo: str = Field(min_length=1, max_length=20)
    descripcion: str = Field(min_length=1, max_length=200)
    cantidad: Decimal = Field(gt=0, max_digits=8, decimal_places=2)
    precio: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class EmitirE(BaseModel):
    clave: str = Field(min_length=36, max_length=36)
    tipo: str
    cliente_tipo_doc: str = "0"
    cliente_num_doc: str = ""
    cliente_nombre: str = ""
    cliente_direccion: str = ""
    cliente_telefono: str = ""
    placa: str = ""
    medio_pago: str
    items: list[ItemE] = Field(min_length=1, max_length=50)


class AnularE(BaseModel):
    motivo: str = Field(min_length=3, max_length=100)


def _comprobante(c: db.Comprobante, detalle: bool = False) -> dict:
    d = {
        "id": c.id, "tipo": c.tipo, "serie": c.serie, "correlativo": c.correlativo, "numero": f"{c.serie}-{c.correlativo:08d}",
        "fecha": c.fecha.isoformat(), "hora": c.hora.strftime("%H:%M"), "cliente_tipo_doc": c.cliente_tipo_doc,
        "cliente_num_doc": c.cliente_num_doc, "cliente_nombre": c.cliente_nombre, "cliente_telefono": c.cliente_telefono,
        "placa": c.placa, "medio_pago": c.medio_pago, "afectacion": c.afectacion, "total": str(c.total), "estado": c.estado,
        "sunat_codigo": c.sunat_codigo, "sunat_mensaje": c.sunat_mensaje, "intentos": c.intentos,
        "dias_restantes": emision.dias_restantes(c.fecha) if c.estado == "POR_ENVIAR" else None,
    }
    if detalle:
        d |= {"cliente_direccion": c.cliente_direccion, "op_gravada": str(c.op_gravada), "igv": str(c.igv), "hash": c.hash,
              "tiene_cdr": c.cdr is not None, "cajero": c.usuario.nombre, "anulacion_motivo": c.anulacion_motivo,
              "letras": ubl.monto_en_letras(c.total),
              "lineas": [{"descripcion": l.descripcion, "cantidad": str(l.cantidad.normalize() + 0),
                          "precio_unitario": str(l.precio_unitario), "total": str(l.total)} for l in c.lineas]}
    return d


@app.post("/comprobantes")
def crear_comprobante(d: EmitirE, u: U, s: S) -> dict:
    items = [emision.ItemEntrada(i.codigo, i.descripcion, i.cantidad, i.precio) for i in d.items]
    try:
        cp = emision.emitir(s, u, d.clave, d.tipo, d.cliente_tipo_doc, d.cliente_num_doc, d.cliente_nombre,
                            d.cliente_direccion, d.cliente_telefono, d.placa, d.medio_pago, items)
        s.commit()
    except IntegrityError:
        # Dos solicitudes con la misma clave: gana la primera.
        s.rollback()
        cp = s.execute(select(db.Comprobante).where(db.Comprobante.clave == d.clave)).scalar_one()
    if cp.estado == "POR_ENVIAR" and cp.intentos == 0:
        emision.enviar(s, cp.id)
    return _comprobante(cp, detalle=True)


@app.get("/comprobantes")
def listar_comprobantes(_: U, s: S, q: str = "", tipo: str = "", estado: str = "", fecha: date | None = None,
                        limite: int = Query(50, le=200), desde_id: int | None = None) -> list[dict]:
    c = select(db.Comprobante).order_by(db.Comprobante.id.desc()).limit(limite)
    if tipo:
        c = c.where(db.Comprobante.tipo == tipo)
    if estado:
        c = c.where(db.Comprobante.estado.in_(estado.split(",")))
    if fecha:
        c = c.where(db.Comprobante.fecha == fecha)
    if desde_id:
        c = c.where(db.Comprobante.id < desde_id)
    if q.strip():
        p = f"%{q.strip().upper()}%"
        c = c.where(or_(db.Comprobante.cliente_nombre.like(p), db.Comprobante.cliente_num_doc.like(p),
                        db.Comprobante.placa.like(p), (db.Comprobante.serie + "-" + db.cast_correlativo()).like(p)))
    return [_comprobante(x) for x in s.execute(c).scalars()]


def _obtener(s: Session, cid: int) -> db.Comprobante:
    c = s.execute(select(db.Comprobante).options(selectinload(db.Comprobante.lineas)).where(db.Comprobante.id == cid)).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "Comprobante no encontrado")
    return c


@app.get("/comprobantes/{cid}")
def ver_comprobante(cid: int, _: U, s: S) -> dict:
    return _comprobante(_obtener(s, cid), detalle=True)


@app.post("/comprobantes/{cid}/reenviar")
def reenviar(cid: int, _: U, s: S) -> dict:
    c = _obtener(s, cid)
    if c.estado != "POR_ENVIAR":
        raise ErrorNegocio("Este comprobante ya tiene respuesta de SUNAT.")
    return _comprobante(emision.enviar(s, cid), detalle=True)


@app.post("/comprobantes/{cid}/anular")
def anular(cid: int, d: AnularE, _: A, s: S) -> dict:
    return _comprobante(emision.anular(s, cid, d.motivo), detalle=True)


@app.get("/comprobantes/{cid}/cdr")
def cdr(cid: int, _: U, s: S) -> Response:
    c = _obtener(s, cid)
    if c.cdr is None:
        raise HTTPException(404, "Aún no hay constancia")
    return Response(c.cdr, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="R-{c.serie}-{c.correlativo}.zip"'})


# ---------- Control SUNAT
@app.get("/sunat/control")
def control(_: U, s: S) -> dict:
    conteo: dict[str, int] = defaultdict(int)
    for (estado,) in s.execute(select(db.Comprobante.estado)):
        conteo[estado] += 1
    atender = s.execute(select(db.Comprobante).where(db.Comprobante.estado.in_(("POR_ENVIAR", "RECHAZADO", "ANULANDO")))
                        .order_by(db.Comprobante.fecha, db.Comprobante.id).limit(100)).scalars()
    return {"entorno": ajustes.efectivo(s).entorno, "conteo": conteo, "por_atender": [_comprobante(c) for c in atender]}


@app.post("/sunat/enviar-pendientes")
def enviar_ahora(_: U, s: S) -> dict:
    pendientes = s.execute(select(db.Comprobante.id).where(db.Comprobante.estado == "POR_ENVIAR")).scalars().all()
    for cid in pendientes:
        emision.enviar(s, cid)
    emision.consultar_anulaciones(s)
    return {"procesados": len(pendientes)}


# ---------- Caja
CATEGORIAS_GASTO = ["Insumos", "Sueldos", "Servicios básicos", "Alquiler", "Mantenimiento", "Otros"]
CATEGORIAS_INGRESO = ["Venta sin comprobante", "Otros ingresos"]


class MovimientoE(BaseModel):
    clave: str = Field(min_length=36, max_length=36)
    tipo: str = Field(pattern="^(ingreso|gasto)$")
    categoria: str = Field(min_length=2, max_length=40)
    descripcion: str = Field(default="", max_length=200)
    monto: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    medio_pago: str
    fecha: date | None = None


def _movimiento(m: db.Movimiento) -> dict:
    return {"id": m.id, "tipo": m.tipo, "categoria": m.categoria, "descripcion": m.descripcion, "monto": str(m.monto),
            "medio_pago": m.medio_pago, "fecha": m.fecha.isoformat(), "hora": m.hora.strftime("%H:%M"),
            "usuario": m.usuario.nombre, "comprobante_id": m.comprobante_id}


@app.get("/caja/categorias")
def categorias(_: U) -> dict:
    return {"gasto": CATEGORIAS_GASTO, "ingreso": CATEGORIAS_INGRESO, "medios": sorted(emision.MEDIOS)}


@app.get("/caja/dia")
def caja_dia(_: U, s: S, fecha: date | None = None) -> dict:
    dia = fecha or emision.ahora_lima().date()
    filas = s.execute(select(db.Movimiento).where(db.Movimiento.fecha == dia, db.Movimiento.anulado.is_(False))
                      .order_by(db.Movimiento.hora.desc(), db.Movimiento.id.desc())).scalars().all()
    ingresos = sum((m.monto for m in filas if m.tipo == "ingreso"), Decimal(0))
    gastos = sum((m.monto for m in filas if m.tipo == "gasto"), Decimal(0))
    medios: dict[str, Decimal] = defaultdict(Decimal)
    for m in filas:
        medios[m.medio_pago] += m.monto if m.tipo == "ingreso" else -m.monto
    return {"fecha": dia.isoformat(), "ingresos": str(ingresos), "gastos": str(gastos), "saldo": str(ingresos - gastos),
            "por_medio": {k: str(v) for k, v in sorted(medios.items())}, "movimientos": [_movimiento(m) for m in filas]}


@app.get("/caja/mes")
def caja_mes(_: U, s: S, anio: int = Query(ge=2020, le=2100), mes: int = Query(ge=1, le=12)) -> dict:
    inicio = date(anio, mes, 1)
    fin = date(anio + (mes == 12), mes % 12 + 1, 1)
    filas = s.execute(select(db.Movimiento).where(db.Movimiento.fecha >= inicio, db.Movimiento.fecha < fin,
                                                  db.Movimiento.anulado.is_(False))).scalars()
    dias: dict[date, dict[str, Decimal]] = defaultdict(lambda: {"ingreso": Decimal(0), "gasto": Decimal(0)})
    for m in filas:
        dias[m.fecha][m.tipo] += m.monto
    ing = sum((d["ingreso"] for d in dias.values()), Decimal(0))
    gas = sum((d["gasto"] for d in dias.values()), Decimal(0))
    return {"ingresos": str(ing), "gastos": str(gas), "saldo": str(ing - gas),
            "dias": [{"fecha": f.isoformat(), "ingresos": str(v["ingreso"]), "gastos": str(v["gasto"])}
                     for f, v in sorted(dias.items(), reverse=True)]}


@app.post("/movimientos")
def crear_movimiento(d: MovimientoE, u: U, s: S) -> dict:
    previo = s.execute(select(db.Movimiento).where(db.Movimiento.clave == d.clave)).scalar_one_or_none()
    if previo is not None:
        return _movimiento(previo)
    if d.medio_pago not in emision.MEDIOS:
        raise ErrorNegocio("Elige un medio de pago.")
    ahora = emision.ahora_lima()
    fecha = d.fecha or ahora.date()
    if fecha > ahora.date() or fecha < ahora.date() - timedelta(days=31):
        raise ErrorNegocio("La fecha debe estar dentro de los últimos 31 días.")
    m = db.Movimiento(clave=d.clave, tipo=d.tipo, categoria=d.categoria, descripcion=d.descripcion.strip(), monto=d.monto,
                      medio_pago=d.medio_pago, fecha=fecha, hora=ahora.time(), usuario_id=u.id)
    s.add(m)
    s.commit()
    return _movimiento(m)


@app.delete("/movimientos/{mid}")
def anular_movimiento(mid: int, _: A, s: S) -> dict:
    m = s.get(db.Movimiento, mid)
    if m is None:
        raise HTTPException(404, "Movimiento no encontrado")
    if m.comprobante_id is not None:
        raise ErrorNegocio("Este ingreso viene de un comprobante. Anula el comprobante.")
    m.anulado = True
    s.commit()
    return {"ok": True}


# ---------- Usuarios
class UsuarioE(BaseModel):
    usuario: str = Field(pattern=r"^[a-zA-Z0-9._-]{3,40}$")
    nombre: str = Field(min_length=2, max_length=100)
    clave: str = Field(min_length=8, max_length=128)
    rol: str = Field(pattern="^(admin|cajero)$")


class UsuarioCambioE(BaseModel):
    nombre: str | None = None
    clave: str | None = Field(default=None, min_length=8, max_length=128)
    rol: str | None = Field(default=None, pattern="^(admin|cajero)$")
    activo: bool | None = None


@app.get("/usuarios")
def usuarios(_: A, s: S) -> list[dict]:
    return [_usuario(u) for u in s.execute(select(db.Usuario).order_by(db.Usuario.nombre)).scalars()]


def _revisar_limite(s: Session) -> None:
    """Modo nube: el plan de Infosmart fija cuántos usuarios activos puede tener la empresa."""
    f = contexto.actual()
    if f is None:
        return
    activos = s.execute(select(func.count()).select_from(db.Usuario).where(db.Usuario.activo.is_(True))).scalar_one()
    if activos >= f.max_usuarios:
        raise ErrorNegocio(f"Tu plan permite {f.max_usuarios} usuarios activos. Desactiva uno o pide a Infosmart un plan mayor.")


@app.post("/usuarios")
def crear_usuario(d: UsuarioE, _: A, s: S) -> dict:
    _revisar_limite(s)
    u = db.Usuario(usuario=d.usuario.lower(), nombre=d.nombre, clave_hash=seguridad.hash_clave(d.clave), rol=d.rol)
    s.add(u)
    try:
        s.commit()
    except IntegrityError as exc:
        s.rollback()
        raise ErrorNegocio("Ese nombre de usuario ya existe.") from exc
    return _usuario(u)


@app.patch("/usuarios/{uid}")
def cambiar_usuario(uid: int, d: UsuarioCambioE, yo_: A, s: S) -> dict:
    u = s.get(db.Usuario, uid)
    if u is None:
        raise HTTPException(404, "Usuario no encontrado")
    if u.id == yo_.id and (d.activo is False or d.rol == "cajero"):
        raise ErrorNegocio("No puedes quitarte tu propio acceso de administrador.")
    if d.nombre:
        u.nombre = d.nombre
    if d.rol:
        u.rol = d.rol
    if d.clave:
        u.clave_hash = seguridad.hash_clave(d.clave)
        u.version_token += 1
    if d.activo is not None:
        if d.activo and not u.activo:
            _revisar_limite(s)
        u.activo = d.activo
        u.version_token += 1
    s.commit()
    f = contexto.actual()
    if d.clave and f is not None and u.usuario == f.admin_usuario and f.admin_temporal:
        nube.reportar(f.subdominio, claveCambiada=True)
        nube.registro.olvidar(f.subdominio)
    return _usuario(u)
