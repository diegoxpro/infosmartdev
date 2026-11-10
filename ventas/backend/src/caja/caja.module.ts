import { Global, Module } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';

@Global()
@Module({ controllers: [CajaController], providers: [CajaService], exports: [CajaService] })
export class CajaModule {}
