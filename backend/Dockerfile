FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN npm run db:generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Render mounts secret files for group 1000. Keep the process unprivileged while
# allowing it to read the database CA and JWT PEM files at runtime.
RUN usermod -a -G 1000 node
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
