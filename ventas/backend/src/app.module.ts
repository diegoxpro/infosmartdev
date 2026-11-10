import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { CajaModule } from './caja/caja.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermisosGuard } from './auth/permisos.guard';
import { ComprasModule } from './compras/compras.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { FondoModule } from './fondo/fondo.module';
import { GastosModule } from './gastos/gastos.module';
import { ImportacionModule } from './importacion/importacion.module';
import { InventarioModule } from './inventario/inventario.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductosModule } from './productos/productos.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { ReportesModule } from './reportes/reportes.module';
import { SunatModule } from './sunat/sunat.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsuariosModule,
    ConfiguracionModule,
    ProductosModule,
    ProveedoresModule,
    ComprasModule,
    InventarioModule,
    ImportacionModule,
    CajaModule,
    FondoModule,
    GastosModule,
    VentasModule,
    ReportesModule,
    BackupModule,
    SunatModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
})
export class AppModule {}
