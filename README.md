# Infosmart

Plataforma para vender como servicio el sistema de ventas y la app de lavadero. Cada empresa cliente entra por su subdominio (`empresa1.infosmart.pe`) y tiene sus propias bases de datos.

```
panel/backend    API del panel (NestJS + Prisma + PostgreSQL)
panel/frontend   Interfaz del panel (React + Vite) y Caddy, la entrada web única
ventas/          Sistema de ventas (copia de sysventcandys f9d2c1e) adaptado a varias empresas
docker-compose.yml
```

`sysventcandys` sigue siendo la versión local de Candy's Market y no se toca desde aquí.

## Cómo funciona

- **Base de control** (`infosmart_panel`): empresas, planes, productos contratados, administradores y su historial.
- **Una base por producto y empresa** en el mismo PostgreSQL: `ventas_empresa1`, `lavadero_empresa1`. El panel la crea al dar de alta la empresa.
- **Clave temporal del administrador**: el panel la muestra una sola vez y guarda solo su hash. El botón «Nueva clave» genera otra.
- **Estados**: una empresa nueva empieza en *Prueba* por `DIAS_PRUEBA` días. *Suspendida* o con la fecha de vencimiento pasada, sus usuarios no pueden entrar.

### API interna para ventas y lavadero

Los backends de cada producto la llaman con la cabecera `x-infosmart-clave: <CLAVE_INTERNA>`:

| Llamada | Para qué |
| --- | --- |
| `GET /api/interno/empresas/:subdominio/:producto` (`VENTAS` o `LAVADERO`) | Saber qué base usar, si la empresa puede entrar (`acceso.permitido`) y el usuario y hash de la clave del administrador. |
| `POST /api/interno/empresas/:subdominio/:producto/reporte` con `{ "aprovisionado": true }` o `{ "claveCambiada": true }` | Avisar que el producto ya creó sus tablas y su administrador, o que el administrador cambió la clave temporal. |

En el primer ingreso a una empresa, el producto corre sus migraciones sobre la base indicada, crea al administrador con ese hash y reporta `aprovisionado`. Esto se implementa en la fase 2 (ventas) y la fase 3 (lavadero).

## Sistema de ventas en la nube

Con `PANEL_URL` definido el backend de `ventas/` entra en **modo nube** (sin esa variable sigue funcionando como en la tienda, con una sola base):

- Cada petición se atiende con la empresa de su subdominio (`empresa1.<DOMINIO_BASE>`). La ficha se pide al panel y se guarda 30 s en memoria.
- En el primer ingreso de una empresa se aplican las migraciones en su base (`ventas_<sub>`), se crean las series B001/L001, la configuración y el administrador con la clave temporal del panel. Cada vez que el proceso arranca vuelve a aplicar las migraciones pendientes de cada empresa que entra.
- El token de sesión lleva la empresa: no sirve en otro subdominio ni en el panel.
- Empresa suspendida o vencida: la API responde 403 y la web muestra un aviso.
- **Lo controla el panel** (Empresa › Configurar): modo SUNAT (desactivado, beta, producción), certificado digital, usuario y clave SOL, token de consulta DNI/RUC y backups. En el sistema de ventas esas secciones quedan de solo lectura; la dirección, el ubigeo y demás datos del emisor siguen editándose en ventas.
- **Claves**: el panel guarda SOL, certificado y token cifrados con `CLAVE_CIFRADO` (AES-256-GCM) y solo los entrega por la API interna, que Caddy bloquea desde fuera.
- **Administrador**: «Nueva clave» en el panel reemplaza la clave del administrador en ventas en menos de un minuto. Cuando el administrador la cambia, el panel deja de marcarla como temporal.
- **Backups**: el panel hace `pg_dump` de cada base a diario a la hora de Lima que elijas, conserva los últimos N y permite descargarlos. Al cerrar caja, ventas pide uno más.
- El plan limita los usuarios activos (`maxUsuarios`).
- La red local para el inventario con celulares no se usa: los celulares entran por el mismo subdominio.

## App del lavadero en la nube

`lavadero/` es la app de El Firme (Android + API FastAPI). Con `PANEL_URL` la API entra en **modo nube**; sin esa variable funciona como la instalación propia de El Firme.

- La app Android pide el **código de empresa** (su subdominio) y entra a `https://<código>.<DOMINIO_BASE>:8093`. Para un servidor propio queda la opción «Usar un servidor propio».
- La API sirve HTTPS con su propio certificado. La app confirma su huella una sola vez y vale para todas las empresas. La huella sale en `docker compose logs lavadero`.
- Base `lavadero_<sub>` por empresa: en su primer ingreso se crean las tablas, las series F001/B001, los servicios de ejemplo y el administrador con la clave temporal del panel. El RUC y la razón social salen del panel.
- **Lo controla el panel**: modo SUNAT, usuario y clave SOL, certificado y token de consulta DNI/RUC. En la app esas pantallas quedan de solo lectura y la API responde 403 si se intenta cambiarlas. El modo «Desactivado» se trata como pruebas (beta). Sin certificado cargado, en beta se firma con uno de prueba.
- **Paso a producción** desde el panel: igual que en la app original, se borran las ventas y gastos de prueba y la numeración vuelve a empezar.
- Token con la empresa, suspensión/vencimiento (403), límite de usuarios del plan, «Nueva clave» del panel y backups funcionan como en ventas.
- El envío de pendientes a SUNAT corre cada minuto para cada empresa activa.
- APK: `applicationId` `pe.infosmart.lavadero` y nombre «Infosmart Lavadero», para que no reemplace a la app propia de El Firme. El dominio está en `DOMINIO_NUBE` (`data/Api.kt`).

## Levantar en el servidor de pruebas (CasaOS 190.119.59.24)

```bash
git clone https://github.com/diegoxpro/infosmartdev.git
cd infosmartdev
cp .env.example .env
nano .env        # claves propias; JWT_SECRETO y CLAVE_CIFRADO: openssl rand -base64 48, CLAVE_INTERNA: openssl rand -hex 32
docker compose up -d --build
docker compose logs panel-api
```

Todo entra por un solo puerto (`PANEL_PUERTO`, 8092 en el servidor de pruebas):

- Panel: `http://190.119.59.24:8092` o `http://admin.<DOMINIO_BASE>:8092`. Se ingresa con `SUPERADMIN_USUARIO` y `SUPERADMIN_CLAVE`; ese usuario se crea solo la primera vez.
- Empresas: `http://<sub>.<DOMINIO_BASE>:8092`.
- App del lavadero: `https://<sub>.<DOMINIO_BASE>:8093` (`LAVADERO_PUERTO`).

Con el dominio `ciardi.lat`: registros A `*` y `admin` hacia la IP del servidor, `DOMINIO_BASE=ciardi.lat` y `URL_PUBLICA=http://{sub}.ciardi.lat:8092`. Sin dominio sirve [nip.io](https://nip.io): `empresa1.190.119.59.24.nip.io`.

**Respalda el `.env`**: sin `CLAVE_CIFRADO` hay que volver a cargar certificados y claves SOL de todas las empresas.

## Desarrollo

```bash
cd panel/backend && npm install
# DATABASE_URL, JWT_SECRETO, CLAVE_INTERNA, SUPERADMIN_USUARIO, SUPERADMIN_CLAVE en el entorno
npx prisma migrate deploy && npm run dev
cd panel/frontend && npm install && npm run dev   # http://localhost:5173, reenvía /api al 3100
```

Pruebas: `cd panel/backend && npm test`, `cd ventas/backend && npm test` y `cd lavadero/backend && python -m pytest tests && python -m pytest tests_nube` (van por separado porque cada grupo configura el entorno al importar).

## Siguientes fases

1. ~~Panel Infosmart~~
2. ~~Sistema de ventas multiempresa~~
3. ~~App de lavadero multiempresa~~
4. Dominio `*.infosmart.pe` con certificado comodín y Caddy como proxy principal.
