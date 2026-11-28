# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --workspace=@smile/shared --workspace=@smile/api --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DIRECT_URL="postgresql://build:build@localhost:5432/build" \
    npm run prisma:generate --workspace=@smile/api \
  && npm run build --workspace=@smile/shared \
  && npm run build --workspace=@smile/api

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
# Stay comfortably under Render Free 512 MB RAM ceiling
ENV NODE_OPTIONS="--max-old-space-size=384"

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --omit=dev --workspace=@smile/shared --workspace=@smile/api --include-workspace-root

COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma

USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
