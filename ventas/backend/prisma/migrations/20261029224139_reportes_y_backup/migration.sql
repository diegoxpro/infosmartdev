-- CreateTable
CREATE TABLE "Backup" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivo" TEXT,
    "tamano" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "origen" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);
