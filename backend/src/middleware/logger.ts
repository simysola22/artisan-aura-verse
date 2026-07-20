import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger.js";

/**
 * HTTP request/response logger middleware.
 *
 * Logs:
 *   - request: method, path, request-id
 *   - response: method, path, status, duration_ms, request-id
 *
 * Passwords and authorization headers are never logged — pino's
 * `redact` config in logger.ts handles that automatically.
 */
export const loggerMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  const start = Date.now();
  const requestId = c.get("requestId") ?? "unknown";

  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
    },
    "→ request",
  );

  await next();

  const durationMs = Date.now() - start;
  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    },
    "← response",
  );
});
