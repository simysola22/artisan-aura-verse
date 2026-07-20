import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

/**
 * Security headers middleware.
 *
 * Adds defence-in-depth headers to all responses. These are a baseline and
 * should be reviewed / tightened as the application matures.
 */
export const securityHeaders: MiddlewareHandler = createMiddleware(async (c, next) => {
  await next();

  // Prevent MIME-type sniffing
  c.header("x-content-type-options", "nosniff");

  // Don't embed the API in an iframe
  c.header("x-frame-options", "DENY");

  // Disable legacy XSS auditor (CSP is the modern replacement)
  c.header("x-xss-protection", "0");

  // Force HTTPS in production
  if (process.env["NODE_ENV"] === "production") {
    c.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }

  // Restrict referrer information
  c.header("referrer-policy", "strict-origin-when-cross-origin");

  // Limit browser feature usage (restrictive baseline)
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");

  // Remove the server fingerprint
  c.header("server", "");
});
