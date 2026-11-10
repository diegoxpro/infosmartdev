-- CreateEnum
CREATE TYPE "EstadoInventario" AS ENUM ('EN_CURSO', 'REVISION', 'VALIDADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoConteo" AS ENUM ('APLICADO', 'PENDIENTE', 'SUMADO', 'REEMPLAZADO', 'DESCARTADO');

-- AlterEnum
ALTER TYPE "TipoMovimiento" ADD VALUE 'INVENTARIO';

-- CreateTable
CREATE TABLE "Inventario" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "estado" "EstadoInventario" NOT NULL DEFAULT 'EN_CURSO',
    "usuarioId" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "validadoAt" TIMESTAMP(3),
    "observacion" TEXT,

    CONSTRAINT "Inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventarioOperador" (
    "id" SERIAL NOT NULL,
    "inventarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAcceso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventarioOperador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventarioItem" (
    "id" SERIAL NOT NULL,
    "inventarioId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "stockReferencia" DECIMAL(12,3) NOT NULL,
    "fechaVencimiento" DATE,
    "actualizado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventarioConteo" (
    "id" SERIAL NOT NULL,
    "inventarioId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "operadorId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "stockAlContar" DECIMAL(12,3) NOT NULL,
    "fechaVencimiento" DATE,
    "estado" "EstadoConteo" NOT NULL DEFAULT 'APLICADO',
    "clienteId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventarioConteo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inventario_token_key" ON "Inventario"("token");

-- CreateIndex
CREATE INDEX "Inventario_estado_idx" ON "Inventario"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "InventarioOperador_token_key" ON "InventarioOperador"("token");

-- CreateIndex
CREATE UNIQUE INDEX "InventarioItem_inventarioId_productoId_key" ON "InventarioItem"("inventarioId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "InventarioConteo_clienteId_key" ON "InventarioConteo"("clienteId");

-- CreateIndex
CREATE INDEX "InventarioConteo_inventarioId_id_idx" ON "InventarioConteo"("inventarioId", "id");

-- AddForeignKey
ALTER TABLE "Inventario" ADD CONSTRAINT "Inventario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioOperador" ADD CONSTRAINT "InventarioOperador_inventarioId_fkey" FOREIGN KEY ("inventarioId") REFERENCES "Inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioItem" ADD CONSTRAINT "InventarioItem_inventarioId_fkey" FOREIGN KEY ("inventarioId") REFERENCES "Inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioItem" ADD CONSTRAINT "InventarioItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioConteo" ADD CONSTRAINT "InventarioConteo_inventarioId_fkey" FOREIGN KEY ("inventarioId") REFERENCES "Inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioConteo" ADD CONSTRAINT "InventarioConteo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventarioItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioConteo" ADD CONSTRAINT "InventarioConteo_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "InventarioOperador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
