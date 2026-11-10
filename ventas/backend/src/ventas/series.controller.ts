import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Permiso } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

class EditarSerieDto {
  @IsOptional() @IsInt() @Min(0) ultimoNumero?: number;
  @IsOptional() @IsBoolean() activa?: boolean;
}

@Controller('series')
export class SeriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  listar() {
    return this.prisma.serie.findMany({ orderBy: { id: 'asc' } });
  }

  @Permiso('config.series')
  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarSerieDto) {
    return this.prisma.serie.update({ where: { id }, data: dto });
  }
}
