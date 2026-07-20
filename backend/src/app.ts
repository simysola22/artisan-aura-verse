/**
 * Application factory.
 *
 * createApp() is called once at startup and also in tests (each test gets a
 * fresh app instance). No global state leaks between test cases.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { securityHeaders } from "./middleware/security.js";
import { rateLimit, type RateLimitStore, type RateLimitOptions } from "./middleware/rate-limit.js";
import { health } from "./routes/health.js";
import type { AppError } from "./errors/index.js";
import { logger } from "./lib/logger.js";

export interface AppOptions {
  corsOrigin?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  rateLimitStore?: RateLimitStore;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // ── Global middleware (order matters) ─────────────────────────────────────

  // 1. Request ID — must come first so all subsequent middleware can read it
  app.use("*", requestIdMiddleware);

  // 2. Security headers
  app.use("*", securityHeaders);

  // 3. CORS
  const origin = options.corsOrigin ?? process.env["CORS_ORIGIN"] ?? "http://localhost:5000";
  app.use(
    "*",
    cors({
      origin,
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
      credentials: true,
      maxAge: 86_400,
    }),
  );

  // 4. Rate limiting
  const rlOpts: RateLimitOptions = {
    windowMs: options.rateLimitWindowMs ?? Number(process.env["RATE_LIMIT_WINDOW_MS"] ?? 60_000),
    max: options.rateLimitMax ?? Number(process.env["RATE_LIMIT_MAX"] ?? 100),
  };
  if (options.rateLimitStore !== undefined) {
    rlOpts.store = options.rateLimitStore;
  }
  app.use("*", rateLimit(rlOpts));

  // 5. Request logging
  app.use("*", loggerMiddleware);

  // ── Routes ────────────────────────────────────────────────────────────────

  app.route("/", health);

  // API v1 prefix — future domain routes mount here
  // app.route("/v1", authRoutes);
  // app.route("/v1", providerRoutes);
  // etc.

  // ── 404 fallback ─────────────────────────────────────────────────────────

  app.notFound((c) =>
    c.json(
      {
        status: 404,
        code: "not_found",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404,
    ),
  );

  // ── Centralized error handler ──────────────────────────────────────────────

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";

    // Known application errors — return their own status + code
    if ("status" in err && "code" in err) {
      const appErr = err as AppError;
      if (appErr.status < 500) {
        logger.info(
          { requestId, err: { code: appErr.code, message: appErr.message } },
          "client error",
        );
      } else {
        logger.error({ requestId, err }, "application error");
      }
      return c.json(appErr.toBody(), appErr.status as ContentfulStatusCode);
    }

    // Unexpected errors — log the full stack, return a safe generic message
    logger.error({ requestId, err }, "unhandled error");
    return c.json(
      {
        status: 500,
        code: "internal_error",
        message: "An unexpected error occurred",
      },
      500,
    );
  });

  return app;
}
