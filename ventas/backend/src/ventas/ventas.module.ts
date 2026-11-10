import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ConsultaDocService } from './consulta-doc.service';
import { SeriesController } from './series.controller';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  controllers: [VentasController, ClientesController, SeriesController],
  providers: [VentasService, ConsultaDocService],
})
export class VentasModule {}
