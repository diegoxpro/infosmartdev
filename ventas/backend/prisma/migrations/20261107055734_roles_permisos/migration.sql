-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "perfilId" INTEGER;

-- CreateTable
CREATE TABLE "Perfil" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "permisos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermisoUsuario" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "permiso" TEXT NOT NULL,
    "concedido" BOOLEAN NOT NULL,
    "hasta" TIMESTAMP(3),
    "dadoPorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermisoUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermisoHistorial" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "perfilId" INTEGER,
    "permiso" TEXT,
    "accion" TEXT NOT NULL,
    "hasta" TIMESTAMP(3),
    "detalle" TEXT,
    "hechoPorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermisoHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Perfil_nombre_key" ON "Perfil"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "PermisoUsuario_usuarioId_permiso_key" ON "PermisoUsuario"("usuarioId", "permiso");

-- CreateIndex
CREATE INDEX "PermisoHistorial_usuarioId_createdAt_idx" ON "PermisoHistorial"("usuarioId", "createdAt");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "Perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermisoUsuario" ADD CONSTRAINT "PermisoUsuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermisoUsuario" ADD CONSTRAINT "PermisoUsuario_dadoPorId_fkey" FOREIGN KEY ("dadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermisoHistorial" ADD CONSTRAINT "PermisoHistorial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermisoHistorial" ADD CONSTRAINT "PermisoHistorial_hechoPorId_fkey" FOREIGN KEY ("hechoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rol "Cajero" con lo que el cajero podía hacer antes de los roles
-- (descuento, editar y anular siguen pidiendo la clave del administrador).
INSERT INTO "Perfil" ("nombre", "permisos", "updatedAt")
VALUES ('Cajero', ARRAY['ventas.vender','ventas.caja','ventas.ver','ventas.descuento','ventas.editar','ventas.anular','clientes.editar','compras.ver'], CURRENT_TIMESTAMP);

UPDATE "Usuario" SET "perfilId" = (SELECT "id" FROM "Perfil" WHERE "nombre" = 'Cajero') WHERE "rol" = 'CAJERO';
