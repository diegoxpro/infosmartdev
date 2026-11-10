export type Rol = 'ADMIN' | 'CAJERO';
export type Dec = string | number;

export type ClavePermiso =
  | 'ventas.vender' | 'ventas.caja' | 'ventas.ver' | 'ventas.descuento' | 'ventas.editar' | 'ventas.anular' | 'ventas.sunat'
  | 'clientes.editar' | 'clientes.eliminar'
  | 'compras.ver' | 'compras.registrar' | 'compras.pagar' | 'proveedores.editar'
  | 'productos.editar' | 'productos.importar' | 'stock.ajustar' | 'inventario.realizar'
  | 'gastos.registrar' | 'acumulado.contar' | 'acumulado.retirar' | 'gastos.anular' | 'gastos.configurar'
  | 'reportes.ventas' | 'reportes.compras' | 'reportes.kardex' | 'reportes.sunat' | 'reportes.gastos'
  | 'config.preferencias' | 'config.usuarios' | 'config.series' | 'config.sunat' | 'config.backup' | 'config.red';

export interface PermisoEfectivo {
  permiso: ClavePermiso;
  /** ROL = viene de su rol; USUARIO = se le dio aparte. */
  origen: 'ROL' | 'USUARIO';
  hasta: string | null;
  nombre?: string;
}

export interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo?: boolean;
  perfil?: { id: number; nombre: string } | null;
  permisos: PermisoEfectivo[];
}

/** Rol del personal (el administrador es fijo). */
export interface Perfil {
  id: number;
  nombre: string;
  permisos: ClavePermiso[];
  usuarios: { id: number; nombre: string; activo: boolean }[];
}

export interface PermisoCatalogo { clave: ClavePermiso; grupo: string; nombre: string }
export interface Catalogo { id: number; nombre: string }

export interface Producto {
  id: number;
  codigoBarra: string | null;
  codigoAnterior: string | null;
  nombre: string;
  categoriaId: number | null;
  marcaId: number | null;
  categoria: Catalogo | null;
  marca: Catalogo | null;
  unidad: string;
  costo: Dec;
  precio1: Dec;
  precio2: Dec;
  precio3: Dec;
  margen1: Dec | null;
  margen2: Dec | null;
  margen3: Dec | null;
  stock: Dec;
  stockMinimo: Dec;
  afectacionIgv: 'GRAVADO' | 'EXONERADO' | 'INAFECTO';
  controlaVencimiento: boolean;
  activo: boolean;
  revisar: string | null;
  lotes?: Lote[];
  presentaciones?: Presentacion[];
  /** Presentación cuyo código se escaneó (solo al buscar por código). */
  presentacion?: Presentacion | null;
}

/** Cajetilla, paquete, caja…: vende o compra "factor" unidades del producto con sus propios precios. */
export interface Presentacion {
  id: number;
  productoId: number;
  nombre: string;
  factor: Dec;
  codigoBarra: string | null;
  precio1: Dec;
  precio2: Dec;
  precio3: Dec;
  activo: boolean;
}

export interface Lote {
  id: number;
  productoId: number;
  codigo: string | null;
  fechaVencimiento: string;
  cantidad: Dec;
  producto?: Pick<Producto, 'id' | 'nombre' | 'codigoBarra' | 'unidad' | 'stock' | 'costo'>;
}

export interface Proveedor {
  id: number;
  ruc: string | null;
  razonSocial: string;
  nombreComercial: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  /** Días de crédito que suele dar: la compra propone Crédito con esa fecha de pago. */
  diasCredito?: number | null;
  notas?: string | null;
  activo: boolean;
  deuda?: Dec;
}

export type MedioPago = 'EFECTIVO' | 'TARJETA' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA';
export const MEDIOS: MedioPago[] = ['EFECTIVO', 'TARJETA', 'YAPE', 'PLIN', 'TRANSFERENCIA'];
export const MEDIO_LABEL: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
};

export type TipoDoc = 'FACTURA' | 'BOLETA' | 'GUIA' | 'NOTA_VENTA';
export const DOC_LABEL: Record<TipoDoc, string> = {
  FACTURA: 'Factura',
  BOLETA: 'Boleta',
  GUIA: 'Guía de remisión',
  NOTA_VENTA: 'Nota de venta',
};

export interface Compra {
  id: number;
  proveedorId: number;
  proveedor: Pick<Proveedor, 'id' | 'razonSocial' | 'ruc'> & Partial<Proveedor>;
  tipoDocumento: TipoDoc;
  serie: string;
  numero: string;
  fechaEmision: string;
  condicion: 'CONTADO' | 'CREDITO';
  fechaVencimiento: string | null;
  total: Dec;
  saldo: Dec;
  estado: 'REGISTRADA' | 'ANULADA';
  observacion: string | null;
  usuario?: { nombre: string };
  _count?: { items: number };
  items?: {
    id: number;
    cantidad: Dec;
    costoUnitario: Dec;
    subtotal: Dec;
    codigoLote: string | null;
    fechaVencimiento: string | null;
    factor: Dec;
    producto: Pick<Producto, 'id' | 'nombre' | 'codigoBarra' | 'unidad'>;
    presentacion: Pick<Presentacion, 'id' | 'nombre' | 'factor'> | null;
  }[];
  pagos?: {
    id: number;
    fecha: string;
    monto: Dec;
    medioPago: MedioPago;
    numeroOperacion: string | null;
    usuario: { nombre: string };
    movimientoCaja?: { id: number } | null;
    movimientoFondo?: { cuenta: CuentaFondo } | null;
  }[];
}

export interface Sugerencia {
  productoId: number;
  presentacionId: number | null;
  nombre: string;
  costoAnterior: number | null;
  costoNuevo: number;
  margenes: number[];
  actuales: number[];
  sugeridos: number[];
}

export interface Configuracion {
  /** El token no llega al navegador: solo si está puesto. */
  consultaDocConfigurada?: boolean;
  /** Modo nube (Infosmart): SUNAT, consulta DNI/RUC, backups y red local los administra el panel. */
  nube?: { empresa: string | null; vence: string | null; plan: string | null } | null;
  empresaNombre: string;
  empresaRuc: string | null;
  empresaDireccion: string | null;
  permitirVentaSinStock: boolean;
  margen1: Dec;
  margen2: Dec;
  margen3: Dec;
  redondeoPrecio: Dec;
  diasAvisoVencimiento: number;
  montoInicialCaja: Dec;
  mensajeTicket: string | null;
  backupCarpeta: string | null;
  backupHora: string;
  backupConservar: number;
  pgDumpRuta: string | null;
  empresaRazonSocial: string | null;
  empresaUbigeo: string | null;
  empresaDepartamento: string | null;
  empresaProvincia: string | null;
  empresaDistrito: string | null;
  codigoEstablecimiento: string;
  sunatModo: 'DESACTIVADO' | 'BETA' | 'PRODUCCION';
}

export type EstadoSunat = 'NO_APLICA' | 'PENDIENTE' | 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO' | 'BAJA_PENDIENTE' | 'BAJA_ENVIADA' | 'BAJA_ACEPTADA';
export const SUNAT_LABEL: Record<EstadoSunat, { texto: string; clase: string }> = {
  NO_APLICA: { texto: 'No aplica', clase: '' },
  PENDIENTE: { texto: 'Por enviar', clase: 'warn' },
  ACEPTADO: { texto: 'Aceptada', clase: 'ok' },
  OBSERVADO: { texto: 'Aceptada con obs.', clase: 'ok' },
  RECHAZADO: { texto: 'Rechazada', clase: 'danger' },
  BAJA_PENDIENTE: { texto: 'Baja por enviar', clase: 'warn' },
  BAJA_ENVIADA: { texto: 'Baja enviada', clase: 'info' },
  BAJA_ACEPTADA: { texto: 'Baja aceptada', clase: '' },
};

export interface EstadoSunatGeneral {
  modo: Configuracion['sunatModo'];
  certificado: { sujeto: string; emisor: string; venceEl: string } | null;
  errorCertificado: string | null;
  solConfigurado: boolean;
  solUsuario: string | null;
  conteo: Partial<Record<EstadoSunat, number>>;
  atrasadas: number;
}

export interface Backup {
  id: number;
  fecha: string;
  archivo: string | null;
  tamano: number | null;
  ok: boolean;
  origen: string;
  error: string | null;
}

export interface EstadoBackup {
  carpeta: string | null;
  carpetaLocal: string;
  hora: string;
  conservar: number;
  ultimoOk: Backup | null;
  atrasado: boolean;
  historial: Backup[];
}

export interface Movimiento {
  id: number;
  tipo: string;
  cantidad: Dec;
  stockResultante: Dec;
  costoUnitario: Dec;
  referencia: string | null;
  motivo: string | null;
  fecha: string;
  producto: { nombre: string; codigoBarra?: string | null };
  usuario: { nombre: string } | null;
  lote: Lote | null;
  valor?: number;
}

export interface Alertas {
  diasAviso: number;
  stockBajo: { id: number; nombre: string; codigoBarra: string | null; stock: Dec; stockMinimo: Dec }[];
  vencidos: Lote[];
  porVencer: Lote[];
}

export type TipoComprobante = 'BOLETA' | 'BOLETA_LIBRE';
export const COMPROBANTE_LABEL: Record<TipoComprobante, string> = { BOLETA: 'Boleta', BOLETA_LIBRE: 'Boleta libre' };

export interface Cliente {
  id: number;
  tipoDoc: 'DNI' | 'RUC' | 'CE' | 'SIN_DOCUMENTO';
  numeroDoc: string | null;
  nombre: string;
  direccion: string | null;
  telefono?: string | null;
  email?: string | null;
  notas?: string | null;
  activo?: boolean;
}

export interface Serie {
  id: number;
  tipo: TipoComprobante;
  serie: string;
  ultimoNumero: number;
  activa: boolean;
}

export interface Venta {
  id: number;
  cajaId: number;
  tipoComprobante: TipoComprobante;
  serie: string;
  numero: number;
  fecha: string;
  nivelPrecio: number;
  subtotal: Dec;
  descuento: Dec;
  total: Dec;
  opExonerada: Dec;
  opGravada: Dec;
  opInafecta: Dec;
  igv: Dec;
  costoTotal: Dec;
  efectivoRecibido: Dec | null;
  vuelto: Dec;
  estado: 'EMITIDA' | 'ANULADA';
  motivoAnulacion: string | null;
  estadoSunat: EstadoSunat;
  hashCpe: string | null;
  cdrCodigo: string | null;
  cdrMensaje: string | null;
  sunatError: string | null;
  sunatEnviadoEn: string | null;
  fechaAnulacion: string | null;
  cliente: Cliente | null;
  usuario: { nombre: string };
  autorizadoPor?: { nombre: string } | null;
  anuladaPor?: { nombre: string } | null;
  items?: {
    id: number;
    descripcion: string;
    cantidad: Dec;
    precioUnitario: Dec;
    descuento: Dec;
    subtotal: Dec;
    producto: { codigoBarra: string | null; unidad: string };
  }[];
  pagos: { id: number; medioPago: MedioPago; monto: Dec; numeroOperacion: string | null }[];
  caja?: { estado: 'ABIERTA' | 'CERRADA' };
  ediciones?: { id: number; fecha: string; detalle: string; usuario: { nombre: string } }[];
  envios?: { id: number; fecha: string; resultado: 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO' | 'ERROR'; codigo: string | null; mensaje: string | null }[];
}

export interface ResumenCaja {
  montoInicial: number;
  totalVentas: number;
  numeroVentas: number;
  utilidad: number;
  porMedio: Record<MedioPago, number>;
  porComprobante: { tipo: TipoComprobante; cantidad: number; total: number; descuento: number }[];
  anuladas: { cantidad: number; total: number };
  // Los cierres anteriores a las ventas sin comprobante no traen estos campos.
  sinComprobante?: { porMedio: Record<MedioPago, number>; total: number };
  totalPorMedio?: Record<MedioPago, number>;
  ingresos: number;
  gastos?: number;
  retiros?: number;
  pagosProveedor?: number;
  egresos: number;
  /** Total de efectivo que debe haber en caja. */
  efectivoEsperado: number;
  conteo?: { denominacion: number; cantidad: number }[];
  digital?: { medio: MedioPago; sistema: number; confirmado: number | null; diferencia?: number | null }[];
  sinCuadrar?: boolean;
  pendientes?: string[];
  efectivoContado?: number;
  diferencia?: number;
  /** Lo que pasó al acumulado al cerrar (cierres desde que existe el acumulado). */
  alAcumulado?: { efectivo: number; yape: number; quedaEnCaja: number };
}

export type TipoMovimientoCaja = 'INGRESO' | 'EGRESO' | 'VENTA_SIN_COMPROBANTE' | 'RETIRO';

export interface Caja {
  id: number;
  estado: 'ABIERTA' | 'CERRADA';
  fechaApertura: string;
  fechaCierre: string | null;
  montoInicial: Dec;
  efectivoEsperado: Dec | null;
  efectivoContado: Dec | null;
  diferencia: Dec | null;
  sinCuadrar?: boolean;
  observacion: string | null;
  usuarioApertura: { nombre: string };
  usuarioCierre: { nombre: string } | null;
  movimientos?: {
    id: number;
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: Dec;
    medioPago: MedioPago | null;
    fecha: string;
    usuario: { nombre: string };
  }[];
  resumen?: ResumenCaja;
}

// ---------------------------------------------------------------- Gastos y acumulado

export type CuentaFondo = 'EFECTIVO' | 'YAPE';
export const CUENTA_LABEL: Record<CuentaFondo, string> = { EFECTIVO: 'Efectivo', YAPE: 'Yape' };
export type OrigenGasto = 'ACUMULADO' | 'CAJA';
export const ORIGEN_LABEL: Record<OrigenGasto, string> = { ACUMULADO: 'Acumulado', CAJA: 'Caja del día' };

export type TipoMovimientoFondo = 'CIERRE_CAJA' | 'GASTO' | 'PAGO_PROVEEDOR' | 'RETIRO' | 'TRASPASO' | 'AJUSTE_CONTEO' | 'ANULACION';
export const TIPO_FONDO_LABEL: Record<TipoMovimientoFondo, string> = {
  CIERRE_CAJA: 'Cierre de caja',
  GASTO: 'Gasto',
  PAGO_PROVEEDOR: 'Pago a proveedor',
  RETIRO: 'Retiro o depósito',
  TRASPASO: 'Traspaso',
  AJUSTE_CONTEO: 'Ajuste de conteo',
  ANULACION: 'Anulación',
};

export interface SaldosFondo {
  EFECTIVO: number;
  YAPE: number;
  total: number;
}

export interface MovimientoFondo {
  id: number;
  fecha: string;
  tipo: TipoMovimientoFondo;
  cuenta: CuentaFondo;
  monto: Dec;
  concepto: string;
  usuario: { nombre: string };
}

export interface ConteoFondo {
  id: number;
  fecha: string;
  efectivoEsperado: Dec;
  efectivoContado: Dec;
  yapeEsperado: Dec;
  yapeContado: Dec;
  diferenciaEfectivo: Dec;
  diferenciaYape: Dec;
  detalle: { denominacion: number; cantidad: number }[];
  observacion: string | null;
  usuario: { nombre: string };
}

export interface ResumenFondo {
  saldos: SaldosFondo;
  ultimoConteo: ConteoFondo | null;
  movimientos: MovimientoFondo[];
}

export interface CategoriaGasto {
  id: number;
  nombre: string;
  pideTrabajador: boolean;
  activo: boolean;
  _count?: { gastos: number; gastosFijos: number };
}

export type EstadoGastoFijo = 'PAGADO' | 'VENCIDO' | 'HOY' | 'PROXIMO' | 'PENDIENTE';

export interface MesGastoFijo {
  periodo: string;
  fecha: string;
  estado: EstadoGastoFijo;
  dias: number;
}

export interface GastoFijo {
  id: number;
  nombre: string;
  categoriaId: number;
  categoria: { id: number; nombre: string; pideTrabajador: boolean };
  diaPago: number;
  monto: Dec | null;
  trabajador: string | null;
  activo: boolean;
  meses: MesGastoFijo[];
}

export interface AvisoGastoFijo extends MesGastoFijo {
  gastoFijoId: number;
  nombre: string;
  categoria: { id: number; nombre: string; pideTrabajador: boolean };
  monto: Dec | null;
  trabajador: string | null;
}

export interface Gasto {
  id: number;
  fecha: string;
  categoriaId: number;
  categoria: { id: number; nombre: string; pideTrabajador: boolean };
  concepto: string;
  monto: Dec;
  origen: OrigenGasto;
  medioPago: MedioPago;
  numeroOperacion: string | null;
  trabajador: string | null;
  nota: string | null;
  gastoFijo: { id: number; nombre: string } | null;
  periodo: string | null;
  estado: 'REGISTRADO' | 'ANULADO';
  usuario: { nombre: string };
  anuladoPor: { nombre: string } | null;
  fechaAnulacion: string | null;
  motivoAnulacion: string | null;
}
