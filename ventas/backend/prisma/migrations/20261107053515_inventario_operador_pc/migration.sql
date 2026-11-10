-- AlterTable
ALTER TABLE "InventarioOperador" ADD COLUMN     "usuarioId" INTEGER;

-- CreateIndex
CREATE INDEX "InventarioOperador_inventarioId_usuarioId_idx" ON "InventarioOperador"("inventarioId", "usuarioId");

-- AddForeignKey
ALTER TABLE "InventarioOperador" ADD CONSTRAINT "InventarioOperador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
