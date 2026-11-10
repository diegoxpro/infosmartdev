"""Reglas de emisión, envío a SUNAT, anulación y plazos."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import ajustes, contexto, db
from .config import CFG, LIMA
from .sunat import cliente as sc
from .sunat import firma, ubl

log = logging.getLogger("emision")

# Boletas de más de S/ 700 deben identificar al cliente (Reglamento de Comprobantes de Pago).
TOPE_BOLETA_ANONIMA = Decimal("700.00")
PLAZO_ENVIO_DIAS = 3
PLAZO_BAJA_DIAS = 7
ENVIO_BLOQUEO = timedelta(minutes=3)
MAX_REINTENTO_ESPERA = timedelta(minutes=30)
TIPOS = {"01": "F", "03": "B"}
MEDIOS = {"EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"}


class ErrorNegocio(Exception):
    """Regla incumplida; el mensaje se muestra tal cual al usuario."""


def normalizar(texto: str) -> str:
    """Mayúsculas y espacios simples: SUNAT observa saltos de línea, tabulaciones y espacios sobrantes."""
    return " ".join(texto.split()).upper()[:200]


def direccion_valida(texto: str) -> bool:
    return len(normalizar(texto)) >= 3


def ahora_lima() -> datetime:
    return datetime.now(LIMA).replace(tzinfo=None, microsecond=0)


def ruc_valido(ruc: str) -> bool:
    if len(ruc) != 11 or not ruc.isdigit() or ruc[:2] not in {"10", "15", "16", "17", "20"}:
        return False
    pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    r = 11 - sum(int(d) * p for d, p in zip(ruc, pesos)) % 11
    return int(ruc[10]) == (r - 10 if r >= 10 else r)


@dataclass(frozen=True)
class ItemEntrada:
    codigo: str
    descripcion: str
    cantidad: Decimal
    precio: Decimal


def _validar_cliente(tipo: str, tipo_doc: str, num_doc: str, nombre: str, total: Decimal) -> None:
    if tipo == "01":
        if tipo_doc != "6" or not ruc_valido(num_doc):
            raise ErrorNegocio("La factura necesita un RUC válido de 11 dígitos.")
        if not nombre.strip():
            raise ErrorNegocio("Escribe la razón social del cliente.")
        return
    if tipo_doc == "1" and (len(num_doc) != 8 or not num_doc.isdigit()):
        raise ErrorNegocio("El DNI debe tener 8 dígitos.")
    if tipo_doc == "6" and not ruc_valido(num_doc):
        raise ErrorNegocio("El RUC no es válido.")
    if total > TOPE_BOLETA_ANONIMA and tipo_doc == "0":
        raise ErrorNegocio("Las boletas de más de S/ 700 deben llevar el DNI y nombre del cliente.")
    if tipo_doc != "0" and not nombre.strip():
        raise ErrorNegocio("Escribe el nombre del cliente.")


def siguiente_correlativo(s: Session, tipo: str) -> tuple[str, int]:
    fila = s.execute(select(db.Serie).where(db.Serie.tipo == tipo).with_for_update()).scalar_one()
    fila.ultimo += 1
    return fila.serie, fila.ultimo


def emitir(s: Session, usuario: db.Usuario, clave: str, tipo: str, tipo_doc: str, num_doc: str, nombre: str,
           direccion: str, telefono: str, placa: str, medio: str, items: list[ItemEntrada]) -> db.Comprobante:
    """Registra el comprobante y su ingreso en una sola transacción. Reintentar con la misma clave es seguro."""
    previo = s.execute(select(db.Comprobante).where(db.Comprobante.clave == clave)).scalar_one_or_none()
    if previo is not None:
        return previo
    if tipo not in TIPOS:
        raise ErrorNegocio("Tipo de comprobante no válido.")
    if medio not in MEDIOS:
        raise ErrorNegocio("Elige un medio de pago.")
    if not items:
        raise ErrorNegocio("Agrega al menos un servicio.")
    if any(i.cantidad <= 0 or i.precio <= 0 for i in items):
        raise ErrorNegocio("Cantidad y precio deben ser mayores que cero.")

    empresa = s.get(db.Empresa, 1)
    if empresa is None or not direccion_valida(empresa.direccion):
        raise ErrorNegocio("Completa la dirección fiscal en Ajustes › Datos de la empresa.")
    if not (len(empresa.ruc) == 11 and empresa.razon_social and empresa.ubigeo and empresa.departamento and empresa.provincia and empresa.distrito):
        raise ErrorNegocio("Completa tus datos en Ajustes › Datos de la empresa.")

    afectacion = ajustes.obtener(s).afectacion
    lineas = [ubl.calcular_linea(i.codigo, i.descripcion, i.cantidad, i.precio, afectacion) for i in items]
    op, igv, total = (sum((getattr(l, c) for l in lineas), Decimal(0)) for c in ("base", "igv", "total"))

    num_doc = num_doc.strip()
    nombre = normalizar(nombre)
    direccion = normalizar(direccion) if direccion_valida(direccion) else ""
    if tipo == "03" and not num_doc:
        tipo_doc, num_doc, nombre = "0", "00000000", nombre or "CLIENTE VARIOS"
    _validar_cliente(tipo, tipo_doc, num_doc, nombre, total)

    placa = placa.strip().upper().replace(" ", "")
    momento = ahora_lima()
    serie, correlativo = siguiente_correlativo(s, tipo)
    cp = db.Comprobante(
        clave=clave, tipo=tipo, serie=serie, correlativo=correlativo, fecha=momento.date(), hora=momento.time(),
        cliente_tipo_doc=tipo_doc, cliente_num_doc=num_doc, cliente_nombre=nombre,
        cliente_direccion=direccion, cliente_telefono=telefono.strip(), placa=placa, medio_pago=medio,
        afectacion=afectacion, op_gravada=op, igv=igv, total=total, usuario_id=usuario.id,
        lineas=[db.LineaComprobante(codigo=l.codigo, descripcion=l.descripcion, cantidad=l.cantidad,
                                    precio_unitario=l.precio_unitario, base=l.base, igv=l.igv, total=l.total)
                for l in lineas],
    )
    s.add(cp)
    s.flush()
    s.add(db.Movimiento(clave=clave, tipo="ingreso", categoria="Ventas", descripcion=f"{serie}-{correlativo:08d}",
                        monto=total, medio_pago=medio, fecha=momento.date(), hora=momento.time(),
                        usuario_id=usuario.id, comprobante_id=cp.id))
    if tipo_doc != "0":
        _guardar_cliente(s, tipo_doc, num_doc, nombre, cp.cliente_direccion, cp.cliente_telefono, placa)
    return cp


def _guardar_cliente(s: Session, tipo_doc: str, num_doc: str, nombre: str, direccion: str, telefono: str, placa: str) -> None:
    c = s.execute(select(db.Cliente).where(db.Cliente.tipo_doc == tipo_doc, db.Cliente.num_doc == num_doc)).scalar_one_or_none()
    if c is None:
        s.add(db.Cliente(tipo_doc=tipo_doc, num_doc=num_doc, nombre=nombre, direccion=direccion, telefono=telefono, placa=placa))
        return
    c.nombre = nombre
    c.direccion = direccion or c.direccion
    c.telefono = telefono or c.telefono
    c.placa = placa or c.placa


# ---------------------------------------------------------------- SUNAT


def cliente_sunat(s: Session) -> sc.ClienteSunat:
    e = ajustes.efectivo(s)
    return sc.ClienteSunat(e.entorno, e.ruc, e.usuario, e.clave)


def _certificado(s: Session) -> firma.Certificado:
    e = ajustes.efectivo(s)
    if e.pfx:
        return firma.cargar_bytes(e.pfx, e.pfx_clave)
    if contexto.actual() is not None:
        # Modo nube: nunca se usa el certificado del servidor, que es de otra empresa.
        if e.entorno == "produccion":
            raise ErrorNegocio("Falta cargar el certificado digital en Infosmart.")
        return firma.certificado_prueba()
    return firma.cargar_certificado(CFG.cert_ruta, CFG.cert_clave)


def _emisor(s: Session) -> ubl.Emisor:
    e = s.get(db.Empresa, 1)
    if e is None:
        raise ErrorNegocio("Faltan los datos de la empresa.")
    return ubl.Emisor(e.ruc, e.razon_social, e.nombre_comercial, normalizar(e.direccion), e.ubigeo, e.departamento, e.provincia, e.distrito)


def _a_ubl(cp: db.Comprobante) -> ubl.Comprobante:
    lineas = [ubl.Linea(l.codigo, l.descripcion, l.cantidad, l.precio_unitario, l.base, l.igv, l.total) for l in cp.lineas]
    return ubl.Comprobante(cp.tipo, cp.serie, cp.correlativo, cp.fecha, cp.hora, cp.cliente_tipo_doc, cp.cliente_num_doc,
                           cp.cliente_nombre, cp.cliente_direccion, cp.op_gravada, cp.igv, cp.total, lineas, cp.afectacion)


def _reclamar(s: Session, cp_id: int) -> bool:
    """Toma el envío de forma atómica para que dos procesos no envíen el mismo documento."""
    ahora = ahora_lima()
    r = s.execute(
        update(db.Comprobante)
        .where(db.Comprobante.id == cp_id, db.Comprobante.estado == "POR_ENVIAR",
               (db.Comprobante.en_envio_desde.is_(None)) | (db.Comprobante.en_envio_desde < ahora - ENVIO_BLOQUEO))
        .values(en_envio_desde=ahora)
    )
    s.commit()
    return r.rowcount == 1


def enviar(s: Session, cp_id: int, cliente: sc.ClienteSunat | None = None) -> db.Comprobante:
    cp = s.get(db.Comprobante, cp_id)
    if cp is None:
        raise ErrorNegocio("Comprobante no encontrado.")
    if not _reclamar(s, cp_id):
        s.refresh(cp)
        return cp
    s.refresh(cp)
    try:
        em = _emisor(s)
        if cp.xml is None:
            raiz = ubl.comprobante_xml(_a_ubl(cp), em)
            cp.hash = firma.firmar(raiz, _certificado(s))
            cp.xml = firma.serializar(raiz)
            s.commit()
        nombre = f"{em.ruc}-{cp.tipo}-{cp.serie}-{cp.correlativo}"
        cp.intentos += 1
        cp.ultimo_intento = ahora_lima()
        r = (cliente or cliente_sunat(s)).enviar_comprobante(nombre, cp.xml)
        _aplicar(cp, r)
    except sc.ErrorTransitorio as exc:
        log.warning("Envío %s-%s pendiente: %s", cp.serie, cp.correlativo, exc)
        cp.sunat_mensaje = str(exc)
    except (OSError, ValueError, ErrorNegocio) as exc:
        log.error("No se pudo preparar %s-%s: %s", cp.serie, cp.correlativo, exc)
        cp.sunat_mensaje = f"No se pudo firmar: {exc}"
    finally:
        cp.en_envio_desde = None
        s.commit()
    return cp


def _aplicar(cp: db.Comprobante, r: sc.Respuesta) -> None:
    cp.sunat_codigo = r.codigo
    cp.sunat_mensaje = "; ".join([r.descripcion, *r.observaciones]) if r.observaciones else r.descripcion
    if r.cdr_zip:
        cp.cdr = r.cdr_zip
    if r.aceptado:
        cp.estado = "OBSERVADO" if r.observado else "ACEPTADO"
    elif r.codigo == "1033":
        # SUNAT ya lo tenía registrado: un envío anterior llegó aunque se perdió la respuesta.
        cp.estado = "ACEPTADO"
        cp.sunat_mensaje = "SUNAT confirma que ya estaba registrado."
    else:
        cp.estado = "RECHAZADO"


def enviar_pendientes(s: Session, cliente: sc.ClienteSunat | None = None) -> int:
    ids = s.execute(select(db.Comprobante.id, db.Comprobante.intentos, db.Comprobante.ultimo_intento)
                    .where(db.Comprobante.estado == "POR_ENVIAR").order_by(db.Comprobante.id)).all()
    ahora, enviados = ahora_lima(), 0
    for cp_id, intentos, ultimo in ids:
        espera = min(timedelta(minutes=2 ** min(intentos, 5)), MAX_REINTENTO_ESPERA)
        if ultimo is not None and ahora - ultimo < espera:
            continue
        enviar(s, cp_id, cliente)
        enviados += 1
    return enviados


def anular(s: Session, cp_id: int, motivo: str, cliente: sc.ClienteSunat | None = None) -> db.Comprobante:
    cp = s.execute(select(db.Comprobante).where(db.Comprobante.id == cp_id).with_for_update()).scalar_one_or_none()
    if cp is None:
        raise ErrorNegocio("Comprobante no encontrado.")
    motivo = motivo.strip().upper()
    if not motivo:
        raise ErrorNegocio("Escribe el motivo de la anulación.")

    if cp.estado == "RECHAZADO":
        # SUNAT no lo aceptó: no tiene validez y no requiere baja. Solo sale de la caja.
        cp.estado = "ANULADO"
        cp.anulacion_motivo = motivo
        _anular_ingreso(s, cp.id)
        s.commit()
        return cp
    if cp.estado == "ANULANDO":
        return cp
    if cp.estado not in {"ACEPTADO", "OBSERVADO"}:
        raise ErrorNegocio("Este comprobante todavía no ha sido aceptado por SUNAT. Envíalo primero.")
    if ahora_lima().date() > cp.fecha + timedelta(days=PLAZO_BAJA_DIAS):
        raise ErrorNegocio(f"Venció el plazo de {PLAZO_BAJA_DIAS} días para anular este comprobante.")

    prefijo = "RA" if cp.tipo == "01" else "RC"
    hoy = ahora_lima().date()
    usados = s.execute(select(func.count()).select_from(db.Comprobante).where(
        db.Comprobante.anulacion_id.like(f"{prefijo}-{hoy:%Y%m%d}-%"))).scalar_one()
    identificador = f"{prefijo}-{hoy:%Y%m%d}-{usados + 1}"
    em = _emisor(s)
    u = _a_ubl(cp)
    raiz = (ubl.baja_xml(identificador, cp.fecha, hoy, em, cp.tipo, cp.serie, cp.correlativo, motivo)
            if cp.tipo == "01" else ubl.resumen_anulacion_xml(identificador, u, hoy, em))
    firma.firmar(raiz, _certificado(s))
    try:
        ticket = (cliente or cliente_sunat(s)).enviar_resumen(f"{em.ruc}-{identificador}", firma.serializar(raiz))
    except sc.ErrorTransitorio as exc:
        raise ErrorNegocio(f"SUNAT no respondió. Inténtalo en unos minutos. ({exc})") from exc
    except ValueError as exc:
        raise ErrorNegocio(f"SUNAT rechazó la anulación: {exc}") from exc
    cp.estado = "ANULANDO"
    cp.anulacion_motivo = motivo
    cp.anulacion_id = identificador
    cp.anulacion_ticket = ticket
    _anular_ingreso(s, cp.id)
    s.commit()
    return cp


def _anular_ingreso(s: Session, cp_id: int) -> None:
    s.execute(update(db.Movimiento).where(db.Movimiento.comprobante_id == cp_id).values(anulado=True))


def consultar_anulaciones(s: Session, cliente: sc.ClienteSunat | None = None) -> None:
    filas = s.execute(select(db.Comprobante).where(db.Comprobante.estado == "ANULANDO")).scalars().all()
    for cp in filas:
        try:
            r = (cliente or cliente_sunat(s)).consultar_ticket(cp.anulacion_ticket)
        except sc.ErrorTransitorio as exc:
            log.warning("Ticket %s pendiente: %s", cp.anulacion_ticket, exc)
            continue
        if r is None:
            continue
        cp.sunat_codigo, cp.sunat_mensaje = r.codigo, r.descripcion
        if r.aceptado:
            cp.estado = "ANULADO"
        else:
            # La baja falló: el comprobante sigue vigente y el ingreso vuelve a la caja.
            cp.estado = "ACEPTADO"
            s.execute(update(db.Movimiento).where(db.Movimiento.comprobante_id == cp.id).values(anulado=False))
            cp.sunat_mensaje = f"Anulación rechazada: {r.codigo} {r.descripcion}"
        s.commit()


def dias_restantes(fecha: date) -> int:
    return (fecha + timedelta(days=PLAZO_ENVIO_DIAS) - ahora_lima().date()).days


class Trabajador(threading.Thread):
    """Reintenta en segundo plano los envíos pendientes y consulta tickets."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="worker-sunat")
        self.parar = threading.Event()

    def run(self) -> None:
        while not self.parar.wait(CFG.intervalo_worker_s):
            try:
                if CFG.panel_url:
                    from . import nube  # import tardío: nube depende de este módulo
                    nube.para_cada_empresa("envíos SUNAT", _ciclo)
                else:
                    _ciclo()
            except Exception:  # noqa: BLE001 - el trabajador nunca debe morir
                log.exception("Fallo en el ciclo de envíos")


def _ciclo() -> None:
    with db.Sesion() as s:
        enviar_pendientes(s)
        consultar_anulaciones(s)
