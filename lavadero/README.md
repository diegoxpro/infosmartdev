# El Firme — Caja y comprobantes

App Android (Kotlin + Compose) y backend (FastAPI + PostgreSQL) para el autolavado **El Firme**: boletas y facturas electrónicas enviadas directo a SUNAT con el Certificado Digital Tributario (CDT), caja diaria, WhatsApp y ticketera inalámbrica.

```
app/       App Android
backend/   API, firma XML y envío a SUNAT
DESIGN.md  Sistema de diseño
PRODUCT.md Definición del producto
```

## 1. Instalar el backend en CasaOS (190.119.59.24)

Copia la carpeta `backend/` al servidor y, dentro de ella:

```bash
cp .env.example .env
nano .env
mkdir -p secretos
docker compose up -d --build
docker compose logs api | grep HUELLA
```

- Genera `JWT_SECRETO` con `openssl rand -base64 48` y usa claves propias para `DB_CLAVE` y `ADMIN_CLAVE`.
- Abre o redirige el puerto TCP `8443` del router hacia el servidor.
- Guarda la **huella** que aparece en los registros: la app la pedirá al primer ingreso.

El sistema arranca en **modo de prueba** (`SUNAT_ENTORNO=beta`). Los tickets salen marcados «PRUEBA · SIN VALOR TRIBUTARIO».

Para las pruebas también necesitas un `secretos/certificado.pfx`. Beta acepta uno autofirmado:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 365 -subj "/CN=PRUEBA"
openssl pkcs12 -export -inkey k.pem -in c.pem -out secretos/certificado.pfx -passout pass:prueba
rm k.pem c.pem
```

y en `.env`, `CERT_CLAVE=prueba`.

## 2. Pasar a producción con SUNAT

Sigue este orden; los comprobantes emitidos en producción son reales.

1. En SUNAT Operaciones en Línea: afíliate a **SEE-Del Contribuyente** y solicita el **CDT** (Empresas › Comprobantes de Pago › Certificado Digital Tributario).
2. Crea un **usuario secundario SOL** con perfil de emisión electrónica.
3. En la app, con un administrador, completa **Ajustes › Datos de la empresa**.
4. En **Ajustes › SUNAT y certificado**, escribe el RUC, el usuario secundario y la clave SOL, y carga el archivo `.pfx` o `.p12` con su contraseña.
5. Toca **Activar producción** y confirma. La app valida los datos, borra las ventas y gastos de prueba y reinicia la numeración. Los clientes se conservan.

El token de Decolecta, la clave SOL y el certificado se guardan cifrados en el servidor con `CLAVE_CIFRADO`. Respalda el archivo `.env`: sin esa clave habrá que volver a cargarlos.

## Consulta de DNI y RUC

En **Ajustes › Consulta DNI y RUC** guarda tu token de [Decolecta](https://decolecta.com/profile) y prueba la conexión. Si un cliente ya está guardado no se gasta ninguna consulta.

## 3. Instalar la app

Instala `El-Firme.apk` en cada equipo (permite instalar desde esta fuente). Al ingresar por primera vez, compara la huella con la del servidor.

Usuarios: el administrador crea cajeros en **Ajustes › Usuarios**. Solo un administrador puede anular comprobantes y cambiar precios.

## Ticketera

En **Ajustes › Ticketera**: elige Bluetooth (emparéjala antes en el celular) o Wi-Fi (IP, puerto 9100), el ancho de 58 u 80 mm e imprime una prueba. Funciona con ticketeras ESC/POS.

## Compilar

Requiere JDK 17 y Android SDK 35.

```bash
./gradlew :app:assembleRelease
./gradlew :app:recordPaparazziDebug
```

Pruebas del backend: `cd backend && python -m pytest -q`.

## Firma de la app

`secretos/elfirme.jks` y `keystore.properties` firman la app. **Guárdalos en un lugar seguro:** sin ellos no se pueden publicar actualizaciones sobre la app instalada.
