import { Hono } from "hono";
import { checkDbHealth } from "../db/client.js";

const health = new Hono();

/**
 * GET /health — Liveness probe.
 *
 * Returns 200 as long as the process is running and can handle requests.
 * Does NOT check external dependencies (database, cache, etc.).
 * Use this for load-balancer or k8s liveness probes.
 */
health.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env["npm_package_version"] ?? "unknown",
    environment: process.env["NODE_ENV"] ?? "development",
  }),
);

/**
 * GET /ready — Readiness probe.
 *
 * Checks whether the service is ready to serve traffic by verifying that
 * all required external dependencies are reachable.
 *
 * Returns 200 when ready, 503 when not ready.
 * Use this for k8s readiness probes; do NOT use for liveness.
 */
health.get("/ready", async (c) => {
  const checks: Record<string, { status: "ok" | "error" | "unconfigured"; message?: string }> = {};

  // Database
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    checks["database"] = { status: "unconfigured", message: "DATABASE_URL not set" };
  } else {
    const dbOk = await checkDbHealth();
    checks["database"] = dbOk
      ? { status: "ok" }
      : { status: "error", message: "Connection failed" };
  }

  const allOk = Object.values(checks).every(
    (c) => c.status === "ok" || c.status === "unconfigured",
  );
  const hasError = Object.values(checks).some((c) => c.status === "error");

  return c.json(
    {
      status: hasError ? "not_ready" : "ready",
      checks,
      timestamp: new Date().toISOString(),
    },
    hasError ? 503 : 200,
  );
});

export { health };
