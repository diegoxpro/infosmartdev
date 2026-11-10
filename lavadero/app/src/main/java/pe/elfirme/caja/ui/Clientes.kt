package pe.elfirme.caja.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.ClienteGuardado
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.Usuario
import pe.elfirme.caja.ticket.WhatsApp

/** Abre la agenda para elegir un número. Android solo da acceso al contacto elegido; no pide permisos. */
@Composable
fun rememberAgenda(onElegido: (nombre: String, telefono: String) -> Unit): () -> Unit {
    val contexto = LocalContext.current
    val lanzador = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val uri = r.data?.data
        if (r.resultCode == Activity.RESULT_OK && uri != null) leerContacto(contexto, uri)?.let { (n, t) -> onElegido(n, t) }
    }
    return {
        runCatching {
            lanzador.launch(Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI))
        }
    }
}

private fun leerContacto(c: Context, uri: Uri): Pair<String, String>? {
    val columnas = arrayOf(
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        ContactsContract.CommonDataKinds.Phone.NUMBER,
    )
    return runCatching {
        c.contentResolver.query(uri, columnas, null, null, null)?.use { f ->
            if (!f.moveToFirst()) return@use null
            val digitos = f.getString(1).orEmpty().filter(Char::isDigit)
            val numero = if (digitos.length > 9 && digitos.startsWith("51")) digitos.drop(2) else digitos
            f.getString(0).orEmpty() to numero.take(11)
        }
    }.getOrNull()
}

private fun guardarEnAgenda(c: Context, nombre: String, telefono: String) {
    val intento = Intent(ContactsContract.Intents.Insert.ACTION).apply {
        type = ContactsContract.RawContacts.CONTENT_TYPE
        putExtra(ContactsContract.Intents.Insert.NAME, nombre)
        putExtra(ContactsContract.Intents.Insert.PHONE, telefono)
    }
    try {
        c.startActivity(intento)
    } catch (_: ActivityNotFoundException) {
        // Sin aplicación de contactos no hay nada que abrir.
    }
}

private fun abrirChat(c: Context, telefono: String) {
    val numero = WhatsApp.normalizar(telefono) ?: return
    runCatching { c.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$numero"))) }
}

@Composable
fun PantallaClientes(api: Api, onAbrir: (Int) -> Unit) {
    var q by remember { mutableStateOf("") }
    var lista by remember { mutableStateOf<List<ClienteGuardado>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }

    LaunchedEffect(q, recarga) {
        if (q.isNotEmpty()) delay(300)
        error = null
        try { lista = api.clientes(q) } catch (e: ErrorApi) { error = e.message }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("Clientes")
        ClientesContenido(q, { q = it }, lista, error, { recarga++ }, onAbrir)
    }
}

@Composable
fun ClientesContenido(
    q: String,
    onQ: (String) -> Unit,
    lista: List<ClienteGuardado>?,
    error: String?,
    onReintentar: () -> Unit,
    onAbrir: (Int) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Campo(q, onQ, "Nombre, documento, placa o celular", Modifier.padding(horizontal = 16.dp))
        when {
            error != null && lista == null -> ErrorRecarga(error, onReintentar, Modifier.weight(1f))
            lista == null -> Cargando(Modifier.weight(1f))
            else -> LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
                if (lista.isEmpty()) {
                    item {
                        if (q.isBlank()) Vacio("Aún no hay clientes", "Agrégalos aquí o se guardarán al emitir un comprobante con documento.")
                        else Vacio("Sin resultados", "Prueba con otro dato.")
                    }
                }
                items(lista, key = { it.id ?: it.numDoc.hashCode() }) { c ->
                    Column(
                        Modifier.fillMaxWidth().clickable { c.id?.let(onAbrir) }.heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(c.nombre, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(600), maxLines = 1)
                        Text(
                            listOf("${c.etiquetaDoc} ${c.numDoc}", c.placa, c.telefono).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Firme.c.tintaSuave,
                        )
                    }
                    Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
        BotonPrincipal("Agregar cliente", { onAbrir(0) }, Modifier.fillMaxWidth().padding(16.dp))
    }
}

class EstadoCliente(c: ClienteGuardado?) {
    var id by mutableStateOf(c?.id)
    var esRuc by mutableStateOf(c?.tipoDoc == "6")
    var documento by mutableStateOf(c?.numDoc.orEmpty())
    var nombre by mutableStateOf(c?.nombre.orEmpty())
    var direccion by mutableStateOf(c?.direccion.orEmpty())
    var telefono by mutableStateOf(c?.telefono.orEmpty())
    var placa by mutableStateOf(c?.placa.orEmpty())

    val largo get() = if (esRuc) 11 else 8
    val listo get() = documento.length == largo && nombre.trim().length >= 2 && (telefono.isEmpty() || telefono.length == 9 || telefono.length == 11)
}

@Composable
fun PantallaCliente(api: Api, usuario: Usuario, id: Int, onVolver: () -> Unit) {
    var estado by remember { mutableStateOf(if (id == 0) EstadoCliente(null) else null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmar by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(id) {
        if (id != 0) try { estado = EstadoCliente(api.cliente(id)) } catch (x: ErrorApi) { error = x.message }
    }

    val e = estado
    Column(Modifier.fillMaxSize().imePadding()) {
        Barra(if (id == 0) "Nuevo cliente" else "Cliente", onVolver)
        when {
            e == null && error != null -> ErrorRecarga(error!!, onVolver)
            e == null -> Cargando()
            else -> FormularioCliente(
                api, e, puedeEliminar = id != 0 && usuario.esAdmin,
                onEliminar = { confirmar = true },
                onGuardado = { onVolver() },
            )
        }
    }

    if (confirmar && e != null) {
        AlertDialog(
            onDismissRequest = { confirmar = false },
            title = { Text("Eliminar cliente") },
            text = { Text("Se eliminará ${e.nombre} de tu lista. Sus comprobantes emitidos no cambian.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmar = false
                    ambito.launch {
                        try { api.eliminarCliente(id); onVolver() } catch (x: ErrorApi) { error = x.message }
                    }
                }) { Text("Eliminar", color = Firme.c.rechazado) }
            },
            dismissButton = { TextButton(onClick = { confirmar = false }) { Text("Cancelar") } },
        )
    }
}

/** Formulario con consulta DNI/RUC, compartido por Clientes y por la emisión de comprobantes. */
@Composable
fun FormularioCliente(
    api: Api,
    e: EstadoCliente,
    consultarAlAbrir: Boolean = false,
    puedeEliminar: Boolean = false,
    textoGuardar: String = "Guardar",
    onEliminar: () -> Unit = {},
    onGuardado: (ClienteGuardado) -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    var aviso by remember { mutableStateOf<String?>(null) }
    var consultando by remember { mutableStateOf(false) }
    var guardando by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    suspend fun consultar(silenciarSinConfigurar: Boolean) {
        consultando = true
        error = null
        aviso = null
        try {
            val r = api.consultar(if (e.esRuc) "ruc" else "dni", e.documento)
            // Si ya estaba registrado, se actualiza en vez de duplicarlo.
            r.id?.let { e.id = it }
            e.nombre = r.nombre
            if (r.direccion.isNotBlank()) e.direccion = r.direccion
            if (r.telefono.isNotBlank()) e.telefono = r.telefono
            if (r.placa.isNotBlank()) e.placa = r.placa
            aviso = r.alertaSunat
        } catch (x: ErrorApi) {
            error = when {
                x.codigo != 409 -> x.message
                silenciarSinConfigurar -> null
                else -> "La consulta no está configurada. Un administrador debe activarla en Ajustes › Consulta DNI y RUC."
            }
        } finally {
            consultando = false
        }
    }

    LaunchedEffect(Unit) {
        if (consultarAlAbrir && e.documento.length == e.largo) consultar(silenciarSinConfigurar = true)
    }

    ClienteContenido(
        e, error, aviso, consultando, guardando, puedeEliminar,
        onConsultar = { ambito.launch { consultar(silenciarSinConfigurar = false) } },
        onGuardar = {
            ambito.launch {
                guardando = true
                error = null
                try {
                    onGuardado(
                        api.guardarCliente(
                            ClienteGuardado(e.id, if (e.esRuc) "6" else "1", e.documento, e.nombre, e.direccion, e.telefono, e.placa),
                        ),
                    )
                } catch (x: ErrorApi) {
                    error = x.message
                } finally {
                    guardando = false
                }
            }
        },
        onEliminar = onEliminar,
        textoGuardar = textoGuardar,
    )
}

@Composable
fun ClienteContenido(
    e: EstadoCliente,
    error: String?,
    aviso: String?,
    consultando: Boolean,
    guardando: Boolean,
    puedeEliminar: Boolean,
    onConsultar: () -> Unit,
    onGuardar: () -> Unit,
    onEliminar: () -> Unit,
    textoGuardar: String = "Guardar",
) {
    val contexto = LocalContext.current
    val agenda = rememberAgenda { n, t ->
        e.telefono = t
        if (e.nombre.isBlank()) e.nombre = n.uppercase()
    }
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Segmentos(listOf("DNI", "RUC"), if (e.esRuc) 1 else 0, { e.esRuc = it == 1; e.documento = e.documento.take(e.largo) })
            Campo(
                e.documento, { v -> e.documento = v.filter(Char::isDigit).take(e.largo) },
                if (e.esRuc) "Número de RUC" else "Número de DNI", teclado = KeyboardType.Number,
                accion = {
                    TextButton(onClick = onConsultar, enabled = e.documento.length == e.largo && !consultando, modifier = Modifier.height(48.dp)) {
                        Text(if (consultando) "Buscando…" else "Consultar")
                    }
                },
            )
            aviso?.let { Aviso(it, Firme.c.observado) }
            Campo(e.nombre, { e.nombre = it.uppercase() }, if (e.esRuc) "Razón social" else "Nombre completo", mayusculas = true)
            Campo(e.direccion, { e.direccion = it.uppercase().take(200) }, "Dirección (opcional)", mayusculas = true)
            Campo(
                e.telefono, { v -> e.telefono = v.filter(Char::isDigit).take(11) }, "Celular / WhatsApp", teclado = KeyboardType.Phone,
                accion = { IconButton(onClick = agenda) { Icon(Icons.Filled.Contacts, "Elegir de la agenda del teléfono") } },
            )
            Campo(e.placa, { v -> e.placa = v.uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(8) }, "Placa (opcional)", mayusculas = true)
            error?.let { Aviso(it, Firme.c.rechazado) }
            if (WhatsApp.normalizar(e.telefono) != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BotonSecundario("A la agenda", { guardarEnAgenda(contexto, e.nombre, e.telefono) }, Modifier.weight(1f), Icons.Filled.PersonAdd)
                    BotonSecundario("WhatsApp", { abrirChat(contexto, e.telefono) }, Modifier.weight(1f), Icons.Filled.Send)
                }
            }
            if (puedeEliminar) {
                TextButton(onClick = onEliminar, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                    Text("Eliminar cliente", color = Firme.c.rechazado, fontWeight = FontWeight(600))
                }
            }
        }
        BotonPrincipal(textoGuardar, onGuardar, Modifier.fillMaxWidth().padding(16.dp), cargando = guardando, activo = e.listo)
    }
}
