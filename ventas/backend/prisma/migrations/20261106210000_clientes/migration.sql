-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "notas" TEXT;

-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "consultaDocToken" TEXT;
