-- CreateEnum
CREATE TYPE "CuentaFondo" AS ENUM ('EFECTIVO', 'YAPE');

-- CreateEnum
CREATE TYPE "TipoMovimientoFondo" AS ENUM ('CIERRE_CAJA', 'GASTO', 'PAGO_PROVEEDOR', 'RETIRO', 'TRASPASO', 'AJUSTE_CONTEO', 'ANULACION');

-- CreateEnum
CREATE TYPE "OrigenGasto" AS ENUM ('ACUMULADO', 'CAJA');

-- CreateEnum
CREATE TYPE "EstadoGasto" AS ENUM ('REGISTRADO', 'ANULADO');

-- AlterEnum
ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'RETIRO';

-- CreateTable
CREATE TABLE "MovimientoFondo" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "tipo" "TipoMovimientoFondo" NOT NULL,
    "cuenta" "CuentaFondo" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "concepto" TEXT NOT NULL,
    "cajaId" INTEGER,
    "gastoId" INTEGER,
    "pagoProveedorId" INTEGER,
    "conteoId" INTEGER,

    CONSTRAINT "MovimientoFondo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConteoFondo" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "efectivoEsperado" DECIMAL(12,2) NOT NULL,
    "efectivoContado" DECIMAL(12,2) NOT NULL,
    "yapeEsperado" DECIMAL(12,2) NOT NULL,
    "yapeContado" DECIMAL(12,2) NOT NULL,
    "diferenciaEfectivo" DECIMAL(12,2) NOT NULL,
    "diferenciaYape" DECIMAL(12,2) NOT NULL,
    "detalle" JSONB NOT NULL,
    "observacion" TEXT,

    CONSTRAINT "ConteoFondo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaGasto" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "pideTrabajador" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoriaGasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GastoFijo" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "diaPago" INTEGER NOT NULL,
    "monto" DECIMAL(12,2),
    "trabajador" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GastoFijo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoriaId" INTEGER NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "origen" "OrigenGasto" NOT NULL,
    "medioPago" "MedioPago" NOT NULL DEFAULT 'EFECTIVO',
    "numeroOperacion" TEXT,
    "trabajador" TEXT,
    "nota" TEXT,
    "gastoFijoId" INTEGER,
    "periodo" TEXT,
    "usuarioId" INTEGER NOT NULL,
    "movimientoCajaId" INTEGER,
    "estado" "EstadoGasto" NOT NULL DEFAULT 'REGISTRADO',
    "anuladoPorId" INTEGER,
    "fechaAnulacion" TIMESTAMP(3),
    "motivoAnulacion" TEXT,

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoFondo_pagoProveedorId_key" ON "MovimientoFondo"("pagoProveedorId");

-- CreateIndex
CREATE INDEX "MovimientoFondo_fecha_idx" ON "MovimientoFondo"("fecha");

-- CreateIndex
CREATE INDEX "MovimientoFondo_cuenta_idx" ON "MovimientoFondo"("cuenta");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaGasto_nombre_key" ON "CategoriaGasto"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_movimientoCajaId_key" ON "Gasto"("movimientoCajaId");

-- CreateIndex
CREATE INDEX "Gasto_fecha_idx" ON "Gasto"("fecha");

-- CreateIndex
CREATE INDEX "Gasto_gastoFijoId_periodo_idx" ON "Gasto"("gastoFijoId", "periodo");

-- AddForeignKey
ALTER TABLE "MovimientoFondo" ADD CONSTRAINT "MovimientoFondo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFondo" ADD CONSTRAINT "MovimientoFondo_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFondo" ADD CONSTRAINT "MovimientoFondo_gastoId_fkey" FOREIGN KEY ("gastoId") REFERENCES "Gasto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFondo" ADD CONSTRAINT "MovimientoFondo_pagoProveedorId_fkey" FOREIGN KEY ("pagoProveedorId") REFERENCES "PagoProveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoFondo" ADD CONSTRAINT "MovimientoFondo_conteoId_fkey" FOREIGN KEY ("conteoId") REFERENCES "ConteoFondo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConteoFondo" ADD CONSTRAINT "ConteoFondo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoFijo" ADD CONSTRAINT "GastoFijo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaGasto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaGasto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_gastoFijoId_fkey" FOREIGN KEY ("gastoFijoId") REFERENCES "GastoFijo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_movimientoCajaId_fkey" FOREIGN KEY ("movimientoCajaId") REFERENCES "MovimientoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Categorías de gasto iniciales (se pueden editar en Gastos › Categorías).
INSERT INTO "CategoriaGasto" ("nombre", "pideTrabajador") VALUES
  ('Luz', false), ('Agua', false), ('Internet y teléfono', false), ('Alquiler', false),
  ('Sueldos y adelantos', true), ('Movilidad y pasajes', false), ('Bolsas y útiles', false),
  ('Limpieza', false), ('Mantenimiento', false), ('Municipalidad e impuestos', false), ('Otros', false);

-- Los gastos que ya se registraron en caja (sin categoría) pasan a la tabla de gastos.
INSERT INTO "CategoriaGasto" ("nombre")
SELECT 'Sin categoría' WHERE EXISTS (SELECT 1 FROM "MovimientoCaja" WHERE "tipo" = 'EGRESO' AND "pagoProveedorId" IS NULL);

INSERT INTO "Gasto" ("fecha", "categoriaId", "concepto", "monto", "origen", "medioPago", "usuarioId", "movimientoCajaId")
SELECT m."fecha", (SELECT "id" FROM "CategoriaGasto" WHERE "nombre" = 'Sin categoría'), m."concepto", m."monto", 'CAJA', 'EFECTIVO', m."usuarioId", m."id"
FROM "MovimientoCaja" m
WHERE m."tipo" = 'EGRESO' AND m."pagoProveedorId" IS NULL;

-- El rol Cajero puede registrar gastos y hacer el conteo semanal del acumulado.
UPDATE "Perfil" SET "permisos" = array_cat("permisos", ARRAY['gastos.registrar', 'acumulado.contar']), "updatedAt" = CURRENT_TIMESTAMP
WHERE "nombre" = 'Cajero';
