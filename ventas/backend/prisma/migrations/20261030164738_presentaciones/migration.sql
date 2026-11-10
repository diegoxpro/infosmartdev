-- AlterTable
ALTER TABLE "CompraItem" ADD COLUMN     "factor" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN     "presentacionId" INTEGER;

-- AlterTable
ALTER TABLE "VentaItem" ADD COLUMN     "factor" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN     "presentacionId" INTEGER;

-- CreateTable
CREATE TABLE "Presentacion" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "factor" DECIMAL(12,3) NOT NULL,
    "codigoBarra" TEXT,
    "precio1" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "precio2" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "precio3" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Presentacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Presentacion_codigoBarra_key" ON "Presentacion"("codigoBarra");

-- CreateIndex
CREATE INDEX "Presentacion_productoId_idx" ON "Presentacion"("productoId");

-- AddForeignKey
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "Presentacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "Presentacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
