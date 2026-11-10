package pe.elfirme.caja.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import pe.elfirme.caja.R

val TintaFija = Color(0xFF16181B)
val Senal = Color(0xFFFFC400)

@Immutable
data class Paleta(
    val tintaSuave: Color,
    val linea: Color,
    val aceptado: Color,
    val observado: Color,
    val proceso: Color,
    val rechazado: Color,
    val anulado: Color,
)

private val PaletaClara = Paleta(
    Color(0xFF5A5D60), Color(0xFFDDD9CD), Color(0xFF0B6B3A), Color(0xFF8A5A00),
    Color(0xFF1F4E9E), Color(0xFFB3261E), Color(0xFF5A5D60),
)
private val PaletaOscura = Paleta(
    Color(0xFFA9A9A4), Color(0xFF34363A), Color(0xFF5FD28F), Color(0xFFF2B84B),
    Color(0xFF8DB4F5), Color(0xFFFF8F86), Color(0xFFA9A9A4),
)
val LocalPaleta = staticCompositionLocalOf { PaletaClara }

object Firme {
    val c: Paleta @Composable get() = LocalPaleta.current
}

@OptIn(ExperimentalTextApi::class)
private fun peso(p: Int) = Font(
    R.font.archivo,
    weight = FontWeight(p),
    variationSettings = FontVariation.Settings(FontVariation.weight(p)),
)

val Archivo = FontFamily(peso(450), peso(600), peso(650), peso(700))
private val Cifras = "tnum"

object Estilo {
    val monto = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(700), fontSize = 40.sp, lineHeight = 46.sp, fontFeatureSettings = Cifras)
    val montoMedio = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(700), fontSize = 22.sp, lineHeight = 28.sp, fontFeatureSettings = Cifras)
    val montoFila = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(650), fontSize = 16.sp, lineHeight = 22.sp, fontFeatureSettings = Cifras)
}

private val Tipos = Typography(
    headlineSmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(700), fontSize = 22.sp, lineHeight = 28.sp),
    titleLarge = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(700), fontSize = 22.sp, lineHeight = 28.sp),
    bodySmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(450), fontSize = 13.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(600), fontSize = 12.sp, lineHeight = 16.sp),
    headlineMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(700), fontSize = 26.sp, lineHeight = 32.sp),
    titleMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(650), fontSize = 18.sp, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(450), fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(450), fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(650), fontSize = 16.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight(600), fontSize = 13.sp, lineHeight = 18.sp),
)

@Composable
fun TemaFirme(oscuro: Boolean = isSystemInDarkTheme(), contenido: @Composable () -> Unit) {
    val esquema = if (oscuro) {
        darkColorScheme(
            primary = Color(0xFFF3F1EA), onPrimary = TintaFija, secondary = Senal, onSecondary = TintaFija,
            background = Color(0xFF121315), onBackground = Color(0xFFF3F1EA),
            surface = Color(0xFF1D1E21), onSurface = Color(0xFFF3F1EA),
            surfaceVariant = Color(0xFF28292D), onSurfaceVariant = Color(0xFFA9A9A4),
            outline = Color(0xFF55585C), outlineVariant = Color(0xFF34363A), error = Color(0xFFFF8F86),
            surfaceContainerLow = Color(0xFF1D1E21), surfaceContainerHigh = Color(0xFF1D1E21),
            surfaceContainer = Color(0xFF1D1E21), surfaceContainerHighest = Color(0xFF28292D),
        )
    } else {
        lightColorScheme(
            primary = TintaFija, onPrimary = Color.White, secondary = Senal, onSecondary = TintaFija,
            background = Color(0xFFF5F3EC), onBackground = TintaFija,
            surface = Color.White, onSurface = TintaFija,
            surfaceVariant = Color(0xFFEDEADF), onSurfaceVariant = Color(0xFF5A5D60),
            outline = Color(0xFF8B8C89), outlineVariant = Color(0xFFDDD9CD), error = Color(0xFFB3261E),
            surfaceContainerLow = Color.White, surfaceContainerHigh = Color.White,
            surfaceContainer = Color.White, surfaceContainerHighest = Color(0xFFEDEADF),
        )
    }
    CompositionLocalProvider(LocalPaleta provides if (oscuro) PaletaOscura else PaletaClara) {
        MaterialTheme(colorScheme = esquema, typography = Tipos) {
            CompositionLocalProvider(LocalContentColor provides esquema.onBackground, content = contenido)
        }
    }
}
