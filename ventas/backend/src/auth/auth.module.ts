import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermisosService } from './permisos.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'cambia-esta-clave',
        signOptions: { expiresIn: '14h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PermisosService],
  exports: [JwtModule, AuthService, PermisosService],
})
export class AuthModule {}
