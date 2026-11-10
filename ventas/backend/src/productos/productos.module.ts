import { Module } from '@nestjs/common';
import { CatalogosController } from './catalogos.controller';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';

@Module({ controllers: [ProductosController, CatalogosController], providers: [ProductosService] })
export class ProductosModule {}
