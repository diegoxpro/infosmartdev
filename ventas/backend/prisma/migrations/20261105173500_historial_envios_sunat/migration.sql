-- CreateEnum
CREATE TYPE "ResultadoEnvio" AS ENUM ('ACEPTADO', 'OBSERVADO', 'RECHAZADO', 'ERROR');

-- CreateTable
CREATE TABLE "EnvioSunat" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultado" "ResultadoEnvio" NOT NULL,
    "codigo" TEXT,
    "mensaje" TEXT,

    CONSTRAINT "EnvioSunat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvioSunat_fecha_idx" ON "EnvioSunat"("fecha");

-- CreateIndex
CREATE INDEX "EnvioSunat_ventaId_idx" ON "EnvioSunat"("ventaId");

-- AddForeignKey
ALTER TABLE "EnvioSunat" ADD CONSTRAINT "EnvioSunat_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las boletas que ya llegaron a SUNAT entran al historial con su fecha de envío.
INSERT INTO "EnvioSunat" ("ventaId", "fecha", "resultado", "codigo", "mensaje")
SELECT id, "sunatEnviadoEn",
       CASE WHEN "estadoSunat" = 'OBSERVADO' THEN 'OBSERVADO'::"ResultadoEnvio"
            WHEN "estadoSunat" = 'RECHAZADO' THEN 'RECHAZADO'::"ResultadoEnvio"
            ELSE 'ACEPTADO'::"ResultadoEnvio" END,
       "cdrCodigo", "cdrMensaje"
FROM "Venta"
WHERE "tipoComprobante" = 'BOLETA' AND "sunatEnviadoEn" IS NOT NULL;
