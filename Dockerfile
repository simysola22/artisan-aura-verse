# syntax=docker/dockerfile:1

# ── Stage 1: deps ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app/backend
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile

# ── Stage 2: build (typecheck) ─────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/ .
# Typecheck only — Bun runs TypeScript directly so there's no transpile step
RUN bun run typecheck

# ── Stage 3: production image ──────────────────────────────────────────────
FROM oven/bun:1-slim AS production
WORKDIR /app/backend

# Run as non-root
RUN addgroup --system --gid 1001 pmp && \
    adduser  --system --uid 1001 --ingroup pmp pmp

COPY --from=deps  /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/src          ./src
COPY --from=build /app/backend/migrations   ./migrations
COPY             backend/package.json        ./

USER pmp

EXPOSE 3000

# Healthcheck — liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/main.ts"]
