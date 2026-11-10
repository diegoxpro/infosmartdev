package pe.elfirme.caja

import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test
import pe.elfirme.caja.data.AjustesConsultas
import pe.elfirme.caja.data.AjustesSunat
import pe.elfirme.caja.data.CajaDia
import pe.elfirme.caja.data.CertificadoInfo
import pe.elfirme.caja.data.ClienteGuardado
import pe.elfirme.caja.data.Comprobante
import pe.elfirme.caja.data.ControlSunat
import pe.elfirme.caja.data.Empresa
import pe.elfirme.caja.data.LineaDetalle
import pe.elfirme.caja.data.Movimiento
import pe.elfirme.caja.data.Servicio
import pe.elfirme.caja.ticket.ComponedorTicket
import pe.elfirme.caja.ui.AccesoContenido
import pe.elfirme.caja.ui.CajaContenido
import pe.elfirme.caja.ui.ClienteContenido
import pe.elfirme.caja.ui.ClientesContenido
import pe.elfirme.caja.ui.ConfigSunatContenido
import pe.elfirme.caja.ui.ConsultasContenido
import pe.elfirme.caja.ui.EstadoCliente
import pe.elfirme.caja.ui.EstadoConfigSunat
import pe.elfirme.caja.ui.DetalleContenido
import pe.elfirme.caja.ui.EmitirContenido
import pe.elfirme.caja.ui.EstadoEmitir
import pe.elfirme.caja.ui.SunatContenido
import pe.elfirme.caja.ui.TemaFirme

class PantallasTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5, showSystemUi = false, maxPercentDifference = 1.0)

    private val registroFalso = object : ActivityResultRegistryOwner {
        override val activityResultRegistry = object : ActivityResultRegistry() {
            override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) = Unit
        }
    }

    private fun lienzo(oscuro: Boolean = false, c: @Composable () -> Unit) = paparazzi.snapshot {
        CompositionLocalProvider(LocalActivityResultRegistryOwner provides registroFalso) {
            TemaFirme(oscuro) { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) { c() } }
        }
    }

    private val empresa = Empresa("20612345678", "AUTOLAVADO EL FIRME S.A.C.", "El Firme", "Av. Los Próceres 1240, Lima", telefono = "987 654 321", mensajeTicket = "Gracias por su preferencia", entorno = "produccion")
    private fun comprobante(estado: String, n: Int = 128, msg: String = "La Boleta numero B001-128, ha sido aceptada") = Comprobante(
        id = n, tipo = "03", serie = "B001", correlativo = n, numero = "B001-%08d".format(n), fecha = "2026-11-09", hora = "10:42",
        clienteTipoDoc = "1", clienteNumDoc = "45678912", clienteNombre = "MARÍA QUISPE HUAMÁN", placa = "ABC123", medioPago = "YAPE",
        total = "65.00", estado = estado, sunatCodigo = "2017", sunatMensaje = msg, intentos = 2, diasRestantes = 2, opGravada = "55.08", igv = "9.92",
        hash = "G/9iU3DsSXbsVGaWYLBDZOxtLrs=",
        letras = "SON SESENTA Y CINCO CON 00/100 SOLES",
        lineas = listOf(LineaDetalle("Lavado completo auto", "1", "35.00", "35.00"), LineaDetalle("Encerado", "1", "30.00", "30.00")),
    )
    private val servicios = listOf(
        Servicio(1, "L1", "Lavado exterior auto", "20.00"), Servicio(2, "L2", "Lavado completo auto", "35.00"),
        Servicio(3, "L3", "Lavado completo camioneta", "45.00"), Servicio(4, "L4", "Lavado de motor", "40.00"), Servicio(6, "O1", "Encerado", "30.00"),
    )
    private val dia = CajaDia(
        "2026-11-09", "842.50", "126.00", "716.50", mapOf("EFECTIVO" to "310.00", "TARJETA" to "120.00", "YAPE" to "286.50"),
        listOf(
            Movimiento(1, "ingreso", "Ventas", "B001-128", "65.00", "YAPE", "2026-11-09", "10:42", comprobanteId = 128),
            Movimiento(2, "gasto", "Insumos", "Shampoo y cera", "86.00", "EFECTIVO", "2026-11-09", "10:15"),
            Movimiento(3, "ingreso", "Ventas", "F001-31", "145.00", "TARJETA", "2026-11-09", "09:58", comprobanteId = 31),
        ),
    )

    @Test fun acceso() = lienzo { AccesoContenido("", {}, "", {}, "", {}, false, {}, null, false, {}) }

    private fun cajaUi() = @Composable { CajaContenido(dia, "Hoy · Lunes 9 de noviembre", false, {}, {}, {}, {}, {}, {}) }
    @Test fun caja() = lienzo(c = cajaUi())
    @Test fun cajaOscura() = lienzo(oscuro = true, c = cajaUi())

    @Test fun emitir() {
        val e = EstadoEmitir(servicios).apply { placa = "ABC123"; cantidades[2] = 1; cantidades[6] = 2 }
        lienzo { EmitirContenido(e, null, false, {}, {}, {}) }
    }

    @Test fun emitirClienteNoExiste() {
        val e = EstadoEmitir(servicios).apply { busqueda = "45678912"; resultados = emptyList() }
        lienzo { EmitirContenido(e, null, false, {}, {}, {}) }
    }

    @Test fun emitirResultados() {
        val e = EstadoEmitir(servicios).apply { busqueda = "que"; resultados = clientes }
        lienzo { EmitirContenido(e, null, false, {}, {}, {}) }
    }

    @Test fun emitirFacturaConCliente() {
        val e = EstadoEmitir(servicios).apply { factura = true; cantidades[3] = 1; elegir(clientes[1]) }
        lienzo { EmitirContenido(e, null, false, {}, {}, {}) }
    }

    @Test fun detalle() {
        val c = comprobante("ACEPTADO")
        val t = ComponedorTicket(null).componer(c, empresa, 576)
        lienzo { DetalleContenido(c, t, true, null, null, {}, {}, {}, {}) }
    }

    @Test fun rechazado() {
        val c = comprobante("RECHAZADO", msg = "El RUC del receptor no existe")
        lienzo { DetalleContenido(c, ComponedorTicket(null).componer(c, empresa, 576), true, null, null, {}, {}, {}, {}) }
    }

    @Test fun sunat() {
        val d = ControlSunat(
            "beta", mapOf("POR_ENVIAR" to 2, "ACEPTADO" to 184, "OBSERVADO" to 3, "RECHAZADO" to 1, "ANULADO" to 4),
            listOf(comprobante("POR_ENVIAR", 129, "Sin respuesta de SUNAT"), comprobante("RECHAZADO", 127, "El RUC del receptor no existe")),
        )
        lienzo { SunatContenido(d, null, false, {}, {}) }
    }

    private val clientes = listOf(
        ClienteGuardado(1, "1", "45678912", "MARÍA QUISPE HUAMÁN", telefono = "987654321", placa = "ABC123"),
        ClienteGuardado(2, "6", "20100066603", "TRANSPORTES LIMA NORTE S.A.C.", telefono = "912345678"),
    )

    @Test fun impuestos() = lienzo { pe.elfirme.caja.ui.ImpuestosContenido("20", {}, null, false) {} }

    @Test fun ticketExonerado() {
        val c = comprobante("ACEPTADO").copy(afectacion = "20", opGravada = "65.00", igv = "0.00")
        val b = ComponedorTicket(null).componer(c, empresa, 384)
        paparazzi.snapshot { TemaFirme(false) { androidx.compose.foundation.Image(b.asImageBitmap(), null) } }
    }

    @Test fun barra() = lienzo { pe.elfirme.caja.ui.BarraInferior("clientes") {} }

    @Test fun clientes() = lienzo { ClientesContenido("", {}, clientes, null, {}, {}) }

    @Test fun cliente() {
        val e = EstadoCliente(clientes[1])
        lienzo { ClienteContenido(e, null, "Atención: SUNAT lo reporta como ACTIVO · NO HABIDO", false, false, true, {}, {}, {}) }
    }

    @Test fun consultas() = lienzo {
        ConsultasContenido(AjustesConsultas(true, true, "ab12"), true, {}, "", {}, "Conexión correcta. Se consultó SUPERINTENDENCIA NACIONAL." to true, null, {}, {})
    }

    @Test fun configSunat() {
        val d = AjustesSunat("beta", "20612345678", "ELFIRME01", true, CertificadoInfo(true, true, "CN=AUTOLAVADO EL FIRME SAC", "2029-03-14", 850), 12)
        val e = EstadoConfigSunat().apply { ruc = d.ruc; usuario = d.usuario }
        lienzo { ConfigSunatContenido(d, e, null, null, {}, {}, {}, {}) }
    }

    @Test fun ticketLogoTermico() {
        val logo = android.graphics.Bitmap.createBitmap(400, 160, android.graphics.Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(logo).apply {
            val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            p.color = 0xFFFFC400.toInt()
            drawCircle(90f, 80f, 75f, p)
            p.color = 0xFF16181B.toInt()
            drawRect(60f, 40f, 75f, 120f, p)
            drawRect(60f, 40f, 125f, 55f, p)
            drawRect(60f, 72f, 115f, 86f, p)
            p.color = 0xFF1F4E9E.toInt()
            drawRect(190f, 50f, 380f, 110f, p)
        }
        val b = ComponedorTicket(null).componer(comprobante("ACEPTADO"), empresa, 384, logo, paraTermica = true)
        paparazzi.snapshot { TemaFirme(false) { androidx.compose.foundation.Image(b.asImageBitmap(), null) } }
    }

    @Test fun ticket58() {
        val b = ComponedorTicket(null).componer(comprobante("ACEPTADO"), empresa, 384)
        paparazzi.snapshot { TemaFirme(false) { androidx.compose.foundation.Image(b.asImageBitmap(), null) } }
    }
}
