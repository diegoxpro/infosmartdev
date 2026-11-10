import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { inquilinoActual, NUBE } from '../nube/contexto';
import { registro } from '../nube/registro';

/**
 * En la tienda es un PrismaClient normal. En modo nube cada uso se desvía a la
 * base de la empresa de la petición en curso (ver nube/middleware), así los
 * servicios siguen usando `this.prisma` sin cambios.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(NUBE ? { datasourceUrl: 'postgresql://sin-empresa@127.0.0.1:1/sin-empresa' } : undefined);
    if (!NUBE) return;
    return new Proxy(this, {
      get(base, prop, receptor) {
        const i = inquilinoActual();
        if (!i) {
          const valor = Reflect.get(base, prop, receptor);
          const esConsulta = typeof prop === 'string' && (prop.startsWith('$') || (typeof valor === 'object' && valor !== null && 'findMany' in valor));
          if (esConsulta && prop !== '$connect' && prop !== '$disconnect') {
            throw new Error(`Consulta a la base fuera de una empresa (${String(prop)})`);
          }
          return valor;
        }
        const valor = Reflect.get(i.cliente, prop);
        return typeof valor === 'function' ? valor.bind(i.cliente) : valor;
      },
    });
  }

  async onModuleInit() {
    if (!NUBE) await this.$connect();
  }

  async onModuleDestroy() {
    if (NUBE) await registro.cerrar();
    else await this.$disconnect();
  }
}
