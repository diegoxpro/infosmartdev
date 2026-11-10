import { Module } from '@nestjs/common';
import { ConsultaDocService } from '../ventas/consulta-doc.service';
import { ProveedoresController } from './proveedores.controller';

@Module({ controllers: [ProveedoresController], providers: [ConsultaDocService] })
export class ProveedoresModule {}
