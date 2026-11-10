package pe.elfirme.caja.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pe.elfirme.caja.data.AjustesConsultas
import pe.elfirme.caja.data.AjustesSunat
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.ErrorApi

private data class OpcionImpuesto(val codigo: String, val titulo: String, val detalle: String)

private val IMPUESTOS = listOf(
    OpcionImpuesto("10", "Con IGV (18%)", "El precio de venta incluye el IGV. Es lo habitual en un autolavado."),
    OpcionImpuesto("20", "Sin IGV · Exonerada", "Solo si una norma exonera tu venta, por ejemplo en zonas con beneficio tributario."),
    OpcionImpuesto("30", "Sin IGV · Inafecta", "Solo si tu operación no está alcanzada por el IGV."),
)

@Composable
fun PantallaImpuestos(api: Api, onVolver: () -> Unit) {
    var seleccion by remember { mutableStateOf<String?>(null) }
    var mensaje by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var guardando by remember { mutableStateOf(false) }
    var recarga by remember { mutableIntStateOf(0) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(recarga) {
        try { seleccion = api.ajustesVentas().afectacion } catch (x: ErrorApi) { mensaje = (x.message ?: "Error") to false }
    }

    Column(Modifier.fillMaxSize()) {
        Barra("Impuestos de las ventas", onVolver)
        val s = seleccion
        if (s == null) {
            if (mensaje != null) ErrorRecarga(mensaje!!.first, { mensaje = null; recarga++ }) else Cargando()
            return@Column
        }
        ImpuestosContenido(s, { seleccion = it }, mensaje, guardando) {
            ambito.launch {
                guardando = true
                mensaje = null
                try {
                    api.guardarVentas(s)
                    mensaje = "Guardado. Se aplica a los próximos comprobantes." to true
                } catch (x: ErrorApi) {
                    mensaje = (x.message ?: "Error") to false
                } finally {
                    guardando = false
                }
            }
        }
    }
}

@Composable
fun ImpuestosContenido(
    seleccion: String,
    onCambio: (String) -> Unit,
    mensaje: Pair<String, Boolean>?,
    guardando: Boolean,
    onGuardar: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            IMPUESTOS.forEach { o ->
                val activo = o.codigo == seleccion
                Row(
                    Modifier.fillMaxWidth().clip(Radio12).background(MaterialTheme.colorScheme.surface)
                        .border(if (activo) 2.dp else 1.dp, if (activo) MaterialTheme.colorScheme.primary else Firme.c.linea, Radio12)
                        .selectable(selected = activo, role = Role.RadioButton) { onCambio(o.codigo) }
                        .heightIn(min = 72.dp).padding(start = 4.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(activo, null, Modifier.padding(horizontal = 12.dp), colors = RadioButtonDefaults.colors(selectedColor = MaterialTheme.colorScheme.primary))
                    Column(Modifier.weight(1f)) {
                        Text(o.titulo, style = MaterialTheme.typography.titleMedium)
                        Text(o.detalle, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                    }
                }
            }
            if (seleccion != "10") {
                Aviso("Emitir sin IGV sin tener derecho a ello puede generar reparos de SUNAT. Confírmalo con tu contador.", Firme.c.observado, titulo = "Verifica antes de usarlo")
            }
            Text(
                "Los precios de tus servicios no cambian. Los comprobantes ya emitidos tampoco.",
                style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave,
            )
            mensaje?.let { (t, ok) -> Aviso(t, if (ok) Firme.c.aceptado else Firme.c.rechazado) }
        }
        BotonPrincipal("Guardar", onGuardar, Modifier.fillMaxWidth().padding(16.dp), cargando = guardando)
    }
}

@Composable
fun PantallaConsultas(api: Api, onVolver: () -> Unit) {
    var datos by remember { mutableStateOf<AjustesConsultas?>(null) }
    var activo by remember { mutableStateOf(true) }
    var token by remember { mutableStateOf("") }
    var mensaje by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var trabajando by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(recarga) {
        try {
            val d = api.ajustesConsultas()
            datos = d
            activo = d.activo
        } catch (e: ErrorApi) {
            mensaje = (e.message ?: "Error") to false
        }
    }

    fun tarea(nombre: String, b: suspend () -> Unit) {
        ambito.launch {
            trabajando = nombre
            mensaje = null
            try { b() } catch (e: ErrorApi) { mensaje = (e.message ?: "Error") to false } finally { trabajando = null }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("Consulta DNI y RUC", onVolver)
        val d = datos
        if (d == null) {
            if (mensaje != null) ErrorRecarga(mensaje!!.first, { mensaje = null; recarga++ }) else Cargando()
            return@Column
        }
        ConsultasContenido(
            d, activo, { activo = it }, token, { token = it }, mensaje, trabajando,
            onProbar = {
                tarea("probar") {
                    val r = api.probarConsultas(token)
                    mensaje = "Conexión correcta. Se consultó ${r.resultado}." to true
                }
            },
            onGuardar = {
                tarea("guardar") {
                    datos = api.guardarConsultas(activo, token)
                    token = ""
                    mensaje = "Cambios guardados." to true
                }
            },
        )
    }
}

@Composable
fun ConsultasContenido(
    d: AjustesConsultas,
    activo: Boolean,
    onActivo: (Boolean) -> Unit,
    token: String,
    onToken: (String) -> Unit,
    mensaje: Pair<String, Boolean>?,
    trabajando: String?,
    onProbar: () -> Unit,
    onGuardar: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Consulta en línea", style = MaterialTheme.typography.titleMedium)
                    Text("Completa el nombre al escribir un DNI o RUC", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                }
                Switch(activo, onActivo, colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary))
            }
            Divisor()
            Seccion("Token de Decolecta")
            Campo(
                token, onToken, if (d.tokenGuardado) "Reemplazar token" else "Token",
                transformacion = PasswordVisualTransformation(),
                ayuda = when {
                    d.tokenFinal.isNotBlank() -> "Guardado, termina en ${d.tokenFinal}. Déjalo vacío para conservarlo."
                    d.tokenGuardado -> "Guardado. Déjalo vacío para conservarlo."
                    else -> "Lo obtienes en tu perfil de decolecta.com"
                },
            )
            Text(
                "Cada consulta usa tu plan de Decolecta. Si el cliente ya está guardado, no se gasta ninguna.",
                style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave,
            )
            mensaje?.let { (t, ok) -> Aviso(t, if (ok) Firme.c.aceptado else Firme.c.rechazado) }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonSecundario("Probar", onProbar, Modifier.weight(1f), cargando = trabajando == "probar")
            BotonPrincipal("Guardar", onGuardar, Modifier.weight(1f), cargando = trabajando == "guardar")
        }
    }
}

private const val MAX_CERTIFICADO = 100 * 1024

private fun leerArchivo(c: Context, uri: Uri, limite: Int): ByteArray? =
    c.contentResolver.openInputStream(uri)?.use { e ->
        val datos = e.readBytes()
        if (datos.size > limite) null else datos
    }

class EstadoConfigSunat {
    var ruc by mutableStateOf("")
    var usuario by mutableStateOf("")
    var clave by mutableStateOf("")
    var archivo by mutableStateOf<ByteArray?>(null)
    var claveCertificado by mutableStateOf("")
}

@Composable
fun PantallaConfigSunat(api: Api, onVolver: () -> Unit) {
    val contexto = LocalContext.current
    val e = remember { EstadoConfigSunat() }
    var datos by remember { mutableStateOf<AjustesSunat?>(null) }
    var mensaje by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var trabajando by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var activar by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()

    fun aplicar(d: AjustesSunat) {
        datos = d
        e.ruc = d.ruc
        e.usuario = d.usuario
        e.clave = ""
    }

    LaunchedEffect(recarga) {
        try { aplicar(api.ajustesSunat()) } catch (x: ErrorApi) { mensaje = (x.message ?: "Error") to false }
    }

    fun tarea(nombre: String, b: suspend () -> Unit) {
        ambito.launch {
            trabajando = nombre
            mensaje = null
            try { b() } catch (x: ErrorApi) { mensaje = (x.message ?: "Error") to false } finally { trabajando = null }
        }
    }

    val selector = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            ambito.launch {
                val b = runCatching { withContext(Dispatchers.IO) { leerArchivo(contexto, uri, MAX_CERTIFICADO) } }.getOrNull()
                if (b == null) mensaje = "No se pudo leer ese archivo. Elige tu certificado .pfx o .p12." to false else e.archivo = b
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("SUNAT y certificado", onVolver)
        val d = datos
        if (d == null) {
            if (mensaje != null) ErrorRecarga(mensaje!!.first, { mensaje = null; recarga++ }) else Cargando()
            return@Column
        }
        ConfigSunatContenido(
            d, e, mensaje, trabajando,
            onGuardarDatos = {
                tarea("datos") {
                    aplicar(api.guardarSunat(e.ruc, e.usuario, e.clave))
                    mensaje = "Datos de SUNAT guardados." to true
                }
            },
            onElegirArchivo = { selector.launch("*/*") },
            onSubirCertificado = {
                val pfx = e.archivo
                if (pfx != null) {
                    tarea("cert") {
                        aplicar(api.subirCertificado(pfx, e.claveCertificado))
                        e.archivo = null
                        e.claveCertificado = ""
                        mensaje = "Certificado guardado." to true
                    }
                }
            },
            onActivar = { activar = true },
        )
    }

    if (activar) {
        var texto by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { activar = false },
            title = { Text("Activar producción") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Los comprobantes pasarán a ser reales. Se borrarán todas las ventas y gastos de prueba y la numeración volverá a empezar. No se puede deshacer.")
                    Campo(texto, { texto = it }, "Escribe PRODUCCION", mayusculas = true)
                }
            },
            confirmButton = {
                TextButton(enabled = texto.trim() == "PRODUCCION", onClick = {
                    activar = false
                    tarea("activar") {
                        aplicar(api.activarProduccion("PRODUCCION"))
                        mensaje = "Producción activada. Desde ahora los comprobantes son reales." to true
                    }
                }) { Text("Activar", color = Firme.c.rechazado) }
            },
            dismissButton = { TextButton(onClick = { activar = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
fun ConfigSunatContenido(
    d: AjustesSunat,
    e: EstadoConfigSunat,
    mensaje: Pair<String, Boolean>?,
    trabajando: String?,
    onGuardarDatos: () -> Unit,
    onElegirArchivo: () -> Unit,
    onSubirCertificado: () -> Unit,
    onActivar: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (d.enProduccion) {
            Aviso("Los comprobantes que emitas son reales y se envían a SUNAT.", Firme.c.aceptado, titulo = "Producción")
        } else {
            Aviso("Puedes cargar tus datos reales: en pruebas solo se usa el ambiente beta de SUNAT, sin valor tributario.", Firme.c.observado, titulo = "Modo de prueba")
        }
        mensaje?.let { (t, ok) -> Aviso(t, if (ok) Firme.c.aceptado else Firme.c.rechazado) }

        Seccion("Datos de acceso", Modifier.padding(top = 8.dp))
        Campo(e.ruc, { v -> e.ruc = v.filter(Char::isDigit).take(11) }, "RUC de la empresa", teclado = KeyboardType.Number)
        Campo(e.usuario, { e.usuario = it.trim() }, "Usuario secundario SOL", mayusculas = true)
        Campo(
            e.clave, { e.clave = it }, if (d.claveGuardada) "Reemplazar clave SOL" else "Clave SOL",
            teclado = KeyboardType.Password, transformacion = PasswordVisualTransformation(),
            ayuda = if (d.claveGuardada) "Guardada. Déjala vacía para conservarla." else null,
        )
        BotonSecundario("Guardar datos", onGuardarDatos, Modifier.fillMaxWidth(), cargando = trabajando == "datos")

        Seccion("Certificado digital (CDT)", Modifier.padding(top = 12.dp))
        val c = d.certificado
        val vence = c.vence.split("-").reversed().joinToString("/")
        when {
            !c.cargado -> Text("Aún no has cargado tu certificado desde la app.", color = Firme.c.tintaSuave)
            !c.valido -> Aviso("El certificado guardado no se puede abrir. Vuelve a cargarlo.", Firme.c.rechazado)
            c.diasRestantes < 30 -> Aviso("Vence el $vence: quedan ${c.diasRestantes} días.", Firme.c.observado, titulo = "Renueva tu certificado")
            else -> Aviso("Vence el $vence\n${c.titular}", Firme.c.aceptado, titulo = "Certificado vigente")
        }
        BotonSecundario(if (e.archivo == null) "Elegir archivo .pfx o .p12" else "Archivo listo · elegir otro", onElegirArchivo, Modifier.fillMaxWidth())
        if (e.archivo != null) {
            Campo(
                e.claveCertificado, { e.claveCertificado = it }, "Contraseña del certificado",
                teclado = KeyboardType.Password, transformacion = PasswordVisualTransformation(),
            )
            BotonPrincipal("Guardar certificado", onSubirCertificado, Modifier.fillMaxWidth(), cargando = trabajando == "cert")
        }

        if (!d.enProduccion) {
            Seccion("Ambiente", Modifier.padding(top = 12.dp))
            Text(
                "Al activar producción se validan estos datos y se eliminan ${d.comprobantes} comprobantes de prueba, con sus ventas y gastos.",
                style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave,
            )
            BotonSecundario("Activar producción", onActivar, Modifier.fillMaxWidth(), color = Firme.c.rechazado, cargando = trabajando == "activar")
        }
    }
}
