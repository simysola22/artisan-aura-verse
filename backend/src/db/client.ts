import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";
import { logger } from "../lib/logger.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _sql: postgres.Sql | null = null;

/**
 * Return the singleton Drizzle client.
 * Throws if DATABASE_URL is not set — call this only when the database
 * is genuinely required (not in the liveness health check).
 */
export function getDb(): Db {
  if (!_db) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error("DATABASE_URL is not set. Configure a PostgreSQL connection string.");
    }
    _sql = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: (notice) => {
        logger.debug({ notice }, "postgres notice");
      },
    });
    _db = drizzle(_sql, { schema });
    logger.info("Database connection pool created");
  }
  return _db;
}

/**
 * Check whether the database is reachable.
 * Returns true on success, false on failure.
 */
export async function checkDbHealth(): Promise<boolean> {
  const url = process.env["DATABASE_URL"];
  if (!url) return false;
  try {
    const db = getDb();
    await db.execute("SELECT 1");
    return true;
  } catch (err) {
    logger.warn({ err }, "Database health check failed");
    return false;
  }
}

/**
 * Close the connection pool.
 * Called during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
    logger.info("Database connection pool closed");
  }
}
