package pe.elfirme.caja.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.Comprobante
import pe.elfirme.caja.data.Empresa
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.LineaDetalle
import pe.elfirme.caja.data.Servicio
import pe.elfirme.caja.data.Usuario
import pe.elfirme.caja.data.soles
import pe.elfirme.caja.ticket.ComponedorTicket
import pe.elfirme.caja.ticket.Impresion
import pe.elfirme.caja.ticket.ImpresoraBt
import java.io.ByteArrayOutputStream
import java.io.IOException

@Composable
private fun Fila(titulo: String, detalle: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(600))
            detalle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave) }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Firme.c.tintaSuave)
    }
}

@Composable
fun PantallaAjustes(api: Api, usuario: Usuario, onIr: (String) -> Unit, onSalir: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Barra("Ajustes")
        val p = api.prefs
        Fila("Ticketera", p.impresoraNombre.ifBlank { "Sin configurar" } + " · ${p.impresoraAncho} mm") { onIr("impresora") }
        Divisor(Modifier.padding(start = 16.dp))
        Fila("Control SUNAT", "Envíos, rechazos y anulaciones") { onIr("sunat") }
        Divisor(Modifier.padding(start = 16.dp))
        if (usuario.esAdmin) {
            Fila("Servicios y precios") { onIr("servicios") }
            Divisor(Modifier.padding(start = 16.dp))
            Fila("Datos de la empresa", "Logo y datos del comprobante") { onIr("empresa") }
            Divisor(Modifier.padding(start = 16.dp))
            Fila("Impuestos de las ventas", "Con IGV o sin IGV") { onIr("impuestos") }
            Divisor(Modifier.padding(start = 16.dp))
            Fila("Consulta DNI y RUC", "Conexión con Decolecta") { onIr("consultas") }
            Divisor(Modifier.padding(start = 16.dp))
            Fila("SUNAT y certificado", "RUC, clave SOL, CDT y ambiente") { onIr("config-sunat") }
            Divisor(Modifier.padding(start = 16.dp))
            Fila("Usuarios", "Quién puede usar la caja") { onIr("usuarios") }
            Divisor(Modifier.padding(start = 16.dp))
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(usuario.nombre, style = MaterialTheme.typography.titleMedium)
            Text(if (usuario.esAdmin) "Administrador" else "Cajero", color = Firme.c.tintaSuave)
        }
        BotonSecundario("Cerrar sesión", onSalir, Modifier.fillMaxWidth().padding(horizontal = 16.dp))
    }
}

private fun ticketDemostracion() = Comprobante(
    id = 0, tipo = "03", serie = "B001", correlativo = 0, numero = "PRUEBA DE IMPRESIÓN", fecha = "2026-01-01", hora = "12:00",
    total = "35.00", estado = "ACEPTADO", opGravada = "29.66", igv = "5.34", medioPago = "EFECTIVO",
    lineas = listOf(LineaDetalle("Lavado completo auto", "1", "35.00", "35.00")),
    letras = "Si lees este texto completo, tu ticketera está lista.",
)

@Composable
fun PantallaImpresora(api: Api, onVolver: () -> Unit) {
    val contexto = LocalContext.current
    val p = api.prefs
    var tipo by remember { mutableStateOf(p.impresoraTipo) }
    var ancho by remember { mutableIntStateOf(p.impresoraAncho) }
    var direccion by remember { mutableStateOf(p.impresoraDireccion) }
    var nombre by remember { mutableStateOf(p.impresoraNombre) }
    var ip by remember { mutableStateOf(if (p.impresoraTipo == "red") p.impresoraDireccion else "") }
    var emparejadas by remember { mutableStateOf<List<ImpresoraBt>?>(null) }
    var mensaje by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var probando by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    fun tienePermiso() = Build.VERSION.SDK_INT < 31 ||
        ContextCompat.checkSelfPermission(contexto, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    val permiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) emparejadas = Impresion.emparejadas(contexto)
        else mensaje = "Sin permiso de Bluetooth no se puede usar la ticketera." to false
    }
    LaunchedEffect(tipo) {
        if (tipo == "bluetooth") {
            if (tienePermiso()) emparejadas = Impresion.emparejadas(contexto)
            else permiso.launch(Manifest.permission.BLUETOOTH_CONNECT)
        }
    }

    fun guardar() {
        p.impresoraTipo = tipo
        p.impresoraAncho = ancho
        if (tipo == "red") {
            p.impresoraDireccion = ip.trim()
            p.impresoraNombre = "Wi-Fi ${ip.trim()}"
        } else {
            p.impresoraDireccion = direccion
            p.impresoraNombre = nombre
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("Ticketera", onVolver)
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Segmentos(listOf("Bluetooth", "Wi-Fi"), if (tipo == "red") 1 else 0, { tipo = if (it == 1) "red" else "bluetooth" })
            Seccion("Ancho del papel")
            Segmentos(listOf("58 mm", "80 mm"), if (ancho == 80) 1 else 0, { ancho = if (it == 1) 80 else 58 })
            if (tipo == "red") {
                Campo(ip, { ip = it.trim() }, "Dirección IP de la ticketera", teclado = KeyboardType.Decimal, ayuda = "Debe estar en la misma red Wi-Fi que este equipo")
            } else {
                Seccion("Equipos emparejados")
                val lista = emparejadas
                when {
                    lista == null -> Text("Permite el acceso a Bluetooth para ver tus equipos.", color = Firme.c.tintaSuave)
                    lista.isEmpty() -> Vacio("Sin equipos emparejados", "Empareja la ticketera en los ajustes de Bluetooth del celular y vuelve aquí.")
                    else -> Column {
                        lista.forEach { d ->
                            Row(
                                Modifier.fillMaxWidth().clickable { direccion = d.direccion; nombre = d.nombre }.heightIn(min = 56.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(d.nombre, fontWeight = FontWeight(600))
                                    Text(d.direccion, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                                }
                                if (d.direccion == direccion) Icon(Icons.Filled.Check, "Seleccionada")
                            }
                            Divisor()
                        }
                    }
                }
            }
            mensaje?.let { (t, ok) -> Aviso(t, if (ok) Firme.c.aceptado else Firme.c.rechazado) }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonSecundario("Imprimir prueba", {
                guardar()
                ambito.launch {
                    probando = true
                    mensaje = null
                    try {
                        val puntos = if (ancho == 80) 576 else 384
                        val real = runCatching { api.empresa() }.getOrNull()
                        val logo = real?.let { r -> runCatching { api.logo(r) }.getOrNull() }
                        val e = Empresa(razonSocial = "PRUEBA DE IMPRESIÓN", entorno = "produccion")
                        val bmp = withContext(Dispatchers.Default) { ComponedorTicket(contexto).componer(ticketDemostracion(), e, puntos, logo, paraTermica = true) }
                        if (tipo == "red") Impresion.imprimirRed(ip.trim(), bmp) else Impresion.imprimirBluetooth(contexto, direccion, bmp)
                        mensaje = "Prueba enviada. Revisa el ticket." to true
                    } catch (x: IOException) {
                        mensaje = (x.message ?: "No se pudo imprimir.") to false
                    } catch (x: IllegalArgumentException) {
                        mensaje = "Elige una ticketera primero." to false
                    } finally {
                        probando = false
                    }
                }
            }, Modifier.weight(1f), cargando = probando)
            BotonPrincipal("Guardar", { guardar(); onVolver() }, Modifier.weight(1f))
        }
    }
}

@Composable
fun PantallaServicios(api: Api, onVolver: () -> Unit) {
    var lista by remember { mutableStateOf<List<Servicio>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var editar by remember { mutableStateOf<Servicio?>(null) }
    var nuevo by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(recarga) {
        error = null
        try { lista = api.servicios(todos = true) } catch (e: ErrorApi) { error = e.message }
    }

    Column(Modifier.fillMaxSize()) {
        Barra("Servicios y precios", onVolver)
        val l = lista
        when {
            error != null && l == null -> ErrorRecarga(error!!, { recarga++ }, Modifier.weight(1f))
            l == null -> Cargando(Modifier.weight(1f))
            else -> LazyColumn(Modifier.weight(1f)) {
                items(l, key = { it.id }) { s ->
                    Fila(s.nombre, soles(s.precio) + (if (s.activo) "" else " · Inactivo")) { editar = s }
                    Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
        BotonPrincipal("Agregar servicio", { nuevo = true }, Modifier.fillMaxWidth().padding(16.dp))
    }

    if (nuevo || editar != null) {
        val s = editar
        var nombre by remember(s) { mutableStateOf(s?.nombre ?: "") }
        var precio by remember(s) { mutableStateOf(s?.precio ?: "") }
        var activo by remember(s) { mutableStateOf(s?.activo ?: true) }
        var fallo by remember(s) { mutableStateOf<String?>(null) }
        val valor = precio.replace(',', '.').toBigDecimalOrNull()
        val cerrar = { nuevo = false; editar = null }
        AlertDialog(
            onDismissRequest = cerrar,
            title = { Text(if (s == null) "Nuevo servicio" else "Editar servicio") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Campo(nombre, { nombre = it }, "Nombre")
                    Campo(precio, { precio = it }, "Precio de venta", teclado = KeyboardType.Decimal)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Disponible para vender", Modifier.weight(1f))
                        Switch(activo, { activo = it }, colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary))
                    }
                    fallo?.let { Text(it, color = Firme.c.rechazado) }
                }
            },
            confirmButton = {
                TextButton(enabled = nombre.length >= 2 && valor != null && valor.signum() > 0, onClick = {
                    ambito.launch {
                        try {
                            api.guardarServicio(s?.id, nombre.trim(), valor!!.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(), s?.categoria ?: "Lavado", activo)
                            cerrar()
                            recarga++
                        } catch (e: ErrorApi) {
                            fallo = e.message
                        }
                    }
                }) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = cerrar) { Text("Cancelar") } },
        )
    }
}

/** Reduce la imagen a un tamaño adecuado para el ticket y la convierte en PNG. */
private fun prepararLogo(c: Context, uri: Uri): ByteArray? = runCatching {
    val opciones = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    c.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opciones) }
    if (opciones.outWidth <= 0) return@runCatching null
    var muestra = 1
    while (opciones.outWidth / (muestra * 2) >= 640) muestra *= 2
    val origen = c.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = muestra })
    } ?: return@runCatching null
    val factor = minOf(1f, 640f / origen.width)
    val final = Bitmap.createScaledBitmap(origen, (origen.width * factor).toInt().coerceAtLeast(1), (origen.height * factor).toInt().coerceAtLeast(1), true)
    ByteArrayOutputStream().also { final.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
}.getOrNull()

@Composable
fun PantallaEmpresa(api: Api, onVolver: () -> Unit) {
    var e by remember { mutableStateOf<Empresa?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var guardando by remember { mutableStateOf(false) }
    var recarga by remember { mutableIntStateOf(0) }
    var logo by remember { mutableStateOf<Bitmap?>(null) }
    var subiendo by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()
    val contexto = LocalContext.current

    LaunchedEffect(recarga) {
        error = null
        try {
            val d = api.empresa()
            e = d
            logo = api.logo(d)
        } catch (x: ErrorApi) {
            error = x.message
        }
    }

    val selectorLogo = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            ambito.launch {
                subiendo = true
                error = null
                try {
                    val png = withContext(Dispatchers.Default) { prepararLogo(contexto, uri) }
                    if (png == null) error = "No se pudo usar esa imagen. Elige un PNG o JPG." else { api.subirLogo(png); recarga++ }
                } catch (x: ErrorApi) {
                    error = x.message
                } finally {
                    subiendo = false
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("Datos de la empresa", onVolver)
        val d = e
        when {
            error != null && d == null -> ErrorRecarga(error!!, { recarga++ }, Modifier.weight(1f))
            d == null -> Cargando(Modifier.weight(1f))
            else -> {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Seccion("Logo del comprobante")
                    logo?.let {
                        Image(
                            it.asImageBitmap(), "Logo actual",
                            Modifier.fillMaxWidth().heightIn(max = 120.dp).background(Color.White, Radio8).padding(12.dp),
                            contentScale = ContentScale.Fit,
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        BotonSecundario(if (logo == null) "Elegir logo" else "Cambiar", { selectorLogo.launch("image/*") }, Modifier.weight(1f), cargando = subiendo)
                        if (logo != null) {
                            BotonSecundario("Quitar", {
                                ambito.launch {
                                    try { api.quitarLogo(); logo = null; recarga++ } catch (x: ErrorApi) { error = x.message }
                                }
                            }, Modifier.weight(1f), color = Firme.c.rechazado)
                        }
                    }
                    Text("Se imprime en blanco y negro en la ticketera y a color en el PDF.", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                    Seccion("Datos", Modifier.padding(top = 8.dp))
                    Campo(d.ruc, { v -> e = d.copy(ruc = v.filter(Char::isDigit).take(11)) }, "RUC", teclado = KeyboardType.Number)
                    Campo(d.razonSocial, { e = d.copy(razonSocial = it.uppercase()) }, "Razón social", mayusculas = true)
                    Campo(d.nombreComercial, { e = d.copy(nombreComercial = it) }, "Nombre comercial")
                    Campo(
                        d.direccion, { e = d.copy(direccion = it.uppercase().take(200)) }, "Dirección fiscal", mayusculas = true,
                        ayuda = "Obligatoria. Escríbela como figura en tu ficha RUC",
                    )
                    Campo(d.ubigeo, { v -> e = d.copy(ubigeo = v.filter(Char::isDigit).take(6)) }, "Ubigeo", teclado = KeyboardType.Number, ayuda = "6 dígitos, según INEI")
                    Campo(d.departamento, { e = d.copy(departamento = it.uppercase()) }, "Departamento", mayusculas = true)
                    Campo(d.provincia, { e = d.copy(provincia = it.uppercase()) }, "Provincia", mayusculas = true)
                    Campo(d.distrito, { e = d.copy(distrito = it.uppercase()) }, "Distrito", mayusculas = true)
                    Campo(d.telefono, { e = d.copy(telefono = it) }, "Teléfono (opcional)", teclado = KeyboardType.Phone)
                    Campo(d.mensajeTicket, { e = d.copy(mensajeTicket = it.take(200)) }, "Mensaje al pie del ticket (opcional)")
                }
                error?.let { Aviso(it, Firme.c.rechazado, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) }
                BotonPrincipal("Guardar", {
                    ambito.launch {
                        guardando = true
                        error = null
                        try { api.guardarEmpresa(d); onVolver() } catch (x: ErrorApi) { error = x.message }
                        guardando = false
                    }
                }, Modifier.fillMaxWidth().padding(16.dp), cargando = guardando)
            }
        }
    }
}

@Composable
fun PantallaUsuarios(api: Api, actual: Usuario, onVolver: () -> Unit) {
    var lista by remember { mutableStateOf<List<Usuario>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var nuevo by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(recarga) {
        error = null
        try { lista = api.usuarios() } catch (e: ErrorApi) { error = e.message }
    }

    Column(Modifier.fillMaxSize()) {
        Barra("Usuarios", onVolver)
        val l = lista
        when {
            error != null && l == null -> ErrorRecarga(error!!, { recarga++ }, Modifier.weight(1f))
            l == null -> Cargando(Modifier.weight(1f))
            else -> LazyColumn(Modifier.weight(1f)) {
                items(l, key = { it.id }) { u ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(u.nombre, fontWeight = FontWeight(600))
                            Text("${u.usuario} · ${if (u.esAdmin) "Administrador" else "Cajero"}", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                        }
                        if (u.id != actual.id) {
                            Switch(u.activo, { v ->
                                ambito.launch { runCatching { api.cambiarActivo(u.id, v) }; recarga++ }
                            }, colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary))
                        }
                    }
                    Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
        BotonPrincipal("Agregar usuario", { nuevo = true }, Modifier.fillMaxWidth().padding(16.dp))
    }

    if (nuevo) {
        var usuario by remember { mutableStateOf("") }
        var nombre by remember { mutableStateOf("") }
        var clave by remember { mutableStateOf("") }
        var rol by remember { mutableStateOf("cajero") }
        var fallo by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { nuevo = false },
            title = { Text("Nuevo usuario") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Campo(nombre, { nombre = it }, "Nombre")
                    Campo(usuario, { usuario = it.trim() }, "Usuario")
                    Campo(clave, { clave = it }, "Clave (mínimo 8)", teclado = KeyboardType.Password, transformacion = PasswordVisualTransformation())
                    Segmentos(listOf("Cajero", "Administrador"), if (rol == "admin") 1 else 0, { rol = if (it == 1) "admin" else "cajero" })
                    fallo?.let { Text(it, color = Firme.c.rechazado) }
                }
            },
            confirmButton = {
                TextButton(enabled = usuario.length >= 3 && nombre.length >= 2 && clave.length >= 8, onClick = {
                    ambito.launch {
                        try {
                            api.crearUsuario(usuario, nombre, clave, rol)
                            nuevo = false
                            recarga++
                        } catch (e: ErrorApi) {
                            fallo = e.message
                        }
                    }
                }) { Text("Crear") }
            },
            dismissButton = { TextButton(onClick = { nuevo = false }) { Text("Cancelar") } },
        )
    }
}
