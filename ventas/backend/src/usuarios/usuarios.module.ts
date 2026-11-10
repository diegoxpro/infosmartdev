import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { UsuariosController } from './usuarios.controller';

@Module({ controllers: [UsuariosController, RolesController] })
export class UsuariosModule {}
