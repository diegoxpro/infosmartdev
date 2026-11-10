package pe.elfirme.caja.ticket

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import pe.elfirme.caja.R
import pe.elfirme.caja.data.Comprobante
import pe.elfirme.caja.data.Empresa
import pe.elfirme.caja.data.etiquetaMedio
import java.io.File
import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * Compone el comprobante como imagen. La misma imagen se imprime, se envía en PDF y se ve en pantalla,
 * así el cliente recibe exactamente lo que el cajero ve y no dependemos de las fuentes de la ticketera.
 */
class ComponedorTicket(contexto: Context?) {
    private val regular = fuente(contexto, 450)
    private val negrita = fuente(contexto, 700)
    private val dinero = DecimalFormat("#,##0.00", DecimalFormatSymbols(Locale.US))

    private fun fuente(c: Context?, peso: Int): Typeface = runCatching {
        // Typeface.Builder necesita un archivo para aplicar el peso de la fuente variable.
        val archivo = File(c!!.cacheDir, "archivo.ttf")
        if (!archivo.exists()) c.resources.openRawResource(R.font.archivo).use { e -> archivo.outputStream().use { e.copyTo(it) } }
        Typeface.Builder(archivo).setFontVariationSettings("'wght' $peso").build()
    }.getOrElse { if (peso >= 600) Typeface.DEFAULT_BOLD else Typeface.DEFAULT }

    /** [paraTermica] convierte el logo a puntos en blanco y negro, para que un logo a color no desaparezca en el papel. */
    fun componer(c: Comprobante, e: Empresa, puntos: Int, logo: Bitmap? = null, paraTermica: Boolean = false): Bitmap {
        val escala = puntos / 384f
        val margen = 6f * escala
        val ancho = puntos - margen * 2

        // Primero se mide con un lienzo sin salida; después se dibuja con la altura exacta.
        val medicion = Pintor(null, escala, margen, ancho, paraTermica)
        contenido(medicion, c, e, logo)
        val alto = medicion.y.toInt() + (24 * escala).toInt()

        val bmp = Bitmap.createBitmap(puntos, alto, Bitmap.Config.ARGB_8888)
        val lienzo = Canvas(bmp)
        lienzo.drawColor(Color.WHITE)
        contenido(Pintor(lienzo, escala, margen, ancho, paraTermica), c, e, logo)
        return bmp
    }

    /** Sobre fondo blanco, reescala los tonos del logo y aplica tramado Floyd-Steinberg. */
    private fun tramar(origen: Bitmap): Bitmap {
        val w = origen.width
        val h = origen.height
        val base = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(base).apply { drawColor(Color.WHITE); drawBitmap(origen, 0f, 0f, null) }
        val px = IntArray(w * h)
        base.getPixels(px, 0, w, 0, 0, w, h)
        val luz = FloatArray(w * h) { i ->
            val p = px[i]
            (Color.red(p) * 0.299f + Color.green(p) * 0.587f + Color.blue(p) * 0.114f)
        }
        val tintas = luz.filter { it < 245f }
        val minimo = tintas.minOrNull() ?: 0f
        val maximo = (tintas.maxOrNull() ?: 245f).coerceAtLeast(minimo + 1f)
        // El fondo sigue blanco; el tono más claro del logo queda en un gris que sí se imprime.
        for (i in luz.indices) if (luz[i] < 245f) luz[i] = (luz[i] - minimo) / (maximo - minimo) * 165f else luz[i] = 255f
        for (y in 0 until h) for (x in 0 until w) {
            val i = y * w + x
            val nuevo = if (luz[i] < 128f) 0f else 255f
            val error = luz[i] - nuevo
            luz[i] = nuevo
            if (x + 1 < w) luz[i + 1] += error * 7 / 16
            if (y + 1 < h) {
                if (x > 0) luz[i + w - 1] += error * 3 / 16
                luz[i + w] += error * 5 / 16
                if (x + 1 < w) luz[i + w + 1] += error * 1 / 16
            }
            px[i] = if (nuevo == 0f) Color.BLACK else Color.WHITE
        }
        base.setPixels(px, 0, w, 0, 0, w, h)
        return base
    }

    private fun m(v: String) = dinero.format(v.toBigDecimalOrNull() ?: BigDecimal.ZERO)

    private fun contenido(p: Pintor, c: Comprobante, e: Empresa, logo: Bitmap?) {
        if (e.entorno != "produccion") {
            p.bandaInvertida("PRUEBA · SIN VALOR TRIBUTARIO")
            p.espacio(10f)
        }
        if (logo != null) {
            p.imagen(logo)
            p.espacio(8f)
        } else {
            p.centro(e.nombreComercial.uppercase(), 42f, negrita)
        }
        p.centro(e.razonSocial, 18f, regular)
        p.centro("RUC ${e.ruc}", 20f, negrita)
        if (e.direccion.isNotBlank()) p.centro(e.direccion, 17f, regular)
        if (e.telefono.isNotBlank()) p.centro("Tel. ${e.telefono}", 17f, regular)
        p.espacio(10f)
        p.linea()
        p.espacio(8f)
        p.centro(if (c.esFactura) "FACTURA ELECTRÓNICA" else "BOLETA DE VENTA ELECTRÓNICA", 22f, negrita)
        p.centro(c.numero, 30f, negrita)
        p.espacio(8f)
        p.linea()
        p.espacio(8f)

        p.par("Fecha", "${c.fecha.split("-").reversed().joinToString("/")} ${c.hora}")
        if (c.placa.isNotBlank()) p.par("Placa", c.placa, valorFuerte = true)
        p.par("Pago", etiquetaMedio(c.medioPago))
        if (c.clienteTipoDoc != "0") {
            p.par(if (c.clienteTipoDoc == "6") "RUC" else "DNI", c.clienteNumDoc)
            p.parrafo(c.clienteNombre, 19f, regular)
            if (c.clienteDireccion.isNotBlank()) p.parrafo(c.clienteDireccion, 17f, regular)
        } else {
            p.par("Cliente", "Clientes varios")
        }
        p.espacio(8f)
        p.linea()
        p.espacio(8f)

        for (l in c.lineas) {
            p.parrafo(l.descripcion, 20f, negrita)
            p.par("${l.cantidad} x ${m(l.precioUnitario)}", m(l.total), tam = 20f)
            p.espacio(4f)
        }
        p.espacio(4f)
        p.linea()
        p.espacio(8f)
        p.par(c.etiquetaOperacion, "S/ ${m(c.opGravada)}")
        p.par(c.etiquetaIgv, "S/ ${m(c.igv)}")
        p.espacio(6f)
        p.par("TOTAL", "S/ ${m(c.total)}", tam = 34f, etiquetaFuerte = true, valorFuerte = true)
        p.espacio(6f)
        if (c.letras.isNotBlank()) p.parrafo(c.letras, 16f, regular)
        p.espacio(14f)

        val qr = "${e.ruc}|${c.tipo}|${c.serie}|${c.correlativo}|${c.igv}|${c.total}|${c.fecha}|" +
            "${c.clienteTipoDoc}|${c.clienteNumDoc}|${c.hash}|"
        p.qr(qr, 190f)
        p.espacio(10f)
        val nombre = if (c.esFactura) "Factura Electrónica" else "Boleta de Venta Electrónica"
        p.centroParrafo("Representación impresa de la $nombre", 16f, regular)
        p.centroParrafo("Consulta su validez en www.sunat.gob.pe", 16f, regular)
        if (c.hash.isNotBlank()) p.centroParrafo(c.hash, 14f, regular)
        if (e.mensajeTicket.isNotBlank()) {
            p.espacio(10f)
            p.centroParrafo(e.mensajeTicket, 19f, negrita)
        }
    }

    private inner class Pintor(
        val lienzo: Canvas?,
        val escala: Float,
        val margen: Float,
        val ancho: Float,
        val paraTermica: Boolean,
    ) {
        fun imagen(logo: Bitmap) {
            val proporcion = minOf(ancho * 0.72f / logo.width, 130f * escala / logo.height)
            val w = (logo.width * proporcion).toInt().coerceAtLeast(1)
            val h = (logo.height * proporcion).toInt().coerceAtLeast(1)
            if (lienzo != null) {
                val escalado = Bitmap.createScaledBitmap(logo, w, h, true)
                val final = if (paraTermica) tramar(escalado) else escalado
                lienzo.drawBitmap(final, margen + (ancho - w) / 2, y, null)
            }
            y += h
        }

        var y = 10f * escala
        private val pincel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

        private fun configurar(t: Float, f: Typeface) {
            pincel.textSize = t * escala
            pincel.typeface = f
        }

        private val altoLinea get() = pincel.fontSpacing

        fun espacio(d: Float) { y += d * escala }

        private fun dibujar(texto: String, x: Float) {
            lienzo?.drawText(texto, x, y - pincel.fontMetrics.ascent, pincel)
        }

        private fun partir(texto: String): List<String> {
            val salida = mutableListOf<String>()
            var actual = ""
            for (palabra in texto.split(" ")) {
                val prueba = if (actual.isEmpty()) palabra else "$actual $palabra"
                if (pincel.measureText(prueba) <= ancho) {
                    actual = prueba
                } else if (pincel.measureText(palabra) > ancho) {
                    if (actual.isNotEmpty()) salida += actual
                    actual = ""
                    var resto = palabra
                    while (resto.isNotEmpty()) {
                        val n = pincel.breakText(resto, true, ancho, null).coerceAtLeast(1)
                        salida += resto.take(n)
                        resto = resto.drop(n)
                    }
                } else {
                    salida += actual
                    actual = palabra
                }
            }
            if (actual.isNotEmpty()) salida += actual
            return salida
        }

        fun parrafo(t: String, tam: Float, f: Typeface) {
            configurar(tam, f)
            for (l in partir(t)) { dibujar(l, margen); y += altoLinea }
        }

        fun centro(t: String, tam: Float, f: Typeface) = centroParrafo(t, tam, f)

        fun centroParrafo(t: String, tam: Float, f: Typeface) {
            configurar(tam, f)
            for (l in partir(t)) {
                dibujar(l, margen + (ancho - pincel.measureText(l)) / 2)
                y += altoLinea
            }
        }

        fun par(
            etiqueta: String,
            valor: String,
            tam: Float = 19f,
            etiquetaFuerte: Boolean = false,
            valorFuerte: Boolean = false,
        ) {
            configurar(tam, if (etiquetaFuerte) negrita else regular)
            dibujar(etiqueta, margen)
            val h = altoLinea
            configurar(tam, if (valorFuerte) negrita else regular)
            dibujar(valor, margen + ancho - pincel.measureText(valor))
            y += h
        }

        fun linea() {
            pincel.strokeWidth = maxOf(1f, 2f * escala)
            lienzo?.drawLine(margen, y, margen + ancho, y, pincel)
            y += 2f * escala
        }

        fun bandaInvertida(t: String) {
            configurar(19f, negrita)
            val alto = altoLinea + 8f * escala
            lienzo?.drawRect(margen, y, margen + ancho, y + alto, pincel)
            pincel.color = Color.WHITE
            y += 4f * escala
            dibujar(t, margen + (ancho - pincel.measureText(t)) / 2)
            pincel.color = Color.BLACK
            y += alto - 4f * escala
        }

        fun qr(datos: String, lado: Float) {
            val px = (lado * escala).toInt()
            val x0 = margen + (ancho - px) / 2
            if (lienzo != null) {
                val pistas = mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.Q)
                val matriz = QRCodeWriter().encode(datos, BarcodeFormat.QR_CODE, px, px, pistas)
                for (i in 0 until matriz.width) for (j in 0 until matriz.height) {
                    if (matriz[i, j]) lienzo.drawRect(x0 + i, y + j, x0 + i + 1, y + j + 1, pincel)
                }
            }
            y += px
        }
    }
}

/** Guarda el ticket como PDF de una página, con el ancho físico del rollo. */
fun guardarPdf(contexto: Context, ticket: Bitmap, nombre: String, anchoMm: Int): File {
    val anchoPt = (anchoMm / 25.4f * 72f).toInt()
    val altoPt = (ticket.height * (anchoPt.toFloat() / ticket.width)).toInt()
    val doc = PdfDocument()
    val pagina = doc.startPage(PdfDocument.PageInfo.Builder(anchoPt, altoPt, 1).create())
    val rect = android.graphics.Rect(0, 0, anchoPt, altoPt)
    pagina.canvas.drawBitmap(ticket, null, rect, Paint(Paint.FILTER_BITMAP_FLAG))
    doc.finishPage(pagina)
    val carpeta = File(contexto.cacheDir, "comprobantes").apply { mkdirs() }
    val archivo = File(carpeta, "$nombre.pdf")
    archivo.outputStream().use { doc.writeTo(it) }
    doc.close()
    return archivo
}
