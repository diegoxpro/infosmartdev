import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { ConfiguracionService } from './configuracion/configuracion.service';
import { fijarIpConfigurada } from './red/certificados';
import { abrirRedLocal } from './red/servidor-red';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // El certificado .pfx y el Excel de productos llegan en base64 dentro del JSON.
  app.useBodyParser('json', { limit: '20mb' });
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  servirFrontend(app);
  const port = Number(process.env.PORT ?? 3000);
  // HOST=127.0.0.1 en la tienda: solo esta PC entra y Windows no pide permiso de firewall.
  if (process.env.HOST) await app.listen(port, process.env.HOST);
  else await app.listen(port);
  console.log(`API lista en http://localhost:${port}/api`);
  // Celulares de la red local (inventario): HTTPS con la CA propia de la PC.
  // La IP elegida en Configuración › Red local manda sobre RED_IP y la detectada.
  fijarIpConfigurada((await app.get(ConfiguracionService).obtener()).redIp);
  abrirRedLocal(app.getHttpAdapter().getInstance());
}

/**
 * En la instalación de la tienda el backend también sirve la interfaz ya
 * compilada (frontend/dist), así todo corre en un solo puerto y sin Vite.
 */
function servirFrontend(app: NestExpressApplication) {
  const web = resolverWeb();
  if (!web) return;
  app.useStaticAssets(web);
  // Las rutas de React (/ventas, /caja...) devuelven index.html.
  app.use((req: { method: string; path: string }, res: { sendFile(f: string): void }, next: () => void) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(join(web, 'index.html'));
    next();
  });
}

function resolverWeb() {
  const web = process.env.FRONTEND_DIR ?? join(__dirname, '..', '..', 'frontend', 'dist');
  return existsSync(join(web, 'index.html')) ? web : undefined;
}

bootstrap();
