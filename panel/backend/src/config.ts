function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const config = {
  jwtSecreto: requerida('JWT_SECRETO'),
  // Clave compartida con los backends de ventas y lavadero para la API interna
  claveInterna: requerida('CLAVE_INTERNA'),
  // Dominio bajo el que viven las empresas, p. ej. infosmart.pe o 190.119.59.24.nip.io
  dominioBase: process.env.DOMINIO_BASE ?? 'infosmart.pe',
  diasPrueba: Number(process.env.DIAS_PRUEBA ?? 15),
  // Cifra en la base las claves SOL, certificados y tokens de cada empresa
  claveCifrado: requerida('CLAVE_CIFRADO'),
  // Conexión al PostgreSQL de las empresas (la misma del panel) y carpeta de backups
  databaseUrl: requerida('DATABASE_URL'),
  respaldosDir: process.env.RESPALDOS_DIR ?? '/respaldos',
  pgDump: process.env.PG_DUMP ?? 'pg_dump',
};
