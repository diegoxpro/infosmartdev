-- CreateEnum
CREATE TYPE "ModoSunat" AS ENUM ('DESACTIVADO', 'BETA', 'PRODUCCION');

-- CreateTable
CREATE TABLE "AjustesProducto" (
    "productoEmpresaId" INTEGER NOT NULL,
    "sunatModo" "ModoSunat" NOT NULL DEFAULT 'DESACTIVADO',
    "solUsuario" TEXT,
    "solClaveCifrada" TEXT,
    "certificadoCifrado" TEXT,
    "certificadoClaveCifrada" TEXT,
    "certificadoSujeto" TEXT,
    "certificadoVence" TIMESTAMP(3),
    "consultaDocTokenCifrado" TEXT,
    "backupHora" TEXT NOT NULL DEFAULT '03:00',
    "backupConservar" INTEGER NOT NULL DEFAULT 14,
    "actualizadoEl" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjustesProducto_pkey" PRIMARY KEY ("productoEmpresaId")
);

-- CreateTable
CREATE TABLE "Respaldo" (
    "id" SERIAL NOT NULL,
    "productoEmpresaId" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "motivo" TEXT NOT NULL,
    "archivo" TEXT,
    "bytes" INTEGER,
    "error" TEXT,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Respaldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Respaldo_productoEmpresaId_creadoEl_idx" ON "Respaldo"("productoEmpresaId", "creadoEl");

-- AddForeignKey
ALTER TABLE "AjustesProducto" ADD CONSTRAINT "AjustesProducto_productoEmpresaId_fkey" FOREIGN KEY ("productoEmpresaId") REFERENCES "ProductoEmpresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respaldo" ADD CONSTRAINT "Respaldo_productoEmpresaId_fkey" FOREIGN KEY ("productoEmpresaId") REFERENCES "ProductoEmpresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

