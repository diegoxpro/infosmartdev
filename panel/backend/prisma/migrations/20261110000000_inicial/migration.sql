-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoEmpresa" AS ENUM ('PRUEBA', 'ACTIVA', 'SUSPENDIDA');

-- CreateEnum
CREATE TYPE "Producto" AS ENUM ('VENTAS', 'LAVADERO');

-- CreateTable
CREATE TABLE "Superadmin" (
    "id" SERIAL NOT NULL,
    "usuario" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "claveHash" TEXT NOT NULL,
    "creadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Superadmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioMensual" DECIMAL(10,2) NOT NULL,
    "maxUsuarios" INTEGER NOT NULL DEFAULT 3,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empresa" (
    "id" SERIAL NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "subdominio" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "correo" TEXT,
    "estado" "EstadoEmpresa" NOT NULL DEFAULT 'PRUEBA',
    "planId" INTEGER NOT NULL,
    "venceEl" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "creadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductoEmpresa" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "producto" "Producto" NOT NULL,
    "baseDatos" TEXT NOT NULL,
    "adminUsuario" TEXT NOT NULL,
    "adminClaveHash" TEXT NOT NULL,
    "adminClaveTemporal" BOOLEAN NOT NULL DEFAULT true,
    "aprovisionado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductoEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evento" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER,
    "tipo" TEXT NOT NULL,
    "detalle" TEXT,
    "usuario" TEXT,
    "creadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Superadmin_usuario_key" ON "Superadmin"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_codigo_key" ON "Plan"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_ruc_key" ON "Empresa"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_subdominio_key" ON "Empresa"("subdominio");

-- CreateIndex
CREATE UNIQUE INDEX "ProductoEmpresa_baseDatos_key" ON "ProductoEmpresa"("baseDatos");

-- CreateIndex
CREATE UNIQUE INDEX "ProductoEmpresa_empresaId_producto_key" ON "ProductoEmpresa"("empresaId", "producto");

-- CreateIndex
CREATE INDEX "Evento_empresaId_creadoEl_idx" ON "Evento"("empresaId", "creadoEl");

-- AddForeignKey
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductoEmpresa" ADD CONSTRAINT "ProductoEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Planes iniciales
INSERT INTO "Plan" ("codigo", "nombre", "precioMensual", "maxUsuarios") VALUES
  ('basico', 'Básico', 49.00, 3),
  ('negocio', 'Negocio', 89.00, 10);
