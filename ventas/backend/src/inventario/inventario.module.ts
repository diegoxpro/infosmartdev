import { Global, Module } from '@nestjs/common';
import { RedController } from '../red/red.controller';
import { InventarioController } from './inventario.controller';
import { StockService } from './stock.service';
import { InventarioMovilController, TomaInventarioController } from './toma-inventario.controller';
import { TomaInventarioService } from './toma-inventario.service';

@Global()
@Module({
  controllers: [InventarioController, TomaInventarioController, InventarioMovilController, RedController],
  providers: [StockService, TomaInventarioService],
  exports: [StockService],
})
export class InventarioModule {}
