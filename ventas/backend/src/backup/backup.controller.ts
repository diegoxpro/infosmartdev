import { Controller, Get, Post } from '@nestjs/common';
import { Permiso } from '../auth/decorators';
import { BackupService } from './backup.service';

@Permiso('config.backup')
@Controller('backups')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  estado() {
    return this.backup.estado();
  }

  @Post()
  async hacer() {
    await this.backup.hacer('manual');
    return this.backup.estado();
  }
}
