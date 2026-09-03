# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app

# Instala dependencias primero (mejor cache) copiando solo los package.json.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/database/package.json packages/database/package.json
COPY packages/services/package.json packages/services/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN pnpm install --frozen-lockfile

# Genera el cliente de Prisma y compila los tres paquetes en orden.
FROM deps AS build
COPY . .
# Valor placeholder: `prisma generate` solo necesita que la variable exista,
# no una base de datos real. El valor real llega en runtime vía docker-compose.
ARG DATABASE_URL=postgresql://user:password@localhost:5432/db
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm --filter @energy-bot/database db:generate
RUN pnpm build

# Imagen final: corre las migraciones y levanta el bot.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chown -R node:node /app && chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/bot
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "cd /app/packages/database && node_modules/.bin/prisma migrate deploy && cd /app/apps/bot && node dist/index.js"]
