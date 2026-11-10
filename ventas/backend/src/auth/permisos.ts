/**
 * Catálogo de permisos del sistema. Cada ruta protegida pide uno de estos
 * permisos con @Permiso(...). Los roles agrupan permisos y a cada usuario se
 * le pueden dar permisos extra (también por un tiempo).
 */
export const PERMISOS = {
  // Ventas
  'ventas.vender': { grupo: 'Ventas', nombre: 'Vender' },
  'ventas.caja': { grupo: 'Ventas', nombre: 'Abrir y cerrar caja, registrar gastos' },
  'ventas.ver': { grupo: 'Ventas', nombre: 'Ver ventas realizadas' },
  'ventas.descuento': { grupo: 'Ventas', nombre: 'Dar descuento o cambiar precio' },
  'ventas.editar': { grupo: 'Ventas', nombre: 'Editar ventas' },
  'ventas.anular': { grupo: 'Ventas', nombre: 'Anular ventas' },
  'ventas.sunat': { grupo: 'Ventas', nombre: 'Reenviar boletas a SUNAT' },
  // Clientes
  'clientes.editar': { grupo: 'Clientes', nombre: 'Crear y editar clientes' },
  'clientes.eliminar': { grupo: 'Clientes', nombre: 'Eliminar clientes' },
  // Compras
  'compras.ver': { grupo: 'Compras', nombre: 'Ver compras' },
  'compras.registrar': { grupo: 'Compras', nombre: 'Registrar y anular compras' },
  'compras.pagar': { grupo: 'Compras', nombre: 'Pagar cuentas por pagar' },
  'proveedores.editar': { grupo: 'Compras', nombre: 'Crear y editar proveedores' },
  // Almacén
  'productos.editar': { grupo: 'Almacén', nombre: 'Crear y editar productos y precios' },
  'productos.importar': { grupo: 'Almacén', nombre: 'Importar productos desde Excel' },
  'stock.ajustar': { grupo: 'Almacén', nombre: 'Registrar mermas y ajustes de stock' },
  'inventario.realizar': { grupo: 'Almacén', nombre: 'Realizar inventario (contar, validar y cerrar)' },
  // Gastos y acumulado
  'gastos.registrar': { grupo: 'Gastos', nombre: 'Registrar gastos y ver el acumulado' },
  'acumulado.contar': { grupo: 'Gastos', nombre: 'Conteo semanal del acumulado' },
  'acumulado.retirar': { grupo: 'Gastos', nombre: 'Retiros, depósitos y traspasos del acumulado' },
  'gastos.anular': { grupo: 'Gastos', nombre: 'Anular y corregir gastos' },
  'gastos.configurar': { grupo: 'Gastos', nombre: 'Categorías y gastos fijos' },
  // Reportes
  'reportes.ventas': { grupo: 'Reportes', nombre: 'Reporte de venta' },
  'reportes.compras': { grupo: 'Reportes', nombre: 'Reporte de compra' },
  'reportes.kardex': { grupo: 'Reportes', nombre: 'Reporte de kardex' },
  'reportes.sunat': { grupo: 'Reportes', nombre: 'Boletas SUNAT' },
  'reportes.gastos': { grupo: 'Reportes', nombre: 'Reporte de gastos y acumulado' },
  // Configuración
  'config.preferencias': { grupo: 'Configuración', nombre: 'Preferencias y datos de la tienda' },
  // Solo el administrador; no se puede dar a otros.
  'config.usuarios': { grupo: 'Configuración', nombre: 'Usuarios, roles y permisos', soloAdmin: true },
  'config.series': { grupo: 'Configuración', nombre: 'Series de comprobantes' },
  'config.sunat': { grupo: 'Configuración', nombre: 'Conexión con SUNAT' },
  'config.backup': { grupo: 'Configuración', nombre: 'Copias de seguridad' },
  'config.red': { grupo: 'Configuración', nombre: 'Red local' },
} as const;

export type ClavePermiso = keyof typeof PERMISOS;

export const TODOS_LOS_PERMISOS = Object.keys(PERMISOS) as ClavePermiso[];

/** Permisos que se pueden poner en un rol o dar a un usuario. */
export const PERMISOS_ASIGNABLES = TODOS_LOS_PERMISOS.filter((p) => !('soloAdmin' in PERMISOS[p]));

/**
 * Lo que hacía el cajero antes de los roles; es el punto de partida del rol
 * Cajero (debe coincidir con las migraciones roles_permisos y gastos_acumulado). Descuento, editar y
 * anular siguen pidiendo la clave de un administrador.
 */
export const PERMISOS_CAJERO: ClavePermiso[] = [
  'ventas.vender',
  'ventas.caja',
  'ventas.ver',
  'ventas.descuento',
  'ventas.editar',
  'ventas.anular',
  'clientes.editar',
  'compras.ver',
  'gastos.registrar',
  'acumulado.contar',
];

export function esPermiso(clave: string): clave is ClavePermiso {
  return Object.prototype.hasOwnProperty.call(PERMISOS, clave);
}
