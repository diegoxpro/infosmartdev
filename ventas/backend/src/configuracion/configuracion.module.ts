import { Global, Module } from '@nestjs/common';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionService } from './configuracion.service';
import { ImagenesController } from './imagenes.controller';

@Global()
@Module({ controllers: [ConfiguracionController, ImagenesController], providers: [ConfiguracionService], exports: [ConfiguracionService] })
export class ConfiguracionModule {}
