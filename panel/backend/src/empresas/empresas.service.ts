import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Producto } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { AgregarProductoDto, CambiarEstadoDto, CrearEmpresaDto, EditarEmpresaDto, RenovarDto } from './dto';
import { Provisionador } from './provisionador';
import { accesoEmpresa, claveTemporal, nombreBaseDatos, validarRuc, validarSubdominio } from './reglas';

const incluir = {
  plan: true,
  productos: {
    select: {
      id: true, producto: true, baseDatos: true, adminUsuario: true,
      adminClaveTemporal: true, aprovisionado: true, creadoEl: true,
    },
  },
} satisfies Prisma.EmpresaInclude;

@Injectable()
export class EmpresasService {
  constructor(private prisma: PrismaService, private provisionador: Provisionador) {}

  private conUrl<T extends { subdominio: string; estado: any; venceEl: Date }>(e: T) {
    return { ...e, url: `${e.subdominio}.${config.dominioBase}`, acceso: accesoEmpresa(e.estado, e.venceEl) };
  }

  async listar(buscar?: string) {
    const where: Prisma.EmpresaWhereInput = buscar
      ? {
          OR: [
            { razonSocial: { contains: buscar, mode: 'insensitive' } },
            { ruc: { contains: buscar } },
            { subdominio: { contains: buscar.toLowerCase() } },
          ],
        }
      : {};
    const empresas = await this.prisma.empresa.findMany({ where, include: incluir, orderBy: { creadoEl: 'desc' } });
    return empresas.map((e) => this.conUrl(e));
  }

  async obtener(id: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id },
      include: { ...incluir, eventos: { orderBy: { creadoEl: 'desc' }, take: 50 } },
    });
    if (!e) throw new NotFoundException('Empresa no encontrada');
    return this.conUrl(e);
  }

  async resumen() {
    const empresas = await this.prisma.empresa.findMany({ select: { estado: true, venceEl: true } });
    const ahora = Date.now();
    const en7dias = ahora + 7 * 86400000;
    return {
      dominioBase: config.dominioBase,
      total: empresas.length,
      activas: empresas.filter((e) => e.estado === 'ACTIVA' && e.venceEl.getTime() >= ahora).length,
      prueba: empresas.filter((e) => e.estado === 'PRUEBA' && e.venceEl.getTime() >= ahora).length,
      suspendidas: empresas.filter((e) => e.estado === 'SUSPENDIDA').length,
      vencidas: empresas.filter((e) => e.estado !== 'SUSPENDIDA' && e.venceEl.getTime() < ahora).length,
      porVencer: empresas.filter((e) => e.estado !== 'SUSPENDIDA' && e.venceEl.getTime() >= ahora && e.venceEl.getTime() < en7dias).length,
    };
  }

  planes() {
    return this.prisma.plan.findMany({ where: { activo: true }, orderBy: { precioMensual: 'asc' } });
  }

  private async planPorCodigo(codigo: string) {
    const plan = await this.prisma.plan.findUnique({ where: { codigo } });
    if (!plan || !plan.activo) throw new BadRequestException('Plan no válido');
    return plan;
  }

  // Crea la empresa, una base de datos por producto y la clave temporal de cada administrador.
  // Las claves solo se devuelven aquí: en la base queda el hash.
  async crear(dto: CrearEmpresaDto, usuario: string) {
    const errorSub = validarSubdominio(dto.subdominio);
    if (errorSub) throw new BadRequestException(errorSub);
    const errorRuc = validarRuc(dto.ruc);
    if (errorRuc) throw new BadRequestException(errorRuc);
    const productos = [...new Set(dto.productos)];
    const plan = await this.planPorCodigo(dto.plan);

    const duplicada = await this.prisma.empresa.findFirst({
      where: { OR: [{ ruc: dto.ruc }, { subdominio: dto.subdominio }] },
    });
    if (duplicada) {
      throw new ConflictException(duplicada.ruc === dto.ruc ? 'Ya existe una empresa con ese RUC' : 'Ese subdominio ya está en uso');
    }

    const claves: { producto: Producto; usuario: string; clave: string }[] = [];
    const filas = [];
    for (const producto of productos) {
      const clave = claveTemporal();
      claves.push({ producto, usuario: dto.adminUsuario, clave });
      filas.push({
        producto,
        baseDatos: nombreBaseDatos(producto, dto.subdominio),
        adminUsuario: dto.adminUsuario,
        adminClaveHash: await bcrypt.hash(clave, 10),
      });
    }

    // Primero las bases (no pueden ir dentro de una transacción); si ya existían se reutilizan
    for (const f of filas) await this.provisionador.crearBaseDatos(f.baseDatos);

    const empresa = await this.prisma.empresa.create({
      data: {
        razonSocial: dto.razonSocial,
        ruc: dto.ruc,
        subdominio: dto.subdominio,
        contacto: dto.contacto,
        telefono: dto.telefono,
        correo: dto.correo,
        notas: dto.notas,
        planId: plan.id,
        estado: 'PRUEBA',
        venceEl: new Date(Date.now() + config.diasPrueba * 86400000),
        productos: { create: filas },
        eventos: { create: { tipo: 'CREADA', detalle: `Productos: ${productos.join(', ')}`, usuario } },
      },
      include: incluir,
    });
    return { empresa: this.conUrl(empresa), claves };
  }

  async editar(id: number, dto: EditarEmpresaDto, usuario: string) {
    await this.obtener(id);
    const { plan: codigoPlan, ...resto } = dto;
    const data: Prisma.EmpresaUpdateInput = { ...resto };
    if (codigoPlan) data.plan = { connect: { id: (await this.planPorCodigo(codigoPlan)).id } };
    await this.prisma.empresa.update({ where: { id }, data });
    await this.evento(id, 'EDITADA', Object.keys(dto).join(', '), usuario);
    return this.obtener(id);
  }

  async cambiarEstado(id: number, dto: CambiarEstadoDto, usuario: string) {
    const actual = await this.obtener(id);
    if (actual.estado === dto.estado) return actual;
    await this.prisma.empresa.update({ where: { id }, data: { estado: dto.estado } });
    await this.evento(id, `ESTADO_${dto.estado}`, dto.motivo, usuario);
    return this.obtener(id);
  }

  async renovar(id: number, dto: RenovarDto, usuario: string) {
    const actual = await this.obtener(id);
    let hasta: Date;
    if (dto.hasta) {
      hasta = new Date(dto.hasta);
    } else if (dto.meses) {
      hasta = new Date(Math.max(actual.venceEl.getTime(), Date.now()));
      hasta.setMonth(hasta.getMonth() + dto.meses);
    } else {
      throw new BadRequestException('Indica los meses o la fecha');
    }
    await this.prisma.empresa.update({ where: { id }, data: { venceEl: hasta } });
    await this.evento(id, 'RENOVADA', `Hasta ${hasta.toISOString().slice(0, 10)}`, usuario);
    return this.obtener(id);
  }

  async agregarProducto(id: number, dto: AgregarProductoDto, usuario: string) {
    const empresa = await this.obtener(id);
    if (empresa.productos.some((p) => p.producto === dto.producto)) {
      throw new ConflictException('La empresa ya tiene ese producto');
    }
    const clave = claveTemporal();
    const baseDatos = nombreBaseDatos(dto.producto, empresa.subdominio);
    await this.provisionador.crearBaseDatos(baseDatos);
    await this.prisma.productoEmpresa.create({
      data: {
        empresaId: id, producto: dto.producto, baseDatos,
        adminUsuario: dto.adminUsuario, adminClaveHash: await bcrypt.hash(clave, 10),
      },
    });
    await this.evento(id, 'PRODUCTO_AGREGADO', dto.producto, usuario);
    return { empresa: await this.obtener(id), claves: [{ producto: dto.producto, usuario: dto.adminUsuario, clave }] };
  }

  // Genera una nueva clave temporal para el administrador de un producto.
  // El producto la aplica la próxima vez que consulte la API interna.
  async restablecerClave(id: number, producto: Producto, usuario: string) {
    const pe = await this.prisma.productoEmpresa.findUnique({ where: { empresaId_producto: { empresaId: id, producto } } });
    if (!pe) throw new NotFoundException('La empresa no tiene ese producto');
    const clave = claveTemporal();
    await this.prisma.productoEmpresa.update({
      where: { id: pe.id },
      data: { adminClaveHash: await bcrypt.hash(clave, 10), adminClaveTemporal: true },
    });
    await this.evento(id, 'CLAVE_RESTABLECIDA', producto, usuario);
    return { producto, usuario: pe.adminUsuario, clave };
  }

  private evento(empresaId: number, tipo: string, detalle: string | undefined, usuario: string) {
    return this.prisma.evento.create({ data: { empresaId, tipo, detalle, usuario } });
  }
}
