import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 * Attach a request ID to every request.
 *
 * Reads `x-request-id` from the incoming request (populated by a load
 * balancer or upstream proxy) and falls back to a generated UUID v4.
 * The same ID is echoed back in the `x-request-id` response header so
 * callers can trace requests end-to-end.
 */
export const requestIdMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const requestId = incoming ?? crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("x-request-id", requestId);
});
