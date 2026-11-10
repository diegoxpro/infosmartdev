import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // El certificado .pfx llega en base64 dentro del JSON
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const puerto = Number(process.env.PUERTO ?? 3100);
  await app.listen(puerto);
  console.log(`Panel Infosmart escuchando en el puerto ${puerto}`);
}
bootstrap();
