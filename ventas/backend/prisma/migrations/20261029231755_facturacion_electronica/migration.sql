-- CreateEnum
CREATE TYPE "ModoSunat" AS ENUM ('DESACTIVADO', 'BETA', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "EstadoSunat" AS ENUM ('NO_APLICA', 'PENDIENTE', 'ACEPTADO', 'OBSERVADO', 'RECHAZADO', 'BAJA_PENDIENTE', 'BAJA_ENVIADA', 'BAJA_ACEPTADA');

-- CreateEnum
CREATE TYPE "EstadoResumen" AS ENUM ('ENVIADO', 'ACEPTADO', 'RECHAZADO');

-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "codigoEstablecimiento" TEXT NOT NULL DEFAULT '0000',
ADD COLUMN     "empresaDepartamento" TEXT,
ADD COLUMN     "empresaDistrito" TEXT,
ADD COLUMN     "empresaProvincia" TEXT,
ADD COLUMN     "empresaRazonSocial" TEXT,
ADD COLUMN     "empresaUbigeo" TEXT,
ADD COLUMN     "sunatModo" "ModoSunat" NOT NULL DEFAULT 'DESACTIVADO';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "cdrCodigo" TEXT,
ADD COLUMN     "cdrMensaje" TEXT,
ADD COLUMN     "estadoSunat" "EstadoSunat" NOT NULL DEFAULT 'NO_APLICA',
ADD COLUMN     "hashCpe" TEXT,
ADD COLUMN     "resumenBajaId" INTEGER,
ADD COLUMN     "sunatEnviadoEn" TIMESTAMP(3),
ADD COLUMN     "sunatError" TEXT,
ADD COLUMN     "sunatIntentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xmlFirmado" TEXT;

-- CreateTable
CREATE TABLE "ResumenDiario" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "fechaReferencia" DATE NOT NULL,
    "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticket" TEXT,
    "estado" "EstadoResumen" NOT NULL DEFAULT 'ENVIADO',
    "cdrCodigo" TEXT,
    "mensaje" TEXT,
    "xmlFirmado" TEXT,

    CONSTRAINT "ResumenDiario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumenDiario_identificador_key" ON "ResumenDiario"("identificador");

-- CreateIndex
CREATE INDEX "Venta_estadoSunat_idx" ON "Venta"("estadoSunat");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_resumenBajaId_fkey" FOREIGN KEY ("resumenBajaId") REFERENCES "ResumenDiario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
