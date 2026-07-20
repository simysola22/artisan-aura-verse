import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedError } from "../errors/index.js";

export interface AuthPayload extends JWTPayload {
  userId: string;
  role: "employer" | "provider" | "ops";
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthPayload;
  }
}

function getSecret(): Uint8Array {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

/**
 * Require a valid Bearer JWT on the request.
 * Sets c.var.auth = { userId, role, ...jwtClaims } on success.
 * Returns 401 on missing, malformed, or expired token.
 */
export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }
  const token = header.slice(7);
  try {
    const { payload } = await jwtVerify(token, getSecret());
    c.set("auth", payload as AuthPayload);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
  await next();
});

/**
 * Optionally attach auth if a valid token is present.
 * Does NOT throw on missing/invalid token — auth payload will be undefined.
 */
export const optionalAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    try {
      const { payload } = await jwtVerify(token, getSecret());
      c.set("auth", payload as AuthPayload);
    } catch {
      // not a valid token — continue unauthenticated
    }
  }
  await next();
});

/**
 * Require that the authenticated user has one of the allowed roles.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: Array<"employer" | "provider" | "ops">): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");
    if (!auth || !roles.includes(auth.role)) {
      throw new UnauthorizedError("Insufficient permissions");
    }
    await next();
  });
}
