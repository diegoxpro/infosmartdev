-- Inventario: varias fechas de vencimiento por producto (cantidad por fecha).
ALTER TABLE "InventarioItem" ADD COLUMN "lotes" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "contadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "InventarioConteo" ADD COLUMN "lotes" JSONB NOT NULL DEFAULT '[]';

-- La fecha única de antes pasa a ser un lote con toda la cantidad.
UPDATE "InventarioItem" SET "contadoEn" = "actualizado",
  "lotes" = CASE WHEN "fechaVencimiento" IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('fecha', to_char("fechaVencimiento", 'YYYY-MM-DD'), 'cantidad', "cantidad"::float8)) END;
UPDATE "InventarioConteo" SET
  "lotes" = CASE WHEN "fechaVencimiento" IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('fecha', to_char("fechaVencimiento", 'YYYY-MM-DD'), 'cantidad', "cantidad"::float8)) END;

ALTER TABLE "InventarioItem" DROP COLUMN "fechaVencimiento";
ALTER TABLE "InventarioConteo" DROP COLUMN "fechaVencimiento";
