-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "backupCarpeta" TEXT,
ADD COLUMN     "backupConservar" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "backupHora" TEXT NOT NULL DEFAULT '22:00',
ADD COLUMN     "pgDumpRuta" TEXT;
