# Candy's Market · Sistema de ventas

Sistema de ventas para minimarket que funciona **sin internet** en la PC de la tienda.

- `backend/`: API en NestJS + Prisma + PostgreSQL.
- `frontend/`: interfaz web en React + Vite.

## Qué incluye

| Módulo | Qué hace |
| --- | --- |
| Productos | Código de barras (opcional), 3 precios con su margen, costo, stock, stock mínimo, IGV (exonerado por defecto, región San Martín), control de vencimiento opcional. |
| Presentaciones | Para lo que viene en cajetilla, paquete o caja y a veces se vende suelto (cigarros, caramelos…). El stock se cuenta en unidades; cada presentación tiene su factor (x10, x20…), su código de barras y sus 3 precios. Vender una cajetilla x20 descuenta 20 unidades; comprar 5 cajas x20 suma 100 y guarda el costo por unidad. El kardex y las alertas quedan en unidades, y la lista de productos muestra el equivalente ("3 cajetilla x20 + 7"). |
| Importación SysVent | Carga el "Reporte de stock de producto" exportado a CSV. Marca para revisar los datos dudosos. |
| Compras | Registro de factura del proveedor (serie y número únicos), contado o crédito, lotes con vencimiento. Suma stock, guarda el último costo y **sugiere precios** según el margen. Anulación con reversión de stock. |
| Cuentas por pagar | Saldo por proveedor y por factura, pagos parciales con medio de pago y n.º de operación opcional. |
| Inventario | Movimientos de stock (base del kardex), mermas valorizadas al costo, ajustes por conteo físico. |
| Realizar inventario | Conteo físico con celulares por el WiFi de la tienda. El administrador da clic en **Iniciar** y aparece un QR; cada operador lo escanea, escribe su nombre y cuenta con la cámara (o busca por nombre los productos sin código). Los conteos llegan a la PC al instante. Si dos personas cuentan el mismo producto, la PC pregunta si se suman o se reemplazan. Se puede seguir vendiendo: al validar se aplica solo la diferencia entre lo contado y el stock que había al contar. Lista de no contados con opción de inhabilitarlos (el stock queda igual), vencimiento opcional por producto, y cada diferencia queda en el kardex como movimiento Inventario. Si el celular se cierra o pierde señal, lo contado se guarda en el teléfono y se reenvía. |
| Alertas | Lotes vencidos (con botón "Enviar a merma"), por vencer, stock bajo el mínimo, facturas por vencer. |
| Venta (POS) | Venta rápida con lector de barras, boleta (B001) o boleta libre (L001), precio 1/2/3, cliente opcional, pago mixto (efectivo, Yape, Plin, tarjeta) con vuelto, ticket de 80 mm. Atajos: F2 buscar, F4 comprobante, F6 precio, F7 cliente, F9 cobrar. |
| Autorización | Descuentos, precios rebajados y anulaciones piden la clave del administrador cuando los hace un cajero. |
| Caja | Apertura con fondo fijo (S/ 150 por defecto), ingresos, gastos de emergencia y retiros, cierre con contador de billetes y monedas, diferencia, ticket de cierre e historial. Al cerrar, todo menos el fondo del día siguiente pasa al **acumulado**. |
| Gastos y acumulado | El acumulado guarda lo que dejan las cajas anteriores en dos saldos: efectivo y Yape (con Plin, tarjeta y transferencia). De ahí se pagan gastos, proveedores y sueldos; si no alcanza, de la caja del día. Gastos con categoría editable, trabajador (sueldos y adelantos) y nota; anular devuelve el dinero. Gastos fijos con aviso en Inicio 3 días antes y al vencer. Retiros/depósitos y traspasos entre efectivo y Yape. Conteo semanal como un cierre de caja: si no cuadra se anota la observación y el saldo pasa a ser lo contado. |
| Ventas realizadas | Consulta por fecha y comprobante, reimpresión y anulación (devuelve el stock, incluidos los lotes). Corrección de comprobante (boleta ↔ boleta libre), cliente y pago mientras no se haya enviado a SUNAT y la caja siga abierta, con clave del administrador e historial de cambios. Al cambiar de comprobante toma el siguiente número de la otra serie; una boleta B001 solo pasa a boleta libre si es la última, para no dejar números saltados ante SUNAT. |
| Clientes | Menú Ventas → Clientes: lista con búsqueda por DNI, RUC, nombre o teléfono; alta y edición (DNI/RUC/carné/sin documento, teléfono, correo, dirección, notas), Guardar con F2. El botón de lupa busca primero en los clientes guardados (sin internet) y, si hay token de Decolecta en Configuración → Preferencias, llena nombre y dirección desde RENIEC/SUNAT. Sin internet o sin token avisa y se escribe a mano. Eliminar (admin) deja inactivo al cliente que ya tiene ventas. |
| Reportes | Ventas resumido (como el de SysVent, agrupado por comprobante), ventas por producto con utilidad y margen, por día, por medio de pago, por cajero, utilidad del período (ventas − costo − mermas − gastos), compras por proveedor y stock valorizado. Descarga en Excel o impresión/PDF. Solo administrador. |
| Backup | Copia diaria de la base de datos con `pg_dump` a una carpeta de Google Drive para escritorio, más una copia local. También al cerrar caja y con un botón. Conserva los últimos 30. |
| Facturación electrónica | Las boletas B001 se firman con tu certificado digital y se envían directo a SUNAT (SEE del contribuyente). Sin internet quedan "por enviar" y se reintenta solo cada 2 minutos. Las anulaciones van en el resumen diario. Ticket con QR, hash y leyenda de la Amazonía. Las boletas libres (L001) nunca se envían. |
| Configuración | Datos de la tienda, logotipo, favicon y logo de las boletas, márgenes por defecto, redondeo de precios, permitir venta sin stock, días de aviso de vencimiento, usuarios (administrador y cajeros), SUNAT. |

## Ticketera y gaveta

El ticket se imprime con la impresora predeterminada de Windows (POS-80C, papel de 80 mm). Para que la gaveta se abra sola, activa en el driver de la impresora la opción de abrir el cajón al imprimir ("Cash drawer: open before printing"). Para imprimir sin el cuadro de diálogo, abre el sistema en Chrome con `--kiosk-printing`.

## Instalador para Windows

`instalador/construir-paquete.sh` arma un zip que se instala sin internet: trae Node para Windows, el backend y el frontend compilados y los motores de Prisma para Windows. En la PC de la tienda solo hace falta PostgreSQL 17.

```bash
instalador/construir-paquete.sh   # deja el zip en instalador/salida/
```

En la tienda se descomprime y se hace doble clic en `INSTALAR.bat` (las instrucciones para el usuario están en `instalador/windows/LEEME.txt`). El instalador:

- Pide la clave de `postgres`, crea la base `candys` y escribe `datos\config.env`.
- Restaura un `.backup` de otra PC (con sus usuarios, ventas y caja) o crea una base nueva con `admin` y, si se quiere, importa el CSV de SysVent.
- Copia el certificado SUNAT si hay una carpeta `secretos` junto al instalador o al backup.
- Crea los accesos directos "Candy's Market" y "Cerrar Candy's Market" y, si se elige, el arranque al encender la PC.
- Si la carpeta ya tiene una instalación, la actualiza: saca un backup, reemplaza `app\`, agrega a `config.env` las variables nuevas y corre las migraciones. `ACTUALIZAR.bat` hace solo esto y busca la instalación en `C:\CandysMarket` o `D:\CandysMarket`.
- Crea también "Actualizar Candy's Market" (`scripts\actualizar.bat` → `actualizar-github.ps1`): compara `app\version.txt` con el último commit de `main`, muestra las novedades, baja el zip del código, compila backend y frontend con el Node y npm del paquete en `actualizacion\` y solo entonces corre `instalar.ps1 -Actualizar -SinPreguntas` con ese paquete. Si se corta antes, la instalación queda intacta.
- Pide permiso de administrador una vez para abrir en el firewall (red privada) los puertos 3443 y 3080 de los celulares. El certificado de red queda en `datos\certificados-red`, así sobrevive a las actualizaciones.

El backend sirve la interfaz compilada en el mismo puerto (`http://localhost:3000`) cuando encuentra `frontend/dist` (o la carpeta de `FRONTEND_DIR`), así que en la tienda no se usa Vite. `HOST=127.0.0.1` hace que el puerto 3000 solo lo use esa PC; los celulares entran por 3443/3080.

## Instalación manual (Windows)

1. Instala [Node.js 22 LTS](https://nodejs.org) y [PostgreSQL 16](https://www.postgresql.org/download/windows/). Anota la contraseña del usuario `postgres`.
2. Crea la base de datos `candys` (con pgAdmin o `psql -U postgres -c "create database candys;"`).
3. Backend:
   ```bash
   cd backend
   copy .env.example .env      # edita DATABASE_URL y JWT_SECRET
   npm install
   npm run db:migrate
   npm run db:seed             # crea el usuario admin / admin123
   npm run importar:sysvent -- "C:\ruta\stock_produto.csv"
   npm run build
   npm start
   ```
4. Frontend (en otra ventana):
   ```bash
   cd frontend
   npm install
   npm run build
   npm run preview
   ```
5. Abre http://localhost:5173, ingresa con `admin` / `admin123` y **cambia la contraseña** en Configuración → Mi contraseña.

Para desarrollo usa `npm run dev` en cada carpeta.

## Celulares en la red local (HTTPS)

La cámara del navegador solo funciona con conexión segura, así que el backend abre además:

- `https://<IP de la PC>:3443`: la misma app y API, con un certificado firmado por una autoridad (CA) propia de la PC. Se crea sola en `backend/certificados-red/` y el certificado de la IP se renueva solo (al arrancar y cada 6 horas revisa si vence en menos de 60 días o si cambió la IP). La CA dura 20 años: los celulares no tienen que volver a instalar nada.
- `http://<IP de la PC>:3080`: solo la página que abre el QR. Si el celular ya confía en la CA pasa directo a HTTPS; si no, muestra cómo instalar el certificado (Android e iPhone) una sola vez.

Si el router le cambia la IP a la PC, en **Configuración › Red local** se ve la IP que tiene ahora y se elige con un clic (o "Detectar automáticamente"); el certificado se rehace al momento y los celulares no reinstalan nada. Variables opcionales en `.env`: `RED_IP` (la IP que va en el QR, por ejemplo `192.168.18.90`), `HTTPS_PORT` (0 lo desactiva), `RED_HTTP_PORT` y `CERT_RED_DIR`. En el firewall de Windows hay que permitir los puertos 3443 y 3080 en la red privada.

## Backup en Google Drive

1. Instala **Google Drive para escritorio** en la PC de la tienda e inicia sesión con tu cuenta.
2. En el sistema, ve a Configuración → Backup y escribe una carpeta dentro de tu unidad, por ejemplo `G:\Mi unidad\Backups Candys`.
3. Si `pg_dump` no está en el PATH, indica su ruta (`C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`).
4. Presiona "Hacer backup ahora" para probar. Drive sube la copia cuando hay internet.

Además, siempre queda una copia local en `backend/backups` (o en la carpeta de la variable `BACKUP_LOCAL`).

**Restaurar un backup** (en una base vacía):

```bash
createdb -U postgres candys_restaurada
pg_restore --no-owner -U postgres -d candys_restaurada "G:\Mi unidad\Backups Candys\candys_2026-10-29_2200.backup"
```

Luego apunta `DATABASE_URL` a `candys_restaurada` y reinicia el backend.

## Facturación electrónica SUNAT

El sistema envía las boletas directamente a SUNAT, firmadas con tu certificado digital. No necesitas OSE.

1. **Certificado.** En Configuración → SUNAT elige tu archivo `.pfx`, escribe su contraseña y presiona "Cargar certificado". Se guarda solo en `backend/secretos` (o en la carpeta de la variable `SECRETOS_DIR`). **No** va a la base de datos ni a los backups, así que guarda el `.pfx` original en un lugar seguro. El certificado también debe estar registrado en SUNAT Operaciones en Línea.
2. **Datos del emisor.** Revisa RUC, razón social, dirección fiscal, ubigeo (Tarapoto: 220901) y código de establecimiento (0000 para el domicilio fiscal). Guarda.
3. **Prueba en beta.** Presiona "Probar con SUNAT beta". Firma una boleta de S/ 1.00 y la envía al entorno de pruebas de SUNAT, que usa el usuario `MODDATOS`. Debe responder "ha sido aceptada".
4. **Usuario SOL secundario.** En SUNAT Operaciones en Línea crea un usuario secundario con el perfil de envío de comprobantes electrónicos y escríbelo en la misma pestaña (sin el RUC). La clave queda en `backend/secretos`.
5. **Producción.** Cambia el modo a "Producción" y guarda. Desde ese momento cada boleta B001 se envía al emitirla.

Qué pasa en el día a día:

- **Sin internet:** la boleta se imprime igual, con su QR y hash, y queda "Por enviar". El sistema reintenta cada 2 minutos. En Ventas también está el botón "Enviar pendientes a SUNAT".
- **Rechazada:** el detalle de la venta muestra el código y el mensaje de SUNAT. El administrador puede corregir y "Reenviar a SUNAT", o anular y emitir otra.
- **Anulación** de una boleta aceptada: se informa a SUNAT en el resumen diario de bajas, que se envía solo. El estado pasa a "Baja aceptada".
- **Aviso:** si una boleta lleva más de 2 días sin ser aceptada, aparece una alerta en Inicio.
- Las boletas de **S/ 700 o más** exigen el DNI u otro documento del cliente.
- Cada boleta guarda su XML firmado, que se puede descargar desde el detalle de la venta.

Variables opcionales: `SUNAT_URL` (otro servicio, por ejemplo uno de pruebas), `SUNAT_AUTOMATICO=0` (apaga el envío automático), `SECRETOS_DIR`.

## Reglas de negocio

- Todo cambio de stock pasa por `StockService` (`backend/src/inventario/stock.service.ts`) y deja un movimiento. Ventas usarán el mismo servicio.
- Precio sugerido = costo × (1 + margen %), redondeado hacia arriba (S/ 0.10 por defecto). Al registrar una compra solo se marcan por defecto los precios que suben; bajar un precio es decisión del administrador.
- El costo del producto es el **último costo de compra**.
- Registrar compras, pagos, mermas, ajustes y editar productos es solo para el administrador. Los cajeros pueden consultar.
- Solo hay una caja abierta a la vez. Una venta solo se anula mientras su caja siga abierta.
- Los productos que controlan vencimiento se venden primero de los lotes que vencen antes.
- La boleta libre se imprime como "NOTA DE VENTA" porque no es un comprobante de SUNAT.
- Al importar desde SysVent, las presentaciones que comparten Id (por ejemplo, unidad y bolsa) quedan como productos distintos, cada uno con su código y stock. Los stocks negativos se cargan en 0 y quedan marcados "Por revisar".
- Para poner los costos, exporta de SysVent el "Reporte de stock valorizado" en CSV y corre en `backend`:
  `npm run importar:costos -- "C:\ruta\stock_producto.csv"`. Agrega `--probar` para ver los cambios sin guardar y `--stock` para igualar también el stock (la diferencia queda como ajuste en el kardex). Se puede repetir cuando quieras.
- **Configuración → Importar productos** carga o actualiza productos, precios, costos, stock y presentaciones desde un Excel (.xlsx o CSV). Descarga la plantilla vacía o tus productos actuales, edítalos y súbelos: primero se muestra qué se crea, qué cambia y qué filas tienen error, y nada se guarda hasta confirmar. El producto se busca por ID sistema, código de barras o nombre exacto; una celda vacía no cambia nada. El stock se toma como conteo (reemplaza) o como ingreso (se suma), según lo que elijas; queda en el kardex como "Importación". Una fecha de vencimiento crea un lote con las unidades que entran.
- En la venta: `F2` buscar, `F4` boleta / libre, `F6` precio, `F7` cliente, `F8` descuento, `F9` cobrar, `F10` cancelar, `F11` reimprimir. En el cobro: `F1` efectivo, `F2` Yape, `F3` Plin, `F4` tarjeta (llenan lo que falta), `Enter` confirma, `Esc` vuelve.

## Pruebas

```bash
cd backend && npm test
```
