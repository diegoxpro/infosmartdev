import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { isIPv4 } from 'net';
import { Publico, Permiso } from '../auth/decorators';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { fijarIpConfigurada, ipPrincipal, ipsDetectadas, origenIp, puertos } from './certificados';
import { estadoRed, renovarCertificado, urlEntrada, urlHttps } from './servidor-red';

class IpDto {
  /** 'auto' (o vacío): que el sistema la detecte sola, ignorando RED_IP. */
  @IsOptional() @IsString() ip?: string | null;
}

@Controller('red')
export class RedController {
  constructor(private readonly config: ConfiguracionService) {}

  /** La página del QR lo usa para saber si el celular ya confía en el certificado. */
  @Publico()
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Get('info')
  info() {
    const estado = estadoRed();
    return {
      ip: ipPrincipal(),
      origen: origenIp(),
      detectadas: ipsDetectadas(),
      envIp: process.env.RED_IP?.trim() || null,
      activo: !!puertos.https && estado.activo,
      certificadoVence: estado.vence,
      https: urlHttps(),
      entrada: urlEntrada(),
    };
  }

  /** Configuración › Red local: guarda la IP actual de la PC y rehace el certificado. */
  @Permiso('config.red')
  @Put('ip')
  async cambiarIp(@Body() dto: IpDto) {
    const ip = dto.ip?.trim() || 'auto';
    if (ip !== 'auto' && !isIPv4(ip)) throw new BadRequestException('Escribe una IP válida, por ejemplo 192.168.1.51');
    if (ip?.startsWith('127.')) throw new BadRequestException('Esa IP es solo de esta PC; los celulares no la alcanzan');
    await this.config.actualizar({ redIp: ip });
    fijarIpConfigurada(ip);
    try {
      renovarCertificado();
    } catch (e) {
      throw new BadRequestException(`Se guardó la IP pero no se pudo rehacer el certificado: ${(e as Error).message}`);
    }
    return this.info();
  }
}
