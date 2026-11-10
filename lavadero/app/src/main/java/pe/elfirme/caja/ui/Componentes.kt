package pe.elfirme.caja.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

val Radio8 = RoundedCornerShape(8.dp)
val Radio12 = RoundedCornerShape(12.dp)

data class InfoEstado(val etiqueta: String, val color: Color)

@Composable
fun infoEstado(estado: String): InfoEstado = when (estado) {
    "ACEPTADO" -> InfoEstado("Aceptado", Firme.c.aceptado)
    "OBSERVADO" -> InfoEstado("Observado", Firme.c.observado)
    "POR_ENVIAR" -> InfoEstado("Por enviar", Firme.c.proceso)
    "ANULANDO" -> InfoEstado("Anulando", Firme.c.proceso)
    "RECHAZADO" -> InfoEstado("Rechazado", Firme.c.rechazado)
    "ANULADO" -> InfoEstado("Anulado", Firme.c.anulado)
    else -> InfoEstado(estado, Firme.c.anulado)
}

@Composable
fun EstadoEtiqueta(estado: String, modifier: Modifier = Modifier) {
    val i = infoEstado(estado)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(i.color))
        Text(i.etiqueta, style = MaterialTheme.typography.labelMedium, color = i.color)
    }
}

@Composable
fun BotonEmitir(texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, cargando: Boolean = false, activo: Boolean = true) {
    Button(
        onClick = onClick,
        enabled = activo && !cargando,
        modifier = modifier.heightIn(min = 56.dp),
        shape = Radio8,
        colors = ButtonDefaults.buttonColors(
            containerColor = Senal, contentColor = TintaFija,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            disabledContentColor = Firme.c.tintaSuave,
        ),
    ) {
        if (cargando) CircularProgressIndicator(Modifier.size(22.dp), color = TintaFija, strokeWidth = 2.5.dp)
        else Text(texto, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun BotonPrincipal(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icono: ImageVector? = null,
    cargando: Boolean = false,
    activo: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = activo && !cargando,
        modifier = modifier.heightIn(min = 56.dp),
        shape = Radio8,
    ) {
        if (cargando) {
            CircularProgressIndicator(Modifier.size(22.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.5.dp)
        } else {
            icono?.let { Icon(it, null, Modifier.size(20.dp).padding(end = 0.dp)); androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp)) }
            Text(texto, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun BotonSecundario(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icono: ImageVector? = null,
    cargando: Boolean = false,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = !cargando,
        modifier = modifier.heightIn(min = 56.dp),
        shape = Radio8,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
        border = androidx.compose.foundation.BorderStroke(1.5.dp, color),
    ) {
        if (cargando) {
            CircularProgressIndicator(Modifier.size(22.dp), color = color, strokeWidth = 2.5.dp)
        } else {
            icono?.let { Icon(it, null, Modifier.size(20.dp)); androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp)) }
            Text(texto, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun Segmentos(opciones: List<String>, seleccion: Int, onCambio: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clip(Radio8).background(MaterialTheme.colorScheme.surfaceVariant).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        opciones.forEachIndexed { i, t ->
            val activo = i == seleccion
            Box(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (activo) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .clickable(role = Role.Tab) { onCambio(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    t,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (activo) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Opciones(opciones: List<Pair<String, String>>, seleccion: String?, onCambio: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        opciones.forEach { (valor, etiqueta) ->
            val activo = valor == seleccion
            Box(
                Modifier.heightIn(min = 48.dp).clip(Radio8)
                    .background(if (activo) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                    .border(1.dp, if (activo) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, Radio8)
                    .clickable(role = Role.RadioButton) { onCambio(valor) }
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    etiqueta,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (activo) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
fun Campo(
    valor: String,
    onCambio: (String) -> Unit,
    etiqueta: String,
    modifier: Modifier = Modifier,
    teclado: KeyboardType = KeyboardType.Text,
    mayusculas: Boolean = false,
    transformacion: VisualTransformation = VisualTransformation.None,
    error: String? = null,
    ayuda: String? = null,
    accion: (@Composable () -> Unit)? = null,
) {
    OutlinedTextField(
        value = valor,
        onValueChange = onCambio,
        label = { Text(etiqueta) },
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        shape = Radio8,
        isError = error != null,
        trailingIcon = accion,
        supportingText = (error ?: ayuda)?.let { { Text(it) } },
        visualTransformation = transformacion,
        keyboardOptions = KeyboardOptions(
            keyboardType = teclado,
            capitalization = if (mayusculas) KeyboardCapitalization.Characters else KeyboardCapitalization.Sentences,
        ),
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedBorderColor = MaterialTheme.colorScheme.primary,
        ),
    )
}

@Composable
fun Barra(titulo: String, onVolver: (() -> Unit)? = null, acciones: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(start = if (onVolver == null) 16.dp else 4.dp, end = 4.dp, top = 8.dp, bottom = 8.dp).heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onVolver != null) {
            IconButton(onClick = onVolver, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver")
            }
        }
        Text(titulo, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
        acciones()
    }
}

@Composable
fun Divisor(modifier: Modifier = Modifier) = HorizontalDivider(modifier, color = Firme.c.linea, thickness = 1.dp)

@Composable
fun Seccion(texto: String, modifier: Modifier = Modifier) {
    Text(texto, style = MaterialTheme.typography.titleMedium, modifier = modifier)
}

@Composable
fun Aviso(texto: String, color: Color, modifier: Modifier = Modifier, titulo: String? = null) {
    Row(
        modifier.fillMaxWidth().clip(Radio8).background(color.copy(alpha = 0.10f)).padding(12.dp).height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(color))
        Column {
            titulo?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = color) }
            Text(texto, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
fun Cargando(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().semantics { contentDescription = "Cargando" }, contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.onBackground, strokeWidth = 3.dp)
    }
}

@Composable
fun Vacio(titulo: String, detalle: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(titulo, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(detalle, style = MaterialTheme.typography.bodyMedium, color = Firme.c.tintaSuave, textAlign = TextAlign.Center)
    }
}

@Composable
fun ErrorRecarga(mensaje: String, onReintentar: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text(mensaje, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        BotonSecundario("Reintentar", onReintentar)
    }
}

val MargenLista = PaddingValues(bottom = 96.dp)
