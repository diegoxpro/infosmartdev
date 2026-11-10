-- AlterEnum
ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'VENTA_SIN_COMPROBANTE';

-- AlterTable
ALTER TABLE "MovimientoCaja" ADD COLUMN     "medioPago" "MedioPago";
