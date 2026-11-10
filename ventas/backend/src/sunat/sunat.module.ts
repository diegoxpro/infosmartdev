import { Global, Module } from '@nestjs/common';
import { SunatController } from './sunat.controller';
import { SunatService } from './sunat.service';

@Global()
@Module({ controllers: [SunatController], providers: [SunatService], exports: [SunatService] })
export class SunatModule {}
