# Sistema de ventas en modo nube (Infosmart): una instalación para todas las empresas.
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app/backend
COPY backend/package*.json ./
# Se conservan las dependencias de desarrollo: el CLI de prisma aplica las
# migraciones de cada empresa la primera vez que entra.
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npx prisma generate && npm run build
COPY --from=frontend /app/dist /app/frontend/dist
ENV NODE_ENV=production FRONTEND_DIR=/app/frontend/dist PORT=3000 HTTPS_PORT=0 SUNAT_AUTOMATICO=1
EXPOSE 3000
CMD ["node", "dist/main.js"]
