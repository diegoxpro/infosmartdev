FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Caddy sirve el panel y reenvía /api al backend
FROM caddy:2.10-alpine
COPY --from=build /app/dist /srv/panel
COPY Caddyfile /etc/caddy/Caddyfile
