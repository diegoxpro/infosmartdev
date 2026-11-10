import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AjustesProducto, ModoSunat, Producto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { leerPfx } from './certificado';
import { cifrar, descifrar } from './cifrado';

export interface CambiosAjustes {
  sunatModo?: ModoSunat;
  solUsuario?: string;
  solClave?: string;
  consultaDocToken?: string;
  backupHora?: string;
  backupConservar?: number;
}

@Injectable()
export class AjustesService {
  constructor(private prisma: PrismaService) {}

  async productoEmpresa(empresaId: number, producto: Producto) {
    const pe = await this.prisma.productoEmpresa.findUnique({ where: { empresaId_producto: { empresaId, producto } } });
    if (!pe) throw new NotFoundException('La empresa no tiene ese producto');
    return pe;
  }

  async deProducto(productoEmpresaId: number) {
    return (
      (await this.prisma.ajustesProducto.findUnique({ where: { productoEmpresaId } })) ??
      this.prisma.ajustesProducto.create({ data: { productoEmpresaId } })
    );
  }

  /** Vista para el panel: nunca devuelve claves ni el certificado. */
  publico(a: AjustesProducto) {
    return {
      sunatModo: a.sunatModo,
      solUsuario: a.solUsuario,
      solConfigurada: !!a.solClaveCifrada,
      certificado: a.certificadoCifrado ? { sujeto: a.certificadoSujeto, venceEl: a.certificadoVence } : null,
      consultaDocConfigurado: !!a.consultaDocTokenCifrado,
      backupHora: a.backupHora,
      backupConservar: a.backupConservar,
      actualizadoEl: a.actualizadoEl,
    };
  }

  /** Vista para el producto (API interna): las claves descifradas. */
  privado(a: AjustesProducto | null) {
    return {
      sunatModo: a?.sunatModo ?? 'DESACTIVADO',
      solUsuario: a?.solUsuario ?? null,
      solClave: descifrar(a?.solClaveCifrada),
      certificado: descifrar(a?.certificadoCifrado),
      certificadoClave: descifrar(a?.certificadoClaveCifrada),
      consultaDocToken: descifrar(a?.consultaDocTokenCifrado),
    };
  }

  async obtener(empresaId: number, producto: Producto) {
    const pe = await this.productoEmpresa(empresaId, producto);
    return this.publico(await this.deProducto(pe.id));
  }

  async actualizar(empresaId: number, producto: Producto, c: CambiosAjustes) {
    const pe = await this.productoEmpresa(empresaId, producto);
    const actual = await this.deProducto(pe.id);
    const data: Partial<AjustesProducto> = {};
    if (c.solUsuario !== undefined) data.solUsuario = c.solUsuario.trim().toUpperCase() || null;
    // Una clave vacía no borra la guardada; el token vacío sí desactiva la consulta.
    if (c.solClave) data.solClaveCifrada = cifrar(c.solClave);
    if (c.consultaDocToken !== undefined) data.consultaDocTokenCifrado = c.consultaDocToken.trim() ? cifrar(c.consultaDocToken.trim()) : null;
    if (c.backupHora !== undefined) data.backupHora = c.backupHora;
    if (c.backupConservar !== undefined) data.backupConservar = c.backupConservar;
    if (c.sunatModo !== undefined) {
      if (c.sunatModo !== 'DESACTIVADO' && !actual.certificadoCifrado) {
        throw new BadRequestException('Carga primero el certificado digital');
      }
      const solUsuario = data.solUsuario !== undefined ? data.solUsuario : actual.solUsuario;
      const solClave = data.solClaveCifrada ?? actual.solClaveCifrada;
      if (c.sunatModo === 'PRODUCCION' && (!solUsuario || !solClave)) {
        throw new BadRequestException('Para producción faltan el usuario SOL secundario y su clave');
      }
      data.sunatModo = c.sunatModo;
    }
    const a = await this.prisma.ajustesProducto.update({ where: { productoEmpresaId: pe.id }, data });
    return this.publico(a);
  }

  async cargarCertificado(empresaId: number, producto: Producto, pfx: Buffer, clave: string) {
    const pe = await this.productoEmpresa(empresaId, producto);
    await this.deProducto(pe.id);
    let info;
    try {
      info = leerPfx(pfx, clave);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const a = await this.prisma.ajustesProducto.update({
      where: { productoEmpresaId: pe.id },
      data: {
        certificadoCifrado: cifrar(pfx.toString('base64')),
        certificadoClaveCifrada: cifrar(clave),
        certificadoSujeto: info.sujeto,
        certificadoVence: info.venceEl,
      },
    });
    return this.publico(a);
  }
}
