#!/usr/bin/env bash
# Arma el zip del instalador para Windows (no necesita internet en la tienda).
#
#   instalador/construir-paquete.sh            -> instalador/salida/CandysMarket-instalador-<fecha>.zip
#
# Necesita Node 22, npm, zip y curl. Se puede correr en Linux, macOS o Git Bash.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.4}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SALIDA="$REPO/instalador/salida"
TRABAJO="$SALIDA/trabajo"
NOMBRE="CandysMarket-instalador-$(date +%Y-%m-%d)"
PAQ="$TRABAJO/$NOMBRE"
APP="$PAQ/paquete/app"

rm -rf "$TRABAJO" && mkdir -p "$APP" "$SALIDA/cache"

echo "== Compilando backend"
cd "$REPO/backend"
npm ci --no-audit --no-fund
npx prisma generate
npm run build
rm -rf "$TRABAJO/tools"
npx tsc -p tsconfig.json --outDir "$TRABAJO/tools" --incremental false --sourceMap false

echo "== Compilando frontend"
cd "$REPO/frontend"
npm ci --no-audit --no-fund
npm run build

echo "== Armando backend para Windows"
B="$APP/backend"
mkdir -p "$B/tools/prisma" "$B/tools/scripts" "$B/prisma"
cp -r "$REPO/backend/dist" "$B/dist"
find "$B/dist" -name '*.map' -delete
cp "$TRABAJO/tools/prisma/seed.js" "$B/tools/prisma/"
cp "$TRABAJO/tools/scripts/importar-sysvent.js" "$B/tools/scripts/"
cp "$REPO/backend/prisma/schema.prisma" "$B/prisma/"
cp -r "$REPO/backend/prisma/migrations" "$B/prisma/migrations"
cp "$REPO/backend/package.json" "$REPO/backend/package-lock.json" "$B/"
PRISMA_VERSION="$(node -p "require('$REPO/backend/node_modules/prisma/package.json').version")"
(
  cd "$B"
  # En la tienda solo hacen falta las dependencias de producción más el CLI
  # de Prisma (para migrate deploy).
  node -e "const f='package.json',p=require('./'+f);p.dependencies.prisma='$PRISMA_VERSION';delete p.devDependencies;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
  # Motores de Prisma para Windows además de los de esta máquina.
  LOCAL="$(basename "$(ls "$REPO"/backend/node_modules/@prisma/engines/schema-engine-* | head -1)" | sed 's/^schema-engine-//; s/\.exe$//')"
  export PRISMA_CLI_BINARY_TARGETS="windows,$LOCAL"
  npm install --omit=dev --no-audit --no-fund
  node node_modules/prisma/build/index.js generate
)
# En la tienda solo sirven los motores de Windows.
find "$B/node_modules" -type f \( -name '*debian*' -o -name '*linux*' -o -name '*darwin*' -o -name '*rhel*' \) \( -name 'libquery_engine-*' -o -name 'schema-engine-*' \) -delete
find "$B/node_modules" -name '*.map' -delete
for motor in "node_modules/@prisma/engines/schema-engine-windows.exe" "node_modules/.prisma/client/query_engine-windows.dll.node"; do
  [ -f "$B/$motor" ] || { echo "Falta el motor de Prisma para Windows: $motor" >&2; exit 1; }
done

mkdir -p "$APP/frontend"
cp -r "$REPO/frontend/dist" "$APP/frontend/dist"

echo "== Node $NODE_VERSION para Windows"
ZIP_NODE="$SALIDA/cache/node-$NODE_VERSION-win-x64.zip"
[ -f "$ZIP_NODE" ] || curl -fsSL -o "$ZIP_NODE" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
rm -rf "$TRABAJO/node" && mkdir -p "$TRABAJO/node"
unzip -q "$ZIP_NODE" -d "$TRABAJO/node"
mkdir -p "$APP/node"
NODE_WIN="$TRABAJO/node/node-$NODE_VERSION-win-x64"
cp "$NODE_WIN/node.exe" "$NODE_WIN/LICENSE" "$NODE_WIN/npm.cmd" "$NODE_WIN/npx.cmd" "$APP/node/"
# npm lo usa "Actualizar Candy's Market" para compilar lo que baja de GitHub.
mkdir -p "$APP/node/node_modules" && cp -r "$NODE_WIN/node_modules/npm" "$APP/node/node_modules/npm"

echo "== Scripts del instalador"
cp -r "$REPO/instalador/windows/scripts" "$PAQ/paquete/scripts"
cp "$REPO/instalador/windows/INSTALAR.bat" "$REPO/instalador/windows/ACTUALIZAR.bat" "$REPO/instalador/windows/LEEME.txt" "$PAQ/"
# Windows: fin de línea CRLF; PowerShell 5 necesita BOM para leer las tildes.
python3 - "$PAQ" <<'PY'
import pathlib, sys
for f in pathlib.Path(sys.argv[1]).rglob('*'):
    if f.suffix.lower() not in ('.ps1', '.bat', '.vbs', '.txt') or 'app' in f.parts:
        continue
    texto = f.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\n', '\r\n')
    if f.suffix.lower() in ('.ps1', '.txt'):
        f.write_bytes(b'\xef\xbb\xbf' + texto.encode('utf-8'))
    else:
        f.write_bytes(texto.encode('latin-1', errors='replace'))
PY
git -C "$REPO" rev-parse --short=7 HEAD > "$PAQ/paquete/version.txt"
# actualizar-github.ps1 la compara con la última de GitHub.
cp "$PAQ/paquete/version.txt" "$APP/version.txt"

echo "== Comprimiendo"
rm -f "$SALIDA/$NOMBRE.zip"
(cd "$TRABAJO" && zip -qr -9 "$SALIDA/$NOMBRE.zip" "$NOMBRE")
echo "Listo: $SALIDA/$NOMBRE.zip ($(du -h "$SALIDA/$NOMBRE.zip" | cut -f1))"
