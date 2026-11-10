import { createServer as crearHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as crearHttps, Server } from 'https';
import { asegurarCertificados, caPem, ipPrincipal, ipsLocales, puertos } from './certificados';

type Manejador = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Abre el sistema a los celulares de la red local:
 * - HTTPS (3443): la misma app y API, con el certificado de la CA propia.
 * - HTTP (3080): solo la página que recibe el QR, para instalar la CA la
 *   primera vez y pasar a HTTPS. Todo lo demás redirige a HTTPS.
 * HTTPS_PORT=0 lo desactiva.
 */
let https: Server | null = null;
let venceCertificado: Date | null = null;

/** Rehace el certificado si hace falta (IP nueva o por vencer) y lo carga sin reiniciar. */
export function renovarCertificado() {
  if (!https) return null;
  const cert = asegurarCertificados(ipsLocales());
  https.setSecureContext({ key: cert.key, cert: cert.cert });
  venceCertificado = cert.vence;
  return cert.vence;
}

export function estadoRed() {
  return { activo: !!https, vence: venceCertificado };
}

export function abrirRedLocal(app: Manejador) {
  if (!puertos.https) return;
  try {
    const cert = asegurarCertificados();
    venceCertificado = cert.vence;
    https = crearHttps({ key: cert.key, cert: cert.cert }, app).listen(puertos.https, '0.0.0.0');
    console.log(`Celulares: https://${ipPrincipal()}:${puertos.https} (certificado hasta ${cert.vence.toISOString().slice(0, 10)})`);
  } catch (e) {
    console.error('No se pudo abrir HTTPS para los celulares:', e);
    return;
  }
  https!.on('error', (e) => console.error('HTTPS para celulares:', e.message));

  // Renueva el certificado de la IP sin reiniciar (cambio de IP o por vencer).
  setInterval(() => {
    try {
      renovarCertificado();
    } catch (e) {
      console.error('No se pudo renovar el certificado de red:', e);
    }
  }, 30 * 60_000).unref();

  if (puertos.http) {
    crearHttp(paginaEntrada)
      .listen(puertos.http, '0.0.0.0')
      .on('error', (e) => console.error('HTTP para celulares:', e.message));
  }
}

export function urlHttps(ruta = '') {
  return `https://${ipPrincipal()}:${puertos.https}${ruta}`;
}

export function urlEntrada(ruta = '') {
  return `http://${ipPrincipal()}:${puertos.http}${ruta}`;
}

function paginaEntrada(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/ca.crt') {
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="candys-ca.crt"',
    });
    return res.end(caPem());
  }
  const m = /^\/i\/([A-Za-z0-9_-]{10,80})$/.exec(url.pathname);
  if (m || url.pathname === '/' || url.pathname === '/certificado') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html(m ? `/m/inventario?t=${m[1]}` : '/m/inventario'));
  }
  res.writeHead(302, { location: urlHttps(req.url ?? '/') });
  res.end();
}

function html(destino: string) {
  const ping = urlHttps('/api/red/ping');
  const ir = urlHttps(destino);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Candy's Market · Inventario</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f6f4f8;color:#222}
main{max-width:520px;margin:0 auto;padding:20px 16px}
h1{font-size:22px;color:#b0157a;margin:8px 0 4px}
.card{background:#fff;border-radius:12px;padding:16px;margin:14px 0;box-shadow:0 1px 3px #0002}
.btn{display:block;text-align:center;padding:14px;border-radius:10px;font-size:17px;font-weight:600;text-decoration:none;border:0;width:100%;margin-top:10px}
.prim{background:#16a34a;color:#fff}.sec{background:#eee;color:#222}
ol{padding-left:20px;line-height:1.5}small{color:#666}
#espera{text-align:center;padding:40px 0;font-size:17px}
</style></head><body><main>
<h1>Candy's Market · Inventario</h1>
<div id="espera">Conectando con la PC…</div>
<div id="instalar" hidden>
  <p>Este celular aún no tiene el <b>certificado de la tienda</b>. Se instala una sola vez y permite usar la cámara de forma segura.</p>
  <div class="card"><b>1. Descarga el certificado</b>
    <a class="btn sec" href="/ca.crt">Descargar certificado</a></div>
  <div class="card"><b>2. Instálalo</b>
    <p><b>Android:</b></p><ol>
      <li>Abre <b>Ajustes</b> y busca <b>"certificado"</b> (o ve a Seguridad › Más ajustes › Cifrado y credenciales).</li>
      <li>Toca <b>Instalar un certificado › Certificado de CA</b> y acepta el aviso.</li>
      <li>Elige <b>candys-ca.crt</b> en Descargas.</li></ol>
    <p><b>iPhone</b> (abre esta página en Safari):</p><ol>
      <li>Al descargar, toca <b>Permitir</b>.</li>
      <li><b>Ajustes › General › VPN y gestión de dispositivos</b>: instala el perfil "Candy's Market CA local".</li>
      <li><b>Ajustes › General › Información › Ajustes de confianza de certificados</b>: activa "Candy's Market CA local".</li></ol></div>
  <div class="card"><b>3. Entra al inventario</b>
    <button class="btn prim" onclick="probar(true)">Ya lo instalé, entrar</button>
    <small id="error"></small></div>
</div>
<script>
var destino=${JSON.stringify(ir)};
function probar(manual){
  var c=new AbortController();var t=setTimeout(function(){c.abort()},5000);
  fetch(${JSON.stringify(ping)},{signal:c.signal,cache:'no-store'}).then(function(r){
    if(!r.ok)throw 0;location.replace(destino);
  }).catch(function(){
    document.getElementById('espera').hidden=true;
    document.getElementById('instalar').hidden=false;
    if(manual)document.getElementById('error').textContent='Todavía no lo reconoce. Revisa el paso 2; en iPhone falta a veces activar la confianza.';
  }).finally(function(){clearTimeout(t)});
}
probar(false);
</script></main></body></html>`;
}
