import { Injectable } from '@nestjs/common';
import { Configuracion, Prisma } from '@prisma/client';
import { inquilinoActual, NUBE } from '../nube/contexto';
import { PrismaService } from '../prisma/prisma.service';

/** En la nube estos campos los controla el panel Infosmart y no se guardan desde aquí. */
export const CAMPOS_DEL_PANEL = [
  'sunatModo', 'consultaDocToken', 'empresaRuc', 'backupCarpeta', 'backupHora', 'backupConservar', 'pgDumpRuta', 'redIp',
] as const;

@Injectable()
export class ConfiguracionService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(tx: Prisma.TransactionClient = this.prisma): Promise<Configuracion> {
    const c = await tx.configuracion.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const i = inquilinoActual();
    if (!NUBE || !i) return c;
    const { ajustes, empresa } = i.info;
    return {
      ...c,
      sunatModo: ajustes.sunatModo,
      consultaDocToken: ajustes.consultaDocToken,
      empresaRuc: empresa.ruc,
      empresaRazonSocial: c.empresaRazonSocial ?? empresa.razonSocial,
    };
  }

  async actualizar(data: Prisma.ConfiguracionUpdateInput) {
    if (NUBE) for (const k of CAMPOS_DEL_PANEL) delete (data as Record<string, unknown>)[k];
    await this.obtener();
    await this.prisma.configuracion.update({ where: { id: 1 }, data });
    return this.obtener();
  }
}
