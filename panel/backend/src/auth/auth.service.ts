import { Injectable, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  // Crea el primer superadministrador a partir del entorno si todavía no hay ninguno
  async onApplicationBootstrap() {
    if ((await this.prisma.superadmin.count()) > 0) return;
    const usuario = process.env.SUPERADMIN_USUARIO;
    const clave = process.env.SUPERADMIN_CLAVE;
    if (!usuario || !clave) {
      console.warn('No hay superadministrador: define SUPERADMIN_USUARIO y SUPERADMIN_CLAVE');
      return;
    }
    await this.prisma.superadmin.create({
      data: { usuario, nombre: 'Administrador Infosmart', claveHash: await bcrypt.hash(clave, 10) },
    });
    console.log(`Superadministrador "${usuario}" creado`);
  }

  async ingresar(usuario: string, clave: string) {
    const admin = await this.prisma.superadmin.findUnique({ where: { usuario } });
    if (!admin || !(await bcrypt.compare(clave, admin.claveHash))) {
      throw new UnauthorizedException('Usuario o clave incorrectos');
    }
    const token = await this.jwt.signAsync({ sub: admin.id, usuario: admin.usuario }, { audience: 'infosmart-panel' });
    return { token, usuario: admin.usuario, nombre: admin.nombre };
  }
}
