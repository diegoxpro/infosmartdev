-- CreateTable
CREATE TABLE "VentaEdicion" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detalle" TEXT NOT NULL,

    CONSTRAINT "VentaEdicion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VentaEdicion_ventaId_idx" ON "VentaEdicion"("ventaId");

-- AddForeignKey
ALTER TABLE "VentaEdicion" ADD CONSTRAINT "VentaEdicion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaEdicion" ADD CONSTRAINT "VentaEdicion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
