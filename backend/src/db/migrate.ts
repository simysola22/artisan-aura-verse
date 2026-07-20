/**
 * Migration runner.
 *
 * Run with:  bun run db:migrate
 *
 * Applies all pending SQL migrations from ./migrations in order.
 * Uses Drizzle's built-in migrator so migration state is tracked in the
 * `__drizzle_migrations` table.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

console.log("Running migrations from:", migrationsFolder);

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
