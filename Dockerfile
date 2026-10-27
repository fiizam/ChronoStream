# Stage 1: Dependency installation
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

# Stage 2: Production runner
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy installed production dependencies and source files
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

# Set non-root user for security
USER bun

# Health check to ensure the engine and Redis are healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 3000

ENTRYPOINT ["bun", "src/index.ts"]
