package pe.elfirme.caja.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.Comprobante
import pe.elfirme.caja.data.ControlSunat
import pe.elfirme.caja.data.ErrorApi

@Composable
fun PantallaSunat(api: Api, onVolver: () -> Unit, onAbrir: (Int) -> Unit) {
    var datos by remember { mutableStateOf<ControlSunat?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var recarga by remember { mutableIntStateOf(0) }
    val ambito = rememberCoroutineScope()

    LaunchedEffect(recarga) {
        error = null
        try { datos = api.control() } catch (e: ErrorApi) { error = e.message }
    }

    val d = datos
    Column(Modifier.fillMaxSize()) {
        Barra("Control SUNAT", onVolver)
        when {
            error != null && d == null -> ErrorRecarga(error!!, { recarga++ })
            d == null -> Cargando()
            else -> SunatContenido(d, error, enviando, onAbrir) {
                ambito.launch {
                    enviando = true
                    try { api.enviarPendientes() } catch (e: ErrorApi) { error = e.message }
                    enviando = false
                    recarga++
                }
            }
        }
    }
}

private fun detalle(c: Comprobante): String = when (c.estado) {
    "POR_ENVIAR" -> {
        val d = c.diasRestantes ?: 0
        when {
            d < 0 -> "Plazo vencido hace ${-d} días"
            d == 0 -> "El plazo vence hoy"
            d == 1 -> "Queda 1 día · ${c.intentos} intentos"
            else -> "Quedan $d días · ${c.intentos} intentos"
        }
    }
    "RECHAZADO" -> "${c.sunatCodigo}: ${c.sunatMensaje}"
    "ANULANDO" -> "Esperando respuesta de SUNAT"
    else -> c.fecha
}

@Composable
fun SunatContenido(d: ControlSunat, error: String?, enviando: Boolean, onAbrir: (Int) -> Unit, onEnviar: () -> Unit) {
    val n = { e: String -> d.conteo[e] ?: 0 }
    val pendientes = n("POR_ENVIAR")
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (d.entorno != "produccion") {
                    Aviso("Los comprobantes se envían al ambiente de pruebas y no tienen valor tributario.", Firme.c.observado, titulo = "Modo de prueba")
                }
                Row(Modifier.fillMaxWidth()) {
                    Contador("Por enviar", pendientes, Firme.c.proceso, Modifier.weight(1f))
                    Contador("Rechazados", n("RECHAZADO"), Firme.c.rechazado, Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth()) {
                    Contador("Aceptados", n("ACEPTADO") + n("OBSERVADO"), Firme.c.aceptado, Modifier.weight(1f))
                    Contador("Anulados", n("ANULADO") + n("ANULANDO"), Firme.c.anulado, Modifier.weight(1f))
                }
                error?.let { Aviso(it, Firme.c.rechazado) }
                if (pendientes > 0) BotonPrincipal("Enviar $pendientes pendientes ahora", onEnviar, Modifier.fillMaxWidth(), cargando = enviando)
                Seccion("Por atender", Modifier.padding(top = 8.dp))
            }
        }
        if (d.porAtender.isEmpty()) {
            item { Vacio("Todo al día", "SUNAT ya respondió todos tus comprobantes.") }
        }
        items(d.porAtender, key = { it.id }) { c ->
            FilaComprobante(c, detalle(c)) { onAbrir(c.id) }
            Divisor(Modifier.padding(start = 16.dp))
        }
    }
}

@Composable
private fun Contador(titulo: String, valor: Int, color: Color, modifier: Modifier) {
    Column(modifier.padding(vertical = 6.dp)) {
        Text("$valor", style = Estilo.monto.copy(color = if (valor == 0) Firme.c.tintaSuave else color))
        Text(titulo, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave)
    }
}
