import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

class IngresoDto {
  @IsString() usuario: string;
  @IsString() clave: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('ingresar')
  ingresar(@Body() dto: IngresoDto) {
    return this.auth.ingresar(dto.usuario, dto.clave);
  }
}
