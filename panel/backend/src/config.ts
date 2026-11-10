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
};
