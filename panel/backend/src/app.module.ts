import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
  controllers: [AuthController, EmpresasController, InternoController],
  providers: [PrismaService, AuthService, EmpresasService, Provisionador],
})
export class AppModule {}
