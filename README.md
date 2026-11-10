# Infosmart

Plataforma para vender como servicio el sistema de ventas y la app de lavadero. Cada empresa cliente entra por su subdominio (`empresa1.infosmart.pe`) y tiene sus propias bases de datos.

```
panel/backend    API del panel (NestJS + Prisma + PostgreSQL)
panel/frontend   Interfaz del panel (React + Vite), servida por Caddy
docker-compose.yml
```

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

## Levantar en el servidor de pruebas (CasaOS 190.119.59.24)

```bash
git clone https://github.com/diegoxpro/infosmartdev.git
cd infosmartdev
cp .env.example .env
nano .env        # claves propias; JWT_SECRETO: openssl rand -base64 48, CLAVE_INTERNA: openssl rand -hex 32
docker compose up -d --build
docker compose logs panel-api
```

El panel queda en `http://190.119.59.24:8090` (cambia el puerto con `PANEL_PUERTO`). Se ingresa con `SUPERADMIN_USUARIO` y `SUPERADMIN_CLAVE`; ese usuario se crea solo la primera vez.

Para las pruebas los subdominios usan [nip.io](https://nip.io): `empresa1.190.119.59.24.nip.io` apunta a tu IP sin comprar dominio.

## Desarrollo

```bash
cd panel/backend && npm install
# DATABASE_URL, JWT_SECRETO, CLAVE_INTERNA, SUPERADMIN_USUARIO, SUPERADMIN_CLAVE en el entorno
npx prisma migrate deploy && npm run dev
cd panel/frontend && npm install && npm run dev   # http://localhost:5173, reenvía /api al 3100
```

Pruebas: `cd panel/backend && npm test`.

## Siguientes fases

1. ~~Panel Infosmart~~
2. Sistema de ventas multiempresa: elegir la base por subdominio, certificado SUNAT y logos por empresa.
3. App de lavadero multiempresa: igual en FastAPI; el APK pide el código de empresa.
4. Dominio `*.infosmart.pe` con certificado comodín y Caddy como proxy principal.
