package pe.elfirme.caja.ui

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.ClienteGuardado
import pe.elfirme.caja.data.EmitirPedido
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.ItemEmitir
import pe.elfirme.caja.data.MEDIOS_ETIQUETA
import pe.elfirme.caja.data.Servicio
import pe.elfirme.caja.data.soles
import java.math.BigDecimal
import java.util.UUID

private val TOPE_SIN_CLIENTE = BigDecimal("700.00")

class EstadoEmitir(val servicios: List<Servicio>) {
    var factura by mutableStateOf(false)
    var placa by mutableStateOf("")
    var telefono by mutableStateOf("")
    var medio by mutableStateOf("EFECTIVO")
    val cantidades = mutableStateMapOf<Int, Int>()

    var cliente by mutableStateOf<ClienteGuardado?>(null)
    var busqueda by mutableStateOf("")
    var resultados by mutableStateOf<List<ClienteGuardado>?>(null)
    var buscando by mutableStateOf(false)
    var errorBusqueda by mutableStateOf<String?>(null)

    val total: BigDecimal
        get() = servicios.fold(BigDecimal.ZERO) { acc, s ->
            acc + (s.precio.toBigDecimalOrNull() ?: BigDecimal.ZERO) * BigDecimal(cantidades[s.id] ?: 0)
        }
    val hayServicios get() = cantidades.values.any { it > 0 }

    /** En una factura solo sirven los clientes con RUC. */
    val coincidencias: List<ClienteGuardado>?
        get() = resultados?.filter { !factura || it.tipoDoc == "6" }?.take(5)

    val problemaCliente: String?
        get() = when {
            factura && cliente == null -> "La factura necesita un cliente con RUC."
            factura && cliente?.tipoDoc != "6" -> "Este cliente no tiene RUC. Elige o agrega uno con RUC."
            !factura && cliente == null && total > TOPE_SIN_CLIENTE -> "Las boletas de más de S/ 700 deben llevar cliente."
            else -> null
        }
    val listo get() = hayServicios && problemaCliente == null

    fun elegir(c: ClienteGuardado) {
        cliente = c
        busqueda = ""
        resultados = null
        errorBusqueda = null
        if (c.telefono.isNotBlank()) telefono = c.telefono
        if (placa.isBlank()) placa = c.placa
    }

    fun quitarCliente() {
        cliente = null
        telefono = ""
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PantallaEmitir(api: Api, onVolver: () -> Unit, onEmitido: (Int) -> Unit) {
    var estado by remember { mutableStateOf<EstadoEmitir?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var cargaError by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var intento by remember { mutableStateOf(0) }
    var nuevoCliente by remember { mutableStateOf<EstadoCliente?>(null) }
    // La misma clave en cada reintento: si la respuesta se perdió, no se emite dos veces.
    val clave = remember { UUID.randomUUID().toString() }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(intento) {
        cargaError = null
        try { estado = EstadoEmitir(api.servicios()) } catch (e: ErrorApi) { cargaError = e.message }
    }

    val e = estado
    LaunchedEffect(e?.busqueda) {
        if (e == null) return@LaunchedEffect
        val q = e.busqueda.trim()
        e.errorBusqueda = null
        if (q.length < 2) {
            e.resultados = null
            e.buscando = false
            return@LaunchedEffect
        }
        e.buscando = true
        delay(300)
        try {
            e.resultados = api.clientes(q)
        } catch (x: ErrorApi) {
            e.resultados = null
            e.errorBusqueda = x.message
        } finally {
            e.buscando = false
        }
    }

    // Una placa conocida trae a su cliente, siempre que no se haya elegido otro.
    LaunchedEffect(e?.placa) {
        if (e == null || e.cliente != null || e.placa.length < 6) return@LaunchedEffect
        delay(350)
        val placa = e.placa
        runCatching { api.clientes(placa) }.getOrNull()?.firstOrNull { it.placa == placa }?.let { if (e.cliente == null) e.elegir(it) }
    }

    when {
        cargaError != null -> ErrorRecarga(cargaError!!, { intento++ })
        e == null -> Cargando()
        else -> EmitirContenido(
            e, error, enviando, onVolver,
            onAgregarCliente = {
                val q = e.busqueda.trim()
                val soloDigitos = q.isNotEmpty() && q.all(Char::isDigit)
                nuevoCliente = EstadoCliente(null).apply {
                    esRuc = e.factura || (soloDigitos && q.length == 11)
                    if (soloDigitos) documento = q.take(largo) else nombre = q.uppercase()
                    if (e.telefono.isNotBlank()) telefono = e.telefono
                    placa = e.placa
                }
            },
            onEmitir = {
                ambito.launch {
                    enviando = true
                    error = null
                    try {
                        val items = e.servicios.filter { (e.cantidades[it.id] ?: 0) > 0 }
                            .map { ItemEmitir(it.codigo, it.nombre, e.cantidades[it.id].toString(), it.precio) }
                        val c = e.cliente
                        val comprobante = api.emitir(
                            EmitirPedido(
                                clave, if (e.factura) "01" else "03", c?.tipoDoc ?: "0", c?.numDoc.orEmpty(), c?.nombre.orEmpty(),
                                c?.direccion.orEmpty(), e.telefono, e.placa, e.medio, items,
                            ),
                        )
                        onEmitido(comprobante.id)
                    } catch (x: ErrorApi) {
                        error = x.message
                    } finally {
                        enviando = false
                    }
                }
            },
        )
    }

    nuevoCliente?.let { formulario ->
        ModalBottomSheet(
            onDismissRequest = { nuevoCliente = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
        ) {
            Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
                Text("Nuevo cliente", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 16.dp, bottom = 12.dp))
                FormularioCliente(
                    api, formulario, consultarAlAbrir = true, textoGuardar = "Guardar y usar",
                    onGuardado = { guardado ->
                        e?.elegir(guardado)
                        nuevoCliente = null
                    },
                )
            }
        }
    }
}

@Composable
fun EmitirContenido(
    e: EstadoEmitir,
    error: String?,
    enviando: Boolean,
    onVolver: () -> Unit,
    onAgregarCliente: () -> Unit,
    onEmitir: () -> Unit,
) {
    Column(Modifier.fillMaxSize().imePadding()) {
        Barra("Nuevo comprobante", onVolver)
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Segmentos(listOf("Boleta", "Factura"), if (e.factura) 1 else 0, { e.factura = it == 1 })
            Campo(e.placa, { v -> e.placa = v.uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(8) }, "Placa del vehículo", mayusculas = true)

            Seccion(if (e.factura) "Cliente con RUC" else "Cliente", Modifier.padding(top = 4.dp))
            SeccionCliente(e, onAgregarCliente)

            Seccion("Servicios", Modifier.padding(top = 4.dp))
            Column(Modifier.fillMaxWidth().clip(Radio12).background(MaterialTheme.colorScheme.surface).border(1.dp, Firme.c.linea, Radio12)) {
                e.servicios.forEachIndexed { i, s ->
                    FilaServicio(s, e.cantidades[s.id] ?: 0) { n -> e.cantidades[s.id] = n.coerceIn(0, 99) }
                    if (i < e.servicios.lastIndex) Divisor(Modifier.padding(start = 16.dp))
                }
            }

            Seccion("Medio de pago", Modifier.padding(top = 4.dp))
            Opciones(MEDIOS_ETIQUETA.toList(), e.medio, { e.medio = it })
            error?.let { Aviso(it, Firme.c.rechazado, titulo = "No se pudo emitir") }
        }
        Divisor()
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Total", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                Text(soles(e.total), style = Estilo.montoMedio)
            }
            Spacer(Modifier.width(12.dp))
            BotonEmitir(if (e.factura) "Emitir factura" else "Emitir boleta", onEmitir, cargando = enviando, activo = e.listo)
        }
    }
}

@Composable
private fun SeccionCliente(e: EstadoEmitir, onAgregar: () -> Unit) {
    val agenda = rememberAgenda { _, t -> e.telefono = t }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val elegido = e.cliente
        if (elegido != null) {
            Row(
                Modifier.fillMaxWidth().clip(Radio12).background(MaterialTheme.colorScheme.surface).border(1.dp, Firme.c.linea, Radio12)
                    .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(elegido.nombre, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(650))
                    Text("${elegido.etiquetaDoc} ${elegido.numDoc}", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                    if (elegido.direccion.isNotBlank()) {
                        Text(elegido.direccion, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave, maxLines = 2)
                    }
                }
                TextButton(onClick = e::quitarCliente, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cambiar") }
            }
        } else {
            Campo(e.busqueda, { e.busqueda = it.take(60) }, "Nombre, DNI, RUC, placa o celular")
            BuscadorResultados(e, onAgregar)
        }
        e.problemaCliente?.takeIf { elegido != null || e.factura || e.hayServicios }?.let { Aviso(it, Firme.c.observado) }
        Campo(
            e.telefono, { v -> e.telefono = v.filter(Char::isDigit).take(11) }, "WhatsApp (opcional)", teclado = KeyboardType.Phone,
            accion = { IconButton(onClick = agenda) { Icon(Icons.Filled.Contacts, "Elegir de la agenda del teléfono") } },
        )
    }
}

@Composable
private fun BuscadorResultados(e: EstadoEmitir, onAgregar: () -> Unit) {
    val q = e.busqueda.trim()
    val lista = e.coincidencias
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        e.errorBusqueda?.let { Aviso(it, Firme.c.rechazado) }
        if (e.buscando) Text("Buscando…", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
        if (!lista.isNullOrEmpty()) {
            Column(Modifier.fillMaxWidth().clip(Radio12).background(MaterialTheme.colorScheme.surface).border(1.dp, Firme.c.linea, Radio12)) {
                lista.forEachIndexed { i, c ->
                    Column(Modifier.fillMaxWidth().clickable { e.elegir(c) }.heightIn(min = 60.dp).padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(c.nombre, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(600), maxLines = 1)
                        Text(
                            listOf("${c.etiquetaDoc} ${c.numDoc}", c.placa, c.telefono).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave,
                        )
                    }
                    if (i < lista.lastIndex) Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
        if (lista != null && lista.isEmpty() && !e.buscando) {
            Text("No encontramos a «$q» en tus clientes.", style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Start)
        }
        BotonSecundario(
            if (lista != null && lista.isEmpty() && !e.buscando) "Agregar nuevo cliente" else "Nuevo cliente",
            onAgregar, Modifier.fillMaxWidth(), Icons.Filled.PersonAdd,
        )
        if (!e.factura && q.isEmpty()) {
            Text("Sin elegir cliente, se emite a Clientes varios.", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
        }
    }
}

@Composable
private fun FilaServicio(s: Servicio, cantidad: Int, onCantidad: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { if (cantidad == 0) onCantidad(1) }.heightIn(min = 64.dp).padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(s.nombre, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(if (cantidad > 0) 650 else 450))
            Text(soles(s.precio), style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
        }
        if (cantidad == 0) {
            BotonCantidad(Icons.Filled.Add, "Agregar ${s.nombre}", false) { onCantidad(1) }
        } else {
            BotonCantidad(Icons.Filled.Remove, "Quitar uno", false) { onCantidad(cantidad - 1) }
            Text("$cantidad", style = Estilo.montoMedio, modifier = Modifier.width(32.dp), textAlign = TextAlign.Center)
            BotonCantidad(Icons.Filled.Add, "Agregar uno", true) { onCantidad(cantidad + 1) }
        }
    }
}

@Composable
private fun BotonCantidad(icono: androidx.compose.ui.graphics.vector.ImageVector, descripcion: String, resaltado: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(36.dp).clip(Radio8)
                .background(if (resaltado) Senal else MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icono, descripcion, Modifier.size(20.dp), tint = if (resaltado) TintaFija else MaterialTheme.colorScheme.onSurface)
        }
    }
}
