import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AjustesController } from './ajustes/ajustes.controller';
import { AjustesService } from './ajustes/ajustes.service';
import { RespaldosController } from './respaldos/respaldos.controller';
import { RespaldosService } from './respaldos/respaldos.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EmpresasController } from './empresas/empresas.controller';
import { EmpresasService } from './empresas/empresas.service';
import { Provisionador } from './empresas/provisionador';
import { InternoController } from './interno/interno.controller';
import { PrismaService } from './prisma/prisma.service';
import { config } from './config';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecreto, signOptions: { expiresIn: '12h' } })],
  controllers: [AuthController, EmpresasController, AjustesController, RespaldosController, InternoController],
  providers: [PrismaService, AuthService, EmpresasService, Provisionador, AjustesService, RespaldosService],
})
export class AppModule {}
