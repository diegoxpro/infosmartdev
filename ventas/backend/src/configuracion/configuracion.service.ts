import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConfiguracionService {
  constructor(private readonly prisma: PrismaService) {}

  obtener(tx: Prisma.TransactionClient = this.prisma) {
    return tx.configuracion.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  async actualizar(data: Prisma.ConfiguracionUpdateInput) {
    await this.obtener();
    return this.prisma.configuracion.update({ where: { id: 1 }, data });
  }
}
