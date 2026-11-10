package pe.elfirme.caja.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.ErrorApi
import pe.elfirme.caja.data.HuellaPorConfirmar
import pe.elfirme.caja.data.SERVIDOR_PREDETERMINADO
import pe.elfirme.caja.data.Usuario
import pe.elfirme.caja.data.codigoEmpresaValido
import pe.elfirme.caja.data.servidorDeEmpresa

@Composable
fun Marca(modifier: Modifier = Modifier) {
    Column(modifier) {
        Box(Modifier.size(width = 48.dp, height = 8.dp).background(Senal))
        Spacer(Modifier.height(16.dp))
        Text("Infosmart", style = MaterialTheme.typography.headlineMedium.copy(fontSize = 44.sp, lineHeight = 48.sp))
        Text("Lavadero · caja y comprobantes", style = MaterialTheme.typography.bodyLarge, color = Firme.c.tintaSuave)
    }
}

@Composable
fun PantallaAcceso(api: Api, onIngreso: (Usuario) -> Unit) {
    var usuario by remember { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var empresa by remember { mutableStateOf(api.prefs.empresa) }
    var servidor by remember { mutableStateOf(api.prefs.servidor) }
    // Servidor propio (instalación local): solo si no se usa un código de empresa.
    var verServidor by remember { mutableStateOf(api.prefs.empresa.isBlank() && api.prefs.servidor != SERVIDOR_PREDETERMINADO) }
    var error by remember { mutableStateOf<String?>(null) }
    var cargando by remember { mutableStateOf(false) }
    var huella by remember { mutableStateOf<String?>(null) }
    val ambito = rememberCoroutineScope()

    fun ingresar() {
        ambito.launch {
            cargando = true
            error = null
            try {
                val codigo = empresa.trim().lowercase()
                if (verServidor && servidor.isNotBlank()) {
                    api.prefs.empresa = ""
                    api.prefs.servidor = servidor.trim()
                } else if (codigoEmpresaValido(codigo)) {
                    api.prefs.empresa = codigo
                    api.prefs.servidor = servidorDeEmpresa(codigo)
                } else {
                    throw ErrorApi("Escribe el código de tu empresa, tal como te lo dio Infosmart.")
                }
                api.verificarServidor()
                onIngreso(api.ingresar(usuario, clave))
            } catch (e: HuellaPorConfirmar) {
                huella = e.huella
            } catch (e: ErrorApi) {
                error = e.message
            } finally {
                cargando = false
            }
        }
    }

    AccesoContenido(
        empresa, { empresa = it }, usuario, { usuario = it }, clave, { clave = it }, servidor, { servidor = it },
        verServidor, { verServidor = !verServidor }, error, cargando, ::ingresar,
    )

    huella?.let { h ->
        AlertDialog(
            onDismissRequest = { huella = null },
            title = { Text("Confirma tu servidor") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Esta huella debe ser idéntica a la que muestra el servidor al iniciar. Si no coincide, no continúes.")
                    Text(h, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                }
            },
            confirmButton = {
                TextButton(onClick = { api.prefs.huella = h; huella = null; ingresar() }) { Text("Coincide") }
            },
            dismissButton = { TextButton(onClick = { huella = null }) { Text("Cancelar") } },
        )
    }
}

@Composable
fun AccesoContenido(
    empresa: String, onEmpresa: (String) -> Unit,
    usuario: String, onUsuario: (String) -> Unit,
    clave: String, onClave: (String) -> Unit,
    servidor: String, onServidor: (String) -> Unit,
    verServidor: Boolean, onVerServidor: () -> Unit,
    error: String?, cargando: Boolean, onIngresar: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(40.dp))
        Marca()
        Spacer(Modifier.height(24.dp))
        if (!verServidor) {
            Campo(
                empresa, { onEmpresa(it.trim().lowercase()) }, "Código de empresa", teclado = KeyboardType.Uri,
                ayuda = "Te lo da Infosmart. Por ejemplo: miempresa",
            )
        }
        Campo(usuario, onUsuario, "Usuario")
        Campo(clave, onClave, "Clave", teclado = KeyboardType.Password, transformacion = PasswordVisualTransformation())
        error?.let { Aviso(it, Firme.c.rechazado) }
        BotonPrincipal("Ingresar", onIngresar, Modifier.fillMaxWidth(), cargando = cargando,
            activo = usuario.isNotBlank() && clave.isNotBlank() && (verServidor || empresa.isNotBlank()))
        TextButton(onClick = onVerServidor, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
            Text(if (verServidor) "Usar código de empresa" else "Usar un servidor propio", color = Firme.c.tintaSuave)
        }
        if (verServidor) Campo(servidor, onServidor, "Dirección del servidor", teclado = KeyboardType.Uri)
    }
}
