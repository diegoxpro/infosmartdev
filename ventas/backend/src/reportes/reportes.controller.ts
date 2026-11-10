import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { Permiso, UsuarioActual, UsuarioSesion } from '../auth/decorators';
import { ClavePermiso } from '../auth/permisos';
import { PermisosService } from '../auth/permisos.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { reporteAExcel } from './reporte';
import { defReporte, NombreReporte, REPORTES, ReportesService } from './reportes.service';

@Permiso('reportes.ventas', 'reportes.compras', 'reportes.kardex', 'reportes.sunat', 'reportes.gastos')
@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly reportes: ReportesService,
    private readonly config: ConfiguracionService,
    private readonly permisos: PermisosService,
  ) {}

  @Get()
  async lista(@UsuarioActual() user: UsuarioSesion) {
    const mios = await this.permisos.permisosDe(user);
    const ids = Object.keys(REPORTES).filter((id) => mios.has(`reportes.${defReporte(id as NombreReporte).categoria}` as ClavePermiso));
    return ids.map((id) => {
      const d = defReporte(id as NombreReporte);
      return { id, titulo: d.titulo, categoria: d.categoria, usaFechas: d.usaFechas !== false, requiereProducto: !!d.requiereProducto };
    });
  }

  @Get(':nombre')
  async generar(
    @Param('nombre') nombre: string,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('formato') formato: string | undefined,
    @Query('productoId') productoId: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @UsuarioActual() user: UsuarioSesion,
  ) {
    if (!(nombre in REPORTES)) throw new BadRequestException('Reporte desconocido');
    const def = defReporte(nombre as NombreReporte);
    if (!(await this.permisos.tiene(user, `reportes.${def.categoria}` as ClavePermiso))) {
      throw new ForbiddenException('No tienes permiso para ver este reporte');
    }
    const filtro = def.usaFechas === false ? { desde: new Date(0), hasta: new Date(), etiqueta: '' } : this.reportes.filtro(desde, hasta);
    const id = productoId ? Number(productoId) : undefined;
    if (id !== undefined && !Number.isInteger(id)) throw new BadRequestException('Producto inválido');
    const reporte = await this.reportes.generar(nombre as NombreReporte, filtro, id);
    if (formato !== 'xlsx') return reporte;

    const cfg = await this.config.obtener();
    const archivo = `${nombre}${id ? `_${id}` : ''}${def.usaFechas !== false && desde ? `_${desde}_${hasta}` : ''}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${archivo}"`,
    });
    return new StreamableFile(await reporteAExcel(reporte, cfg.empresaNombre));
  }
}
