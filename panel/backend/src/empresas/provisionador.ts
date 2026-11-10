import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Crea la base de datos de cada producto de una empresa en el mismo servidor PostgreSQL.
// Las tablas y el usuario administrador los crea luego el propio producto (ventas o lavadero)
// al consultar la API interna: así cada producto sigue siendo dueño de sus migraciones.
@Injectable()
export class Provisionador {
  constructor(private prisma: PrismaService) {}

  async crearBaseDatos(nombre: string) {
    if (!/^[a-z][a-z0-9_]{2,62}$/.test(nombre)) throw new Error(`Nombre de base inválido: ${nombre}`);
    const existe = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM pg_database WHERE datname = ${nombre}`;
    if (existe.length > 0) return false;
    // CREATE DATABASE no admite parámetros; el nombre ya está validado arriba
    await this.prisma.$executeRawUnsafe(`CREATE DATABASE "${nombre}" ENCODING 'UTF8' TEMPLATE template0`);
    return true;
  }
}
