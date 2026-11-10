import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const puerto = Number(process.env.PUERTO ?? 3100);
  await app.listen(puerto);
  console.log(`Panel Infosmart escuchando en el puerto ${puerto}`);
}
bootstrap();
