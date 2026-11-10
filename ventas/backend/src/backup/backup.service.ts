import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { copyFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';

const ejecutar = promisify(execFile);
const PREFIJO = 'candys_';
/** Copia local siempre; la carpeta de Google Drive es la copia en la nube. */
export const CARPETA_LOCAL = resolve(process.env.BACKUP_LOCAL ?? join(process.cwd(), 'backups'));

/**
 * Backup de la base de datos con pg_dump. La nube es una carpeta sincronizada
 * por Google Drive para escritorio: funciona sin internet y sube cuando vuelve.
 */
@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private reloj?: NodeJS.Timeout;
  private enCurso: Promise<unknown> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfiguracionService,
  ) {}

  onModuleInit() {
    if (process.env.BACKUP_AUTOMATICO === '0') return;
    // Revisa cada 5 minutos si ya toca el backup del día (también recupera el
    // de un día en que la PC estuvo apagada a esa hora).
    this.reloj = setInterval(() => this.revisarProgramado().catch((e) => this.log.error(e.message)), 5 * 60_000);
    setTimeout(() => this.revisarProgramado().catch((e) => this.log.error(e.message)), 30_000);
  }

  onModuleDestroy() {
    clearInterval(this.reloj);
  }

  async revisarProgramado(ahora = new Date()) {
    const cfg = await this.config.obtener();
    const [h, m] = cfg.backupHora.split(':').map(Number);
    const hoyALaHora = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), h || 0, m || 0);
    if (ahora < hoyALaHora) return;
    const hecho = await this.prisma.backup.findFirst({ where: { ok: true, fecha: { gte: hoyALaHora } } });
    if (!hecho) await this.hacer('programado');
  }

  /** Hace un backup; si ya hay uno en curso, espera ese. */
  hacer(origen: 'programado' | 'manual' | 'cierre de caja') {
    this.enCurso ??= this.ejecutarBackup(origen).finally(() => (this.enCurso = null));
    return this.enCurso;
  }

  private async ejecutarBackup(origen: string) {
    const cfg = await this.config.obtener();
    const d = new Date();
    const dd = (x: number) => String(x).padStart(2, '0');
    // Hora local de la tienda en el nombre: candys_2026-10-29_2200.backup
    const sello = `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}_${dd(d.getHours())}${dd(d.getMinutes())}`;
    const nombre = `${PREFIJO}${sello}.backup`;
    const local = join(CARPETA_LOCAL, nombre);
    try {
      await mkdir(CARPETA_LOCAL, { recursive: true });
      const url = new URL(process.env.DATABASE_URL!);
      url.search = ''; // pg_dump no entiende ?schema=public
      await ejecutar(cfg.pgDumpRuta || 'pg_dump', ['--format=custom', '--no-owner', `--file=${local}`, url.toString()], { timeout: 10 * 60_000 });
      const { size } = await stat(local);

      let destino = local;
      if (cfg.backupCarpeta) {
        await mkdir(cfg.backupCarpeta, { recursive: true });
        destino = join(cfg.backupCarpeta, nombre);
        await copyFile(local, destino);
        await this.limpiar(cfg.backupCarpeta, cfg.backupConservar);
      }
      await this.limpiar(CARPETA_LOCAL, cfg.backupConservar);
      this.log.log(`Backup ${origen}: ${destino}`);
      return this.prisma.backup.create({ data: { ok: true, origen, archivo: destino, tamano: size } });
    } catch (e) {
      const error = (e as Error).message.split('\n')[0].slice(0, 500);
      this.log.error(`Backup ${origen} falló: ${error}`);
      return this.prisma.backup.create({ data: { ok: false, origen, error } });
    }
  }

  /** Deja solo los últimos `conservar` backups de la carpeta. */
  private async limpiar(carpeta: string, conservar: number) {
    const archivos = (await readdir(carpeta)).filter((f) => f.startsWith(PREFIJO) && f.endsWith('.backup')).sort();
    for (const viejo of archivos.slice(0, Math.max(0, archivos.length - Math.max(1, conservar)))) {
      await unlink(join(carpeta, viejo)).catch(() => undefined);
    }
  }

  async estado() {
    const cfg = await this.config.obtener();
    const [ultimoOk, historial] = await Promise.all([
      this.prisma.backup.findFirst({ where: { ok: true }, orderBy: { id: 'desc' } }),
      this.prisma.backup.findMany({ orderBy: { id: 'desc' }, take: 30 }),
    ]);
    const horas = ultimoOk ? (Date.now() - ultimoOk.fecha.getTime()) / 3_600_000 : null;
    return {
      carpeta: cfg.backupCarpeta,
      carpetaLocal: CARPETA_LOCAL,
      hora: cfg.backupHora,
      conservar: cfg.backupConservar,
      ultimoOk,
      atrasado: horas == null || horas > 48,
      historial,
    };
  }
}
