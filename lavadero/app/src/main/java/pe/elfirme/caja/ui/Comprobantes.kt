package pe.elfirme.caja.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.Comprobante
import pe.elfirme.caja.data.Empresa
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.Preferencias
import pe.elfirme.caja.data.Usuario
import pe.elfirme.caja.data.soles
import pe.elfirme.caja.ticket.ComponedorTicket
import pe.elfirme.caja.ticket.Impresion
import pe.elfirme.caja.ticket.WhatsApp
import pe.elfirme.caja.ticket.guardarPdf
import java.io.IOException

private val FILTROS = listOf("" to "Todos", "ACEPTADO,OBSERVADO" to "Aceptados", "POR_ENVIAR" to "Por enviar", "RECHAZADO" to "Rechazados", "ANULADO,ANULANDO" to "Anulados")

@Composable
fun PantallaComprobantes(api: Api, onEmitir: () -> Unit, onAbrir: (Int) -> Unit) {
    var q by remember { mutableStateOf("") }
    var estado by remember { mutableStateOf("") }
    var lista by remember { mutableStateOf<List<Comprobante>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }

    LaunchedEffect(q, estado, recarga) {
        if (q.isNotEmpty()) delay(300)
        error = null
        try { lista = api.comprobantes(q, "", estado) } catch (e: ErrorApi) { error = e.message }
    }

    Column(Modifier.fillMaxSize()) {
        Barra("Comprobantes")
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Campo(q, { q = it }, "Buscar por número, cliente o placa")
            Opciones(FILTROS, estado, { estado = it })
        }
        val l = lista
        when {
            error != null && l == null -> ErrorRecarga(error!!, { recarga++ }, Modifier.weight(1f))
            l == null -> Cargando(Modifier.weight(1f))
            else -> LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
                if (l.isEmpty()) item { Vacio("No hay comprobantes", "Prueba con otra búsqueda o filtro.") }
                items(l, key = { it.id }) { c ->
                    FilaComprobante(c) { onAbrir(c.id) }
                    Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            BotonEmitir("Emitir comprobante", onEmitir, Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun FilaComprobante(c: Comprobante, detalle: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 72.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(c.numero, style = Estilo.montoFila)
            val nombre = if (c.clienteTipoDoc == "0") "Clientes varios" else c.clienteNombre
            Text(listOf(c.placa, nombre).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave, maxLines = 1)
            detalle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave, maxLines = 2) }
        }
        Spacer(Modifier.widthIn(min = 12.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(soles(c.total), style = Estilo.montoFila)
            EstadoEtiqueta(c.estado)
        }
    }
}

private suspend fun imprimir(contexto: Context, p: Preferencias, c: Comprobante, e: Empresa, logo: Bitmap?) {
    val puntos = if (p.impresoraAncho == 80) 576 else 384
    val bmp = withContext(Dispatchers.Default) { ComponedorTicket(contexto).componer(c, e, puntos, logo, paraTermica = true) }
    if (p.impresoraTipo == "red") Impresion.imprimirRed(p.impresoraDireccion, bmp)
    else Impresion.imprimirBluetooth(contexto, p.impresoraDireccion, bmp)
}

@Composable
fun PantallaDetalle(api: Api, usuario: Usuario, id: Int, onVolver: () -> Unit) {
    val contexto = LocalContext.current
    var c by remember { mutableStateOf<Comprobante?>(null) }
    var empresa by remember { mutableStateOf<Empresa?>(null) }
    var ticket by remember { mutableStateOf<Bitmap?>(null) }
    var logo by remember { mutableStateOf<Bitmap?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var mensaje by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var trabajando by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var pedirTelefono by remember { mutableStateOf(false) }
    var pedirAnular by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(id, recarga) {
        error = null
        try {
            val e = empresa ?: api.empresa().also { empresa = it }
            val actual = api.comprobante(id)
            c = actual
            val imagenLogo = runCatching { api.logo(e) }.getOrNull()
            logo = imagenLogo
            ticket = withContext(Dispatchers.Default) { ComponedorTicket(contexto).componer(actual, e, 576, imagenLogo) }
        } catch (x: ErrorApi) {
            error = x.message
        }
    }

    fun tarea(nombre: String, bloque: suspend () -> Unit) {
        ambito.launch {
            trabajando = nombre
            mensaje = null
            try {
                bloque()
            } catch (x: ErrorApi) {
                mensaje = (x.message ?: "Error") to false
            } catch (x: IOException) {
                mensaje = (x.message ?: "No se pudo imprimir.") to false
            } finally {
                trabajando = null
            }
        }
    }

    fun enviarWhatsApp(telefono: String) {
        val comp = c ?: return
        val bmp = ticket ?: return
        tarea("whatsapp") {
            val pdf = withContext(Dispatchers.IO) { guardarPdf(contexto, bmp, "${comp.serie}-${comp.correlativo}", 80) }
            WhatsApp.enviar(contexto, pdf, comp, telefono, empresa?.nombreComercial ?: "El Firme")
        }
    }

    val permiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) mensaje = "Permite el acceso a Bluetooth para imprimir." to false
    }

    fun iniciarImpresion() {
        val comp = c ?: return
        val e = empresa ?: return
        val p = api.prefs
        if (p.impresoraDireccion.isBlank()) {
            mensaje = "Elige tu ticketera en Ajustes › Ticketera." to false
            return
        }
        if (p.impresoraTipo == "bluetooth" && Build.VERSION.SDK_INT >= 31 &&
            ContextCompat.checkSelfPermission(contexto, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            permiso.launch(Manifest.permission.BLUETOOTH_CONNECT)
            return
        }
        tarea("imprimir") {
            imprimir(contexto, p, comp, e, logo)
            mensaje = "Enviado a la ticketera." to true
        }
    }

    val comp = c
    Column(Modifier.fillMaxSize()) {
        Barra(comp?.nombreTipo ?: "Comprobante", onVolver)
        when {
            error != null && comp == null -> ErrorRecarga(error!!, { recarga++ })
            comp == null -> Cargando()
            else -> DetalleContenido(
                comp, ticket, usuario.esAdmin, mensaje, trabajando,
                onWhatsApp = { if (WhatsApp.normalizar(comp.clienteTelefono) != null) enviarWhatsApp(comp.clienteTelefono) else pedirTelefono = true },
                onImprimir = ::iniciarImpresion,
                onReenviar = { tarea("reenviar") { c = api.reenviar(id); recarga++ } },
                onAnular = { pedirAnular = true },
            )
        }
    }

    if (pedirTelefono) {
        var tel by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pedirTelefono = false },
            title = { Text("WhatsApp del cliente") },
            text = { Campo(tel, { v -> tel = v.filter(Char::isDigit).take(11) }, "Número de celular", teclado = KeyboardType.Phone, ayuda = "Déjalo vacío para elegir el contacto en WhatsApp") },
            confirmButton = { TextButton(onClick = { pedirTelefono = false; enviarWhatsApp(tel) }) { Text("Continuar") } },
            dismissButton = { TextButton(onClick = { pedirTelefono = false }) { Text("Cancelar") } },
        )
    }

    if (pedirAnular && comp != null) {
        var motivo by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pedirAnular = false },
            title = { Text("Anular ${comp.numero}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Se informará la anulación a SUNAT y el ingreso saldrá de la caja. No se puede deshacer.")
                    Campo(motivo, { motivo = it.take(100) }, "Motivo")
                }
            },
            confirmButton = {
                TextButton(enabled = motivo.trim().length >= 3, onClick = {
                    pedirAnular = false
                    tarea("anular") { c = api.anular(id, motivo); recarga++ }
                }) { Text("Anular", color = Firme.c.rechazado) }
            },
            dismissButton = { TextButton(onClick = { pedirAnular = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
fun AvisoEstado(c: Comprobante, modifier: Modifier = Modifier) {
    val mensaje = c.sunatMensaje
    when (c.estado) {
        "ACEPTADO" -> Aviso(mensaje.ifBlank { "SUNAT aceptó este comprobante." }, Firme.c.aceptado, modifier, "Aceptado por SUNAT")
        "OBSERVADO" -> Aviso(mensaje, Firme.c.observado, modifier, "Aceptado con observaciones")
        "POR_ENVIAR" -> Aviso(
            "Se reintentará automáticamente. Plazo: ${c.diasRestantes ?: 0} días." + (if (mensaje.isNotBlank()) "\n$mensaje" else ""),
            Firme.c.proceso, modifier, "Pendiente de envío a SUNAT",
        )
        "ANULANDO" -> Aviso("SUNAT está procesando la anulación.", Firme.c.proceso, modifier, "Anulación en proceso")
        "RECHAZADO" -> Aviso("$mensaje\nNo lo entregues al cliente. Anúlalo y emite uno nuevo con los datos corregidos.", Firme.c.rechazado, modifier, "Rechazado por SUNAT")
        "ANULADO" -> Aviso(c.anulacionMotivo.ifBlank { "Este comprobante no tiene validez." }, Firme.c.anulado, modifier, "Anulado")
    }
}

@Composable
fun DetalleContenido(
    c: Comprobante,
    ticket: Bitmap?,
    esAdmin: Boolean,
    mensaje: Pair<String, Boolean>?,
    trabajando: String?,
    onWhatsApp: () -> Unit,
    onImprimir: () -> Unit,
    onReenviar: () -> Unit,
    onAnular: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AvisoEstado(c)
            mensaje?.let { (t, ok) -> Aviso(t, if (ok) Firme.c.aceptado else Firme.c.rechazado) }
            if (ticket != null) {
                Box(
                    Modifier.fillMaxWidth().clip(Radio8).background(MaterialTheme.colorScheme.surfaceVariant).padding(vertical = 16.dp),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Image(
                        ticket.asImageBitmap(), null,
                        Modifier.widthIn(max = 300.dp).fillMaxWidth(0.84f).alpha(if (c.entregable) 1f else 0.35f).border(1.dp, Firme.c.linea)
                            .semantics { contentDescription = "Vista previa del comprobante ${c.numero}, total ${soles(c.total)}" },
                        contentScale = ContentScale.FillWidth,
                    )
                }
            }
            if (c.estado == "POR_ENVIAR") BotonSecundario("Enviar a SUNAT ahora", onReenviar, Modifier.fillMaxWidth(), cargando = trabajando == "reenviar")
            if (esAdmin && c.estado in setOf("ACEPTADO", "OBSERVADO", "RECHAZADO")) {
                TextButton(onClick = onAnular, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                    if (trabajando == "anular") Text("Anulando…", color = Firme.c.rechazado)
                    else Text("Anular comprobante", color = Firme.c.rechazado, fontWeight = FontWeight(600))
                }
            }
        }
        if (c.entregable) {
            Divisor()
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BotonSecundario("Imprimir", onImprimir, Modifier.weight(1f), Icons.Filled.Print, cargando = trabajando == "imprimir")
                BotonPrincipal("WhatsApp", onWhatsApp, Modifier.weight(1f), Icons.Filled.Send, cargando = trabajando == "whatsapp", activo = ticket != null)
            }
        }
    }
}
