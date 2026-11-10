import { IsString } from 'class-validator';

/** Usuario y clave de un administrador que autoriza la operación. */
export class AutorizacionDto {
  @IsString() usuario: string;
  @IsString() password: string;
}
