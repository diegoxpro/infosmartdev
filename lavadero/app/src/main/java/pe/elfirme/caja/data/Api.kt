package pe.elfirme.caja.data

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.X509TrustManager

class ErrorApi(mensaje: String, val codigo: Int = 0) : Exception(mensaje)

/** El servidor presentó un certificado aún no confirmado por el usuario. */
class HuellaPorConfirmar(val huella: String) : Exception("Confirma la huella del servidor")

@OptIn(ExperimentalSerializationApi::class)
val JSON = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

const val SERVIDOR_PREDETERMINADO = "https://190.119.59.24:8443"

/** Dominio y puerto de Infosmart: cada empresa entra por https://<código>.<DOMINIO_NUBE>. */
const val DOMINIO_NUBE = "ciardi.lat:8093"

private val CODIGO_EMPRESA = Regex("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")

fun codigoEmpresaValido(codigo: String) = CODIGO_EMPRESA.matches(codigo)

fun servidorDeEmpresa(codigo: String) = "https://${codigo.trim().lowercase()}.$DOMINIO_NUBE"

class Preferencias(contexto: Context) {
    private val p: SharedPreferences = EncryptedSharedPreferences.create(
        contexto,
        "elfirme_seguro",
        MasterKey.Builder(contexto).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var servidor: String
        get() = p.getString("servidor", SERVIDOR_PREDETERMINADO) ?: SERVIDOR_PREDETERMINADO
        set(v) = p.edit().putString("servidor", v).apply()
    /** Código de empresa en Infosmart (su subdominio). Vacío cuando se usa un servidor propio. */
    var empresa: String
        get() = p.getString("empresa", "") ?: ""
        set(v) = p.edit().putString("empresa", v).apply()
    var huella: String?
        get() = p.getString("huella", null)
        set(v) = p.edit().putString("huella", v).apply()
    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit().putString("token", v).apply()
    var usuario: Usuario?
        get() = p.getString("usuario", null)?.let { JSON.decodeFromString(it) }
        set(v) = p.edit().putString("usuario", v?.let { JSON.encodeToString(it) }).apply()
    var impresoraTipo: String
        get() = p.getString("imp_tipo", "bluetooth") ?: "bluetooth"
        set(v) = p.edit().putString("imp_tipo", v).apply()
    var impresoraDireccion: String
        get() = p.getString("imp_dir", "") ?: ""
        set(v) = p.edit().putString("imp_dir", v).apply()
    var impresoraNombre: String
        get() = p.getString("imp_nombre", "") ?: ""
        set(v) = p.edit().putString("imp_nombre", v).apply()
    var impresoraAncho: Int
        get() = p.getInt("imp_ancho", 58)
        set(v) = p.edit().putInt("imp_ancho", v).apply()
}

/** Acepta únicamente el servidor cuya clave pública confirmó el usuario. */
private class ConfianzaFijada(private val esperada: () -> String?) : X509TrustManager {
    @Volatile var vista: String? = null

    override fun checkServerTrusted(cadena: Array<X509Certificate>, tipo: String) {
        val huella = Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(cadena[0].publicKey.encoded),
            Base64.NO_WRAP,
        )
        vista = huella
        if (huella != esperada()) throw CertificateException("Huella no confirmada")
    }

    override fun checkClientTrusted(cadena: Array<X509Certificate>, tipo: String) =
        throw CertificateException("No aplica")

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

class Api(val prefs: Preferencias) {
    val sesionCerrada = MutableStateFlow(false)
    private val confianza = ConfianzaFijada { prefs.huella }

    @SuppressLint("CustomX509TrustManager")
    private val http: OkHttpClient = OkHttpClient.Builder()
        .sslSocketFactory(
            SSLContext.getInstance("TLS").apply { init(null, arrayOf(confianza), SecureRandom()) }.socketFactory,
            confianza,
        )
        // La identidad del servidor la garantiza la huella fijada, no el nombre del certificado.
        .hostnameVerifier { _, _ -> true }
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    private val tipoJson = "application/json".toMediaType()

    private suspend fun llamar(metodo: String, ruta: String, cuerpo: String? = null, cuerpoCrudo: RequestBody? = null): String =
        String(ejecutar(metodo, ruta, cuerpoCrudo ?: cuerpo?.toRequestBody(tipoJson)), Charsets.UTF_8)

    private suspend fun binario(ruta: String): ByteArray = ejecutar("GET", ruta, null)

    private suspend fun ejecutar(metodo: String, ruta: String, cuerpo: RequestBody?): ByteArray = withContext(Dispatchers.IO) {
        val peticion = Request.Builder()
            .url(prefs.servidor.trimEnd('/') + ruta)
            .method(metodo, cuerpo ?: if (metodo == "PUT" || metodo == "POST") ByteArray(0).toRequestBody() else null)
            .apply { prefs.token?.let { header("Authorization", "Bearer $it") } }
            .build()
        try {
            http.newCall(peticion).execute().use { r ->
                val datos = r.body?.bytes() ?: ByteArray(0)
                if (r.isSuccessful) return@withContext datos
                val texto = String(datos, Charsets.UTF_8)
                if (r.code == 401 && prefs.token != null) {
                    cerrarSesion()
                    throw ErrorApi("Tu sesión terminó. Ingresa de nuevo.", 401)
                }
                val detalle = runCatching { JSON.parseToJsonElement(texto).jsonObject["detail"]?.jsonPrimitive?.content }.getOrNull()
                throw ErrorApi(detalle ?: "El servidor respondió con un error (${r.code}).", r.code)
            }
        } catch (e: SSLException) {
            val vista = confianza.vista
            if (vista != null && vista != prefs.huella) throw HuellaPorConfirmar(vista)
            throw ErrorApi("No se pudo establecer una conexión segura con el servidor.")
        } catch (e: IOException) {
            throw ErrorApi("Sin conexión con el servidor. Revisa tu internet e inténtalo otra vez.")
        }
    }

    private suspend inline fun <reified T> get(ruta: String): T = JSON.decodeFromString(llamar("GET", ruta))
    private suspend inline fun <reified T, reified B> post(ruta: String, cuerpo: B): T =
        JSON.decodeFromString(llamar("POST", ruta, JSON.encodeToString(cuerpo)))

    private fun url(v: String) = URLEncoder.encode(v, "UTF-8")

    fun cerrarSesion() {
        prefs.token = null
        prefs.usuario = null
        sesionCerrada.value = true
    }

    suspend fun verificarServidor() {
        llamar("GET", "/health")
    }

    suspend fun ingresar(usuario: String, clave: String): Usuario {
        val s: Sesion = post("/auth/login", mapOf("usuario" to usuario.trim(), "clave" to clave))
        prefs.token = s.token
        prefs.usuario = s.usuario
        sesionCerrada.value = false
        return s.usuario
    }

    suspend fun empresa(): Empresa = get("/empresa")
    suspend fun guardarEmpresa(e: Empresa) {
        llamar("PUT", "/empresa", JSON.encodeToString(e))
    }

    private var logoEnMemoria: Pair<Int, Bitmap?>? = null

    /** Logo del comprobante, descargado una sola vez por versión. */
    suspend fun logo(e: Empresa): Bitmap? {
        if (!e.tieneLogo) return null
        logoEnMemoria?.takeIf { it.first == e.logoVersion }?.let { return it.second }
        val bytes = binario("/empresa/logo")
        val bmp = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
        logoEnMemoria = e.logoVersion to bmp
        return bmp
    }

    suspend fun subirLogo(png: ByteArray) {
        llamar("PUT", "/empresa/logo", cuerpoCrudo = png.toRequestBody("image/png".toMediaType()))
    }

    suspend fun quitarLogo() {
        llamar("DELETE", "/empresa/logo")
    }

    suspend fun clientes(q: String): List<ClienteGuardado> = get("/clientes?q=${url(q)}")
    suspend fun cliente(id: Int): ClienteGuardado = get("/clientes/$id")
    suspend fun guardarCliente(c: ClienteGuardado): ClienteGuardado {
        val cuerpo = JSON.encodeToString(ClientePedido(c.tipoDoc, c.numDoc, c.nombre, c.direccion, c.telefono, c.placa))
        return JSON.decodeFromString(if (c.id == null) llamar("POST", "/clientes", cuerpo) else llamar("PUT", "/clientes/${c.id}", cuerpo))
    }

    suspend fun eliminarCliente(id: Int) {
        llamar("DELETE", "/clientes/$id")
    }

    suspend fun consultar(tipo: String, numero: String): ClienteGuardado = get("/consulta/$tipo/$numero")

    suspend fun ajustesVentas(): AjustesVentas = get("/ajustes/ventas")
    suspend fun guardarVentas(afectacion: String) {
        llamar("PUT", "/ajustes/ventas", JSON.encodeToString(AjustesVentas(afectacion)))
    }

    suspend fun ajustesConsultas(): AjustesConsultas = get("/ajustes/consultas")
    suspend fun guardarConsultas(activo: Boolean, token: String): AjustesConsultas =
        JSON.decodeFromString(llamar("PUT", "/ajustes/consultas", JSON.encodeToString(ConsultasPedido(activo, token))))

    suspend fun probarConsultas(token: String): ResultadoPrueba = post("/ajustes/consultas/probar", mapOf("token" to token))

    suspend fun ajustesSunat(): AjustesSunat = get("/ajustes/sunat")
    suspend fun guardarSunat(ruc: String, usuario: String, clave: String): AjustesSunat =
        JSON.decodeFromString(llamar("PUT", "/ajustes/sunat", JSON.encodeToString(mapOf("ruc" to ruc, "usuario" to usuario, "clave" to clave))))

    suspend fun subirCertificado(pfx: ByteArray, clave: String): AjustesSunat {
        val b64 = Base64.encodeToString(pfx, Base64.NO_WRAP)
        return JSON.decodeFromString(llamar("PUT", "/ajustes/sunat/certificado", JSON.encodeToString(mapOf("archivo_b64" to b64, "clave" to clave))))
    }

    suspend fun activarProduccion(confirmacion: String): AjustesSunat =
        post("/ajustes/sunat/activar-produccion", mapOf("confirmacion" to confirmacion))

    suspend fun servicios(todos: Boolean = false): List<Servicio> = get("/servicios?todos=$todos")
    suspend fun guardarServicio(id: Int?, nombre: String, precio: String, categoria: String, activo: Boolean) {
        val cuerpo = JSON.encodeToString(ServicioPedido(nombre, precio, categoria, activo))
        if (id == null) llamar("POST", "/servicios", cuerpo) else llamar("PUT", "/servicios/$id", cuerpo)
    }

    suspend fun buscarClientes(q: String): List<ClienteGuardado> = get("/clientes?q=${url(q)}")
    suspend fun emitir(p: EmitirPedido): Comprobante = post("/comprobantes", p)
    suspend fun comprobante(id: Int): Comprobante = get("/comprobantes/$id")
    suspend fun comprobantes(q: String, tipo: String, estado: String): List<Comprobante> =
        get("/comprobantes?q=${url(q)}&tipo=$tipo&estado=$estado")

    suspend fun reenviar(id: Int): Comprobante = JSON.decodeFromString(llamar("POST", "/comprobantes/$id/reenviar", "{}"))
    suspend fun anular(id: Int, motivo: String): Comprobante = post("/comprobantes/$id/anular", mapOf("motivo" to motivo))

    suspend fun control(): ControlSunat = get("/sunat/control")
    suspend fun enviarPendientes() {
        llamar("POST", "/sunat/enviar-pendientes", "{}")
    }

    suspend fun cajaDia(fecha: String?): CajaDia = get("/caja/dia" + (fecha?.let { "?fecha=$it" } ?: ""))
    suspend fun cajaMes(anio: Int, mes: Int): CajaMes = get("/caja/mes?anio=$anio&mes=$mes")
    suspend fun categorias(): Categorias = get("/caja/categorias")
    suspend fun registrarMovimiento(m: MovimientoPedido) {
        llamar("POST", "/movimientos", JSON.encodeToString(m))
    }

    suspend fun anularMovimiento(id: Int) {
        llamar("DELETE", "/movimientos/$id")
    }

    suspend fun usuarios(): List<Usuario> = get("/usuarios")
    suspend fun crearUsuario(usuario: String, nombre: String, clave: String, rol: String) {
        llamar("POST", "/usuarios", JSON.encodeToString(UsuarioPedido(usuario, nombre, clave, rol)))
    }

    suspend fun cambiarActivo(id: Int, activo: Boolean) {
        llamar("PATCH", "/usuarios/$id", """{"activo":$activo}""")
    }
}

@kotlinx.serialization.Serializable
private data class ClientePedido(
    val tipoDoc: String,
    val numDoc: String,
    val nombre: String,
    val direccion: String,
    val telefono: String,
    val placa: String,
)

@kotlinx.serialization.Serializable
private data class ConsultasPedido(val activo: Boolean, val token: String)

@kotlinx.serialization.Serializable
private data class ServicioPedido(val nombre: String, val precio: String, val categoria: String, val activo: Boolean)

@kotlinx.serialization.Serializable
private data class UsuarioPedido(val usuario: String, val nombre: String, val clave: String, val rol: String)
