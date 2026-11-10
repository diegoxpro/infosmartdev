import { Module } from '@nestjs/common';
import { ImportacionController } from './importacion.controller';
import { ImportacionService } from './importacion.service';

@Module({ controllers: [ImportacionController], providers: [ImportacionService] })
export class ImportacionModule {}
