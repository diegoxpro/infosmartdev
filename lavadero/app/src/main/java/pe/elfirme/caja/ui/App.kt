package pe.elfirme.caja.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.Usuario

private data class Pestana(val ruta: String, val etiqueta: String, val icono: ImageVector)

private val PESTANAS = listOf(
    Pestana("caja", "Caja", Icons.Filled.PointOfSale),
    Pestana("clientes", "Clientes", Icons.Filled.People),
    Pestana("comprobantes", "Comprobantes", Icons.Filled.ReceiptLong),
    Pestana("ajustes", "Ajustes", Icons.Filled.Settings),
)

@Composable
fun BarraInferior(rutaActual: String?, onIr: (String) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
        PESTANAS.forEach { p ->
            NavigationBarItem(
                selected = rutaActual == p.ruta,
                onClick = { onIr(p.ruta) },
                icon = { Icon(p.icono, null) },
                label = { Text(p.etiqueta, style = MaterialTheme.typography.labelSmall, maxLines = 1, softWrap = false) },
                colors = NavigationBarItemDefaults.colors(
                    indicatorColor = Senal,
                    selectedIconColor = TintaFija,
                    selectedTextColor = MaterialTheme.colorScheme.onSurface,
                    unselectedIconColor = Firme.c.tintaSuave,
                    unselectedTextColor = Firme.c.tintaSuave,
                ),
            )
        }
    }
}

@Composable
fun AppFirme(api: Api) {
    var usuario by remember { mutableStateOf<Usuario?>(api.prefs.takeIf { it.token != null }?.usuario) }
    val cerrada by api.sesionCerrada.collectAsState()
    LaunchedEffect(cerrada) { if (cerrada) usuario = null }

    val actual = usuario
    if (actual == null) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            PantallaAcceso(api) { usuario = it }
        }
        return
    }

    val nav = rememberNavController()
    val entrada by nav.currentBackStackEntryAsState()
    val ruta = entrada?.destination?.route
    val conBarra = PESTANAS.any { it.ruta == ruta }
    val irA: (String) -> Unit = { destino ->
        nav.navigate(destino) {
            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = { if (conBarra) BarraInferior(ruta, irA) },
    ) { relleno ->
        NavHost(nav, startDestination = "caja", modifier = Modifier.padding(relleno).consumeWindowInsets(relleno)) {
            composable("caja") {
                PantallaCaja(api, actual, onEmitir = { nav.navigate("emitir") }, onMes = { nav.navigate("mes") },
                    onComprobante = { nav.navigate("detalle/$it") })
            }
            composable("mes") { PantallaMes(api) { nav.popBackStack() } }
            composable("comprobantes") {
                PantallaComprobantes(api, onEmitir = { nav.navigate("emitir") }, onAbrir = { nav.navigate("detalle/$it") })
            }
            composable("sunat") { PantallaSunat(api, onVolver = { nav.popBackStack() }, onAbrir = { nav.navigate("detalle/$it") }) }
            composable("ajustes") {
                PantallaAjustes(api, actual, onIr = { nav.navigate(it) }, onSalir = { api.cerrarSesion() })
            }
            composable("emitir") {
                PantallaEmitir(api, onVolver = { nav.popBackStack() }, onEmitido = { id ->
                    nav.navigate("detalle/$id") { popUpTo("emitir") { inclusive = true } }
                })
            }
            composable("detalle/{id}", listOf(navArgument("id") { type = NavType.IntType })) { e ->
                PantallaDetalle(api, actual, e.arguments!!.getInt("id")) { nav.popBackStack() }
            }
            composable("clientes") { PantallaClientes(api, onAbrir = { nav.navigate("cliente/$it") }) }
            composable("cliente/{id}", listOf(navArgument("id") { type = NavType.IntType })) { e ->
                PantallaCliente(api, actual, e.arguments!!.getInt("id")) { nav.popBackStack() }
            }
            composable("impuestos") { PantallaImpuestos(api) { nav.popBackStack() } }
            composable("consultas") { PantallaConsultas(api) { nav.popBackStack() } }
            composable("config-sunat") { PantallaConfigSunat(api) { nav.popBackStack() } }
            composable("impresora") { PantallaImpresora(api) { nav.popBackStack() } }
            composable("servicios") { PantallaServicios(api) { nav.popBackStack() } }
            composable("empresa") { PantallaEmpresa(api) { nav.popBackStack() } }
            composable("usuarios") { PantallaUsuarios(api, actual) { nav.popBackStack() } }
        }
    }
}
