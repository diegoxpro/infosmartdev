import { PrismaClient, Rol, TipoComprobante } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.configuracion.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  // Series de comprobantes. El último número se ajusta en Configuración → Series
  // para continuar la numeración que venía de SysVent.
  for (const s of [
    { serie: 'B001', tipo: TipoComprobante.BOLETA },
    { serie: 'L001', tipo: TipoComprobante.BOLETA_LIBRE },
  ]) {
    await prisma.serie.upsert({ where: { serie: s.serie }, create: s, update: {} });
  }

  const password = process.env.ADMIN_PASSWORD ?? 'admin123';
  const existe = await prisma.usuario.findUnique({ where: { usuario: 'admin' } });
  if (!existe) {
    await prisma.usuario.create({
      data: { usuario: 'admin', nombre: 'Administrador', rol: Rol.ADMIN, passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Usuario "admin" creado con la contraseña "${password}". Cámbiala al ingresar.`);
  }
}

main().finally(() => prisma.$disconnect());
