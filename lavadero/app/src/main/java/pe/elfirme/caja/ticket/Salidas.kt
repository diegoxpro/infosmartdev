package pe.elfirme.caja.ticket

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import pe.elfirme.caja.data.Comprobante
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

data class ImpresoraBt(val nombre: String, val direccion: String)

object Impresion {
    private val SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** Convierte el ticket en comandos ESC/POS de imagen por bandas. */
    fun comandos(bmp: Bitmap): List<ByteArray> {
        val anchoBytes = (bmp.width + 7) / 8
        val pixeles = IntArray(bmp.width * bmp.height)
        bmp.getPixels(pixeles, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        val salida = mutableListOf(byteArrayOf(0x1B, 0x40))
        val altoBanda = 128
        var fila = 0
        while (fila < bmp.height) {
            val alto = minOf(altoBanda, bmp.height - fila)
            val b = ByteArrayOutputStream(anchoBytes * alto + 8)
            b.write(byteArrayOf(0x1D, 0x76, 0x30, 0x00))
            b.write(anchoBytes and 0xFF); b.write(anchoBytes shr 8)
            b.write(alto and 0xFF); b.write(alto shr 8)
            for (y in fila until fila + alto) {
                for (bx in 0 until anchoBytes) {
                    var valor = 0
                    for (bit in 0..7) {
                        val x = bx * 8 + bit
                        if (x < bmp.width) {
                            val p = pixeles[y * bmp.width + x]
                            val luz = (Color.red(p) * 299 + Color.green(p) * 587 + Color.blue(p) * 114) / 1000
                            if (luz < 150) valor = valor or (0x80 shr bit)
                        }
                    }
                    b.write(valor)
                }
            }
            salida += b.toByteArray()
            fila += alto
        }
        // Avanza el papel para poder cortarlo y activa la cuchilla si la ticketera la tiene.
        salida += byteArrayOf(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00)
        return salida
    }

    private suspend fun transmitir(destino: OutputStream, partes: List<ByteArray>) {
        for (p in partes) {
            var i = 0
            while (i < p.size) {
                val n = minOf(1024, p.size - i)
                destino.write(p, i, n)
                destino.flush()
                i += n
                delay(12)
            }
        }
        delay(400)
    }

    @SuppressLint("MissingPermission")
    fun emparejadas(c: Context): List<ImpresoraBt> {
        val adaptador = c.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return adaptador.bondedDevices.orEmpty().map { ImpresoraBt(it.name ?: it.address, it.address) }.sortedBy { it.nombre }
    }

    @SuppressLint("MissingPermission")
    suspend fun imprimirBluetooth(c: Context, direccion: String, bmp: Bitmap) = withContext(Dispatchers.IO) {
        val adaptador = c.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw IOException("Este equipo no tiene Bluetooth.")
        if (!adaptador.isEnabled) throw IOException("Activa el Bluetooth e inténtalo otra vez.")
        val socket = adaptador.getRemoteDevice(direccion).createRfcommSocketToServiceRecord(SPP)
        try {
            adaptador.cancelDiscovery()
            try {
                socket.connect()
            } catch (e: IOException) {
                throw IOException("No se pudo conectar. Revisa que la ticketera esté encendida y cerca.")
            }
            transmitir(socket.outputStream, comandos(bmp))
        } finally {
            runCatching { socket.close() }
        }
    }

    suspend fun imprimirRed(ip: String, bmp: Bitmap) = withContext(Dispatchers.IO) {
        Socket().use { s ->
            try {
                s.connect(InetSocketAddress(ip, 9100), 6000)
            } catch (e: IOException) {
                throw IOException("No se pudo conectar con la ticketera en $ip.")
            }
            transmitir(s.getOutputStream(), comandos(bmp))
        }
    }
}

object WhatsApp {
    private val PAQUETES = listOf("com.whatsapp", "com.whatsapp.w4b")

    private fun instalado(c: Context): String? = PAQUETES.firstOrNull {
        runCatching { @Suppress("DEPRECATION") c.packageManager.getPackageInfo(it, 0) }.isSuccess
    }

    /** Número peruano de 9 dígitos a formato internacional; devuelve null si no es válido. */
    fun normalizar(telefono: String): String? {
        val d = telefono.filter(Char::isDigit)
        return when {
            d.length == 9 && d.startsWith("9") -> "51$d"
            d.length == 11 && d.startsWith("51") -> d
            else -> null
        }
    }

    fun enviar(c: Context, pdf: File, comprobante: Comprobante, telefono: String, negocio: String) {
        val uri = FileProvider.getUriForFile(c, "${c.packageName}.archivos", pdf)
        val total = "S/ ${comprobante.total}"
        val texto = "Hola, le enviamos su ${comprobante.nombreTipo.lowercase()} ${comprobante.numero} " +
            "por $total de $negocio. ¡Gracias por su preferencia!"
        val intento = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, texto)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val paquete = instalado(c)
        if (paquete != null) {
            intento.setPackage(paquete)
            normalizar(telefono)?.let { intento.putExtra("jid", "$it@s.whatsapp.net") }
            c.startActivity(intento.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
            c.startActivity(
                Intent.createChooser(intento, "Enviar comprobante").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
