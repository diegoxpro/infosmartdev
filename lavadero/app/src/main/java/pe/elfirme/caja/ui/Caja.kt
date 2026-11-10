package pe.elfirme.caja.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.CajaDia
import pe.elfirme.caja.data.CajaMes
import pe.elfirme.caja.data.Categorias
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.MEDIOS_ETIQUETA
import pe.elfirme.caja.data.Movimiento
import pe.elfirme.caja.data.MovimientoPedido
import pe.elfirme.caja.data.Usuario
import pe.elfirme.caja.data.etiquetaMedio
import pe.elfirme.caja.data.soles
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

val ES = Locale("es", "PE")
private val FORMATO_DIA = DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", ES)

fun etiquetaDia(f: LocalDate, hoy: LocalDate = LocalDate.now()): String {
    val texto = f.format(FORMATO_DIA).replaceFirstChar { it.titlecase(ES) }
    return when (f) {
        hoy -> "Hoy · $texto"
        hoy.minusDays(1) -> "Ayer · $texto"
        else -> texto
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PantallaCaja(api: Api, usuario: Usuario, onEmitir: () -> Unit, onMes: () -> Unit, onComprobante: (Int) -> Unit) {
    var fecha by remember { mutableStateOf(LocalDate.now()) }
    var dia by remember { mutableStateOf<CajaDia?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var hoja by remember { mutableStateOf<String?>(null) }
    var cats by remember { mutableStateOf<Categorias?>(null) }
    var seleccionado by remember { mutableStateOf<Movimiento?>(null) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(fecha, recarga) {
        error = null
        try {
            dia = api.cajaDia(fecha.toString())
        } catch (e: ErrorApi) {
            if (dia == null) error = e.message
        }
    }

    val d = dia
    when {
        error != null -> ErrorRecarga(error!!, { recarga++ })
        d == null -> Cargando()
        else -> CajaContenido(
            d, etiquetaDia(fecha), fecha < LocalDate.now(),
            onAnterior = { fecha = fecha.minusDays(1); dia = null },
            onSiguiente = { fecha = fecha.plusDays(1); dia = null },
            onRegistrar = { tipo ->
                hoja = tipo
                ambito.launch { if (cats == null) cats = runCatching { api.categorias() }.getOrNull() }
            },
            onEmitir = onEmitir, onMes = onMes,
            onMovimiento = { m -> if (m.comprobanteId != null) onComprobante(m.comprobanteId) else seleccionado = m },
        )
    }

    hoja?.let { tipo ->
        ModalBottomSheet(
            onDismissRequest = { hoja = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
        ) {
            FormularioMovimiento(tipo, cats, api) { hoja = null; recarga++ }
        }
    }

    seleccionado?.let { m ->
        ModalBottomSheet(onDismissRequest = { seleccionado = null }, containerColor = MaterialTheme.colorScheme.background) {
            Column(Modifier.padding(16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(m.categoria, style = MaterialTheme.typography.titleMedium)
                Text(soles(m.monto), style = Estilo.monto)
                Text(
                    listOf(m.descripcion, etiquetaMedio(m.medioPago), m.hora, m.usuario).filter { it.isNotBlank() }.joinToString(" · "),
                    color = Firme.c.tintaSuave,
                )
                if (usuario.esAdmin) {
                    BotonSecundario("Anular movimiento", {
                        ambito.launch {
                            runCatching { api.anularMovimiento(m.id) }
                            seleccionado = null
                            recarga++
                        }
                    }, Modifier.fillMaxWidth(), color = Firme.c.rechazado)
                }
            }
        }
    }
}

@Composable
fun CajaContenido(
    d: CajaDia,
    etiquetaFecha: String,
    puedeSiguiente: Boolean,
    onAnterior: () -> Unit,
    onSiguiente: () -> Unit,
    onRegistrar: (String) -> Unit,
    onEmitir: () -> Unit,
    onMes: () -> Unit,
    onMovimiento: (Movimiento) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f)) {
            item {
                Barra("Caja") { TextButton(onClick = onMes, Modifier.heightIn(min = 48.dp)) { Text("Ver mes", color = MaterialTheme.colorScheme.onBackground) } }
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onAnterior, Modifier.height(48.dp)) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Día anterior") }
                    Text(etiquetaFecha, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                    if (puedeSiguiente) IconButton(onClick = onSiguiente, Modifier.height(48.dp)) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Día siguiente") }
                }
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text("Saldo del día", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                    Text(soles(d.saldo), style = Estilo.monto)
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                        CifraConSigno("Ingresos", d.ingresos, "+", Firme.c.aceptado)
                        CifraConSigno("Gastos", d.gastos, "−", Firme.c.rechazado)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BotonSecundario("Gasto", { onRegistrar("gasto") }, Modifier.weight(1f), Icons.Filled.Add)
                    BotonSecundario("Ingreso", { onRegistrar("ingreso") }, Modifier.weight(1f), Icons.Filled.Add)
                }
                if (d.porMedio.isNotEmpty()) {
                    Seccion("Por medio de pago", Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
                    d.porMedio.forEach { (medio, monto) ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(etiquetaMedio(medio))
                            Text(soles(monto), style = Estilo.montoFila)
                        }
                    }
                }
                Seccion("Movimientos", Modifier.padding(start = 16.dp, top = 20.dp, bottom = 4.dp))
            }
            if (d.movimientos.isEmpty()) {
                item { Vacio("Sin movimientos", "Las ventas y los gastos del día aparecerán aquí.") }
            }
            items(d.movimientos, key = { it.id }) { m ->
                FilaMovimiento(m) { onMovimiento(m) }
                Divisor(Modifier.padding(start = 16.dp))
            }
        }
        Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).padding(horizontal = 16.dp, vertical = 12.dp)) {
            BotonEmitir("Emitir comprobante", onEmitir, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun CifraConSigno(titulo: String, monto: String, signo: String, color: androidx.compose.ui.graphics.Color) {
    val hayMonto = (monto.toBigDecimalOrNull()?.signum() ?: 0) != 0
    Column {
        Text(titulo, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
        Text(
            (if (hayMonto) signo else "") + soles(monto),
            style = Estilo.montoMedio,
            color = if (hayMonto) color else Firme.c.tintaSuave,
        )
    }
}

@Composable
private fun FilaMovimiento(m: Movimiento, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(m.descripcion.ifBlank { m.categoria }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight(600))
            Text("${m.hora} · ${m.categoria} · ${etiquetaMedio(m.medioPago)}", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
        }
        Spacer(Modifier.width(12.dp))
        Text(
            (if (m.esIngreso) "+" else "−") + soles(m.monto),
            style = Estilo.montoFila,
            color = if (m.esIngreso) Firme.c.aceptado else Firme.c.rechazado,
        )
    }
}

@Composable
private fun FormularioMovimiento(tipoInicial: String, cats: Categorias?, api: Api, onListo: () -> Unit) {
    var tipo by remember { mutableStateOf(tipoInicial) }
    var monto by remember { mutableStateOf("") }
    var categoria by remember { mutableStateOf<String?>(null) }
    var medio by remember { mutableStateOf("EFECTIVO") }
    var descripcion by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var cargando by remember { mutableStateOf(false) }
    val clave = remember { UUID.randomUUID().toString() }
    val ambito = rememberCoroutineScope()
    val lista = if (tipo == "gasto") cats?.gasto.orEmpty() else cats?.ingreso.orEmpty()
    val valor = monto.replace(',', '.').toBigDecimalOrNull()

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).imePadding().navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Segmentos(listOf("Gasto", "Ingreso"), if (tipo == "gasto") 0 else 1, { tipo = if (it == 0) "gasto" else "ingreso"; categoria = null })
        Campo(monto, { monto = it }, "Monto en soles", teclado = KeyboardType.Decimal)
        Seccion("Categoría")
        Opciones(lista.map { it to it }, categoria, { categoria = it })
        Seccion("Medio de pago")
        Opciones(MEDIOS_ETIQUETA.toList(), medio, { medio = it })
        Campo(descripcion, { descripcion = it }, "Descripción (opcional)")
        error?.let { Aviso(it, Firme.c.rechazado) }
        BotonPrincipal(
            if (tipo == "gasto") "Guardar gasto" else "Guardar ingreso",
            {
                ambito.launch {
                    cargando = true
                    error = null
                    try {
                        api.registrarMovimiento(MovimientoPedido(clave, tipo, categoria!!, descripcion, valor!!.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(), medio))
                        onListo()
                    } catch (e: ErrorApi) {
                        error = e.message
                    } finally {
                        cargando = false
                    }
                }
            },
            Modifier.fillMaxWidth().padding(bottom = 12.dp),
            cargando = cargando,
            activo = valor != null && valor.signum() > 0 && categoria != null,
        )
    }
}

@Composable
fun PantallaMes(api: Api, onVolver: () -> Unit) {
    val hoy = remember { LocalDate.now() }
    var mes by remember { mutableStateOf(hoy.withDayOfMonth(1)) }
    var datos by remember { mutableStateOf<CajaMes?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(mes) {
        datos = null
        error = null
        try { datos = api.cajaMes(mes.year, mes.monthValue) } catch (e: ErrorApi) { error = e.message }
    }

    val formato = remember { DateTimeFormatter.ofPattern("MMMM yyyy", ES) }
    val formatoDia = remember { DateTimeFormatter.ofPattern("EEE d", ES) }
    Column(Modifier.fillMaxSize()) {
        Barra("Resumen del mes", onVolver)
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { mes = mes.minusMonths(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Mes anterior") }
            Text(mes.format(formato).replaceFirstChar { it.titlecase(ES) }, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            if (mes < hoy.withDayOfMonth(1)) IconButton(onClick = { mes = mes.plusMonths(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Mes siguiente") }
        }
        val d = datos
        when {
            error != null -> ErrorRecarga(error!!, { mes = mes.withDayOfMonth(1) })
            d == null -> Cargando()
            else -> LazyColumn {
                item {
                    Column(Modifier.padding(16.dp)) {
                        Text("Saldo del mes", style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
                        Text(soles(d.saldo), style = Estilo.monto)
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                            CifraConSigno("Ingresos", d.ingresos, "+", Firme.c.aceptado)
                            CifraConSigno("Gastos", d.gastos, "−", Firme.c.rechazado)
                        }
                    }
                    Divisor()
                }
                if (d.dias.isEmpty()) item { Vacio("Sin movimientos este mes", "Elige otro mes con las flechas.") }
                items(d.dias, key = { it.fecha }) { dia ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(LocalDate.parse(dia.fecha).format(formatoDia).replaceFirstChar { it.titlecase(ES) }, Modifier.weight(1f), fontWeight = FontWeight(600))
                        Column(horizontalAlignment = Alignment.End) {
                            Text("+${soles(dia.ingresos)}", style = Estilo.montoFila, color = Firme.c.aceptado)
                            if ((dia.gastos.toBigDecimalOrNull()?.signum() ?: 0) > 0) Text("−${soles(dia.gastos)}", style = Estilo.montoFila, color = Firme.c.rechazado)
                        }
                    }
                    Divisor(Modifier.padding(start = 16.dp))
                }
            }
        }
    }
}
