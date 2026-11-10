package pe.elfirme.caja

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import pe.elfirme.caja.data.Api
import pe.elfirme.caja.data.Preferencias
import pe.elfirme.caja.ui.AppFirme
import pe.elfirme.caja.ui.TemaFirme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api = Api(Preferencias(applicationContext))
        setContent {
            TemaFirme {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                    AppFirme(api)
                }
            }
        }
    }
}
