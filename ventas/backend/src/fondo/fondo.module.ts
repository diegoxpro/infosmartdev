import { Global, Module } from '@nestjs/common';
import { FondoController } from './fondo.controller';
import { FondoService } from './fondo.service';

@Global()
@Module({ controllers: [FondoController], providers: [FondoService], exports: [FondoService] })
export class FondoModule {}
