import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Publico, UsuarioActual, UsuarioSesion } from './decorators';

class LoginDto {
  @IsString() usuario: string;
  @IsString() password: string;
}

class CambiarPasswordDto {
  @IsString() actual: string;
  @IsString() @MinLength(6) nueva: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.usuario, dto.password);
  }

  /** Datos del usuario con sus permisos al día (el menú los vuelve a pedir cada minuto). */
  @Get('yo')
  yo(@UsuarioActual() user: UsuarioSesion) {
    return this.auth.yo(user.id);
  }

  @Post('cambiar-password')
  cambiarPassword(@UsuarioActual() user: UsuarioSesion, @Body() dto: CambiarPasswordDto) {
    return this.auth.cambiarPassword(user.id, dto.actual, dto.nueva);
  }
}
