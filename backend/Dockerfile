# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run db:generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=web /web/dist ./web
# The official Node image creates the unprivileged node user in group 1000,
# which can read Render's runtime secret files.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
