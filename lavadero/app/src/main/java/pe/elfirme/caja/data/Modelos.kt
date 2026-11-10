package pe.elfirme.caja.data

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

@Serializable
data class Usuario(val id: Int, val usuario: String, val nombre: String, val rol: String, val activo: Boolean = true) {
    val esAdmin get() = rol == "admin"
}

@Serializable data class Sesion(val token: String, val usuario: Usuario)

@Serializable
data class Empresa(
    val ruc: String = "",
    val razonSocial: String = "",
    val nombreComercial: String = "El Firme",
    val direccion: String = "",
    val ubigeo: String = "",
    val departamento: String = "",
    val provincia: String = "",
    val distrito: String = "",
    val telefono: String = "",
    val mensajeTicket: String = "",
    val entorno: String = "beta",
    val tieneLogo: Boolean = false,
    val logoVersion: Int = 0,
)

@Serializable
data class CertificadoInfo(
    val cargado: Boolean = false,
    val valido: Boolean = false,
    val titular: String = "",
    val vence: String = "",
    val diasRestantes: Int = 0,
)

@Serializable
data class AjustesSunat(
    val entorno: String,
    val ruc: String,
    val usuario: String = "",
    val claveGuardada: Boolean = false,
    val certificado: CertificadoInfo = CertificadoInfo(),
    val comprobantes: Int = 0,
) {
    val enProduccion get() = entorno == "produccion"
}

@Serializable
data class AjustesConsultas(val activo: Boolean = true, val tokenGuardado: Boolean = false, val tokenFinal: String = "")

@Serializable
data class AjustesVentas(val afectacion: String = "10")

@Serializable
data class ResultadoPrueba(val ok: Boolean = false, val resultado: String = "")

@Serializable
data class Servicio(
    val id: Int,
    val codigo: String,
    val nombre: String,
    val precio: String,
    val categoria: String = "Lavado",
    val activo: Boolean = true,
)

@Serializable
data class ClienteGuardado(
    val id: Int? = null,
    val tipoDoc: String,
    val numDoc: String,
    val nombre: String,
    val direccion: String = "",
    val telefono: String = "",
    val placa: String = "",
    val estado: String = "",
    val condicion: String = "",
    val origen: String = "",
) {
    val etiquetaDoc get() = if (tipoDoc == "6") "RUC" else "DNI"

    /** Aviso cuando SUNAT no reporta el RUC como activo y habido. */
    val alertaSunat: String?
        get() = when {
            estado.isBlank() && condicion.isBlank() -> null
            estado.equals("ACTIVO", true) && condicion.equals("HABIDO", true) -> null
            else -> "Atención: SUNAT lo reporta como $estado · $condicion"
        }
}

@Serializable
data class LineaDetalle(val descripcion: String, val cantidad: String, val precioUnitario: String, val total: String)

@Serializable
data class Comprobante(
    val id: Int,
    val tipo: String,
    val serie: String,
    val correlativo: Int,
    val numero: String,
    val fecha: String,
    val hora: String,
    val clienteTipoDoc: String = "0",
    val clienteNumDoc: String = "",
    val clienteNombre: String = "",
    val clienteTelefono: String = "",
    val placa: String = "",
    val medioPago: String = "",
    val afectacion: String = "10",
    val total: String,
    val estado: String,
    val sunatCodigo: String = "",
    val sunatMensaje: String = "",
    val intentos: Int = 0,
    val diasRestantes: Int? = null,
    val clienteDireccion: String = "",
    val opGravada: String = "0.00",
    val igv: String = "0.00",
    val hash: String = "",
    val tieneCdr: Boolean = false,
    val cajero: String = "",
    val anulacionMotivo: String = "",
    val letras: String = "",
    val lineas: List<LineaDetalle> = emptyList(),
) {
    val esFactura get() = tipo == "01"
    val nombreTipo get() = if (esFactura) "Factura" else "Boleta"
    val entregable get() = estado in setOf("POR_ENVIAR", "ACEPTADO", "OBSERVADO")
    val etiquetaOperacion get() = when (afectacion) {
        "20" -> "Op. exonerada"
        "30" -> "Op. inafecta"
        else -> "Op. gravada"
    }
    val etiquetaIgv get() = if (afectacion == "10") "IGV 18%" else "IGV"
}

@Serializable
data class Movimiento(
    val id: Int,
    val tipo: String,
    val categoria: String,
    val descripcion: String = "",
    val monto: String,
    val medioPago: String,
    val fecha: String,
    val hora: String,
    val usuario: String = "",
    val comprobanteId: Int? = null,
) {
    val esIngreso get() = tipo == "ingreso"
}

@Serializable
data class CajaDia(
    val fecha: String,
    val ingresos: String,
    val gastos: String,
    val saldo: String,
    val porMedio: Map<String, String> = emptyMap(),
    val movimientos: List<Movimiento> = emptyList(),
)

@Serializable data class DiaMes(val fecha: String, val ingresos: String, val gastos: String)

@Serializable
data class CajaMes(val ingresos: String, val gastos: String, val saldo: String, val dias: List<DiaMes> = emptyList())

@Serializable
data class Categorias(val gasto: List<String>, val ingreso: List<String>, val medios: List<String>)

@Serializable
data class ControlSunat(
    val entorno: String,
    val conteo: Map<String, Int> = emptyMap(),
    val porAtender: List<Comprobante> = emptyList(),
)

@Serializable
data class ItemEmitir(val codigo: String, val descripcion: String, val cantidad: String, val precio: String)

@Serializable
data class EmitirPedido(
    val clave: String,
    val tipo: String,
    val clienteTipoDoc: String,
    val clienteNumDoc: String,
    val clienteNombre: String,
    val clienteDireccion: String,
    val clienteTelefono: String,
    val placa: String,
    val medioPago: String,
    val items: List<ItemEmitir>,
)

@Serializable
data class MovimientoPedido(
    val clave: String,
    val tipo: String,
    val categoria: String,
    val descripcion: String,
    val monto: String,
    val medioPago: String,
)

private val FORMATO = DecimalFormat("#,##0.00", DecimalFormatSymbols(Locale.US))

fun soles(valor: String): String = soles(valor.toBigDecimalOrNull() ?: BigDecimal.ZERO)
fun soles(valor: BigDecimal): String {
    val texto = FORMATO.format(valor.abs())
    return if (valor.signum() < 0) "−S/ $texto" else "S/ $texto"
}

val MEDIOS_ETIQUETA = mapOf(
    "EFECTIVO" to "Efectivo",
    "YAPE" to "Yape",
    "PLIN" to "Plin",
    "TARJETA" to "Tarjeta",
    "TRANSFERENCIA" to "Transferencia",
)

fun etiquetaMedio(codigo: String) = MEDIOS_ETIQUETA[codigo] ?: codigo
