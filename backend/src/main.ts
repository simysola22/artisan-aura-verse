/**
 * Server entry point.
 *
 * Validates configuration, creates the Hono app, starts the Bun HTTP server,
 * and registers SIGTERM/SIGINT handlers for graceful shutdown.
 *
 * Graceful shutdown sequence:
 *   1. Stop accepting new requests (close server).
 *   2. Allow in-flight requests to finish (Bun handles this via server.stop()).
 *   3. Close the database connection pool.
 *   4. Close other external connections (cache, storage, email).
 *   5. Exit with code 0.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { getConfig } from "./config/index.js";
import { createApp } from "./app.js";
import { closeDb } from "./db/client.js";
import { logger } from "./lib/logger.js";

// ── Config validation (fails fast on bad environment) ─────────────────────

let config;
try {
  config = getConfig();
} catch (err) {
  // Use console here because pino may not have been initialized yet
  console.error("STARTUP FAILURE — invalid configuration:\n", (err as Error).message);
  process.exit(1);
}

// ── Run pending migrations before accepting requests ──────────────────────

if (config.DATABASE_URL) {
  const migrationsFolder = join(
    dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  logger.info({ migrationsFolder }, "Running database migrations");
  const migSql = postgres(config.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(migSql), { migrationsFolder });
    logger.info("Database migrations complete");
  } catch (err) {
    logger.error({ err }, "Database migration failed — startup aborted");
    await migSql.end();
    process.exit(1);
  }
  await migSql.end();
} else {
  logger.warn("DATABASE_URL not set — skipping migrations");
}

// ── App ───────────────────────────────────────────────────────────────────

const app = createApp({
  corsOrigin: config.CORS_ORIGIN,
  rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: config.RATE_LIMIT_MAX,
});

// ── Server ────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
});

logger.info({ host: config.HOST, port: config.PORT, env: config.NODE_ENV }, "PMP backend started");

// ── Graceful shutdown ─────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Shutdown signal received — starting graceful shutdown");

  try {
    // 1. Stop accepting new requests; let in-flight requests complete
    await server.stop(false);
    logger.info("HTTP server stopped");

    // 2. Close database pool
    await closeDb();

    // 3. TODO: close cache / storage / email once those are real drivers

    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
