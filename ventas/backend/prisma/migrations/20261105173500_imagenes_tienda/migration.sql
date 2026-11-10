-- CreateEnum
CREATE TYPE "TipoImagen" AS ENUM ('LOGO', 'FAVICON', 'LOGO_BOLETA');

-- CreateTable
CREATE TABLE "ImagenTienda" (
    "tipo" "TipoImagen" NOT NULL,
    "mime" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagenTienda_pkey" PRIMARY KEY ("tipo")
);
