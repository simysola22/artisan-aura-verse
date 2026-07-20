/**
 * Permission and authorization middleware tests.
 *
 * Verifies that requirePermission, requireAnyPermission, and requireAccountType
 * correctly allow/reject based on c.var.auth — not on any client-supplied value.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  requirePermission,
  requireAnyPermission,
  requireAccountType,
  type AuthContext,
} from "../src/middleware/auth.js";
import type { AppError } from "../src/errors/index.js";

// Helper: build an app that pre-loads a given auth context (simulates
// requireClerkAuth already having run), then applies the guard under test.
function makeApp(
  auth: AuthContext | null,
  guard: ReturnType<typeof requirePermission | typeof requireAnyPermission | typeof requireAccountType>,
) {
  const app = new Hono();

  // Must mirror createApp()'s error handler so AppError subclasses map to
  // their own HTTP status codes rather than Hono's default 500.
  app.onError((err, c) => {
    if ("status" in err && "code" in err) {
      const appErr = err as AppError;
      return c.json(appErr.toBody(), appErr.status as ContentfulStatusCode);
    }
    return c.json({ status: 500, code: "internal_error", message: "Unexpected error" }, 500);
  });

  // Inject the auth context directly (bypasses Clerk + DB)
  app.use("*", async (c, next) => {
    if (auth) c.set("auth", auth);
    await next();
  });

  app.get("/guarded", guard, (c) => c.json({ ok: true }));
  return app;
}

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    clerkUserId: "user_test",
    pmpUserId: "pmp_test",
    accountType: "employer",
    roleNames: ["employer"],
    permissions: new Set(["profile.read", "profile.update", "providers.search"]),
    ...overrides,
  };
}

// ─── requirePermission ────────────────────────────────────────────────────────

describe("requirePermission()", () => {
  it("allows request when user has the required permission", async () => {
    const app = makeApp(makeAuth(), requirePermission("profile.read"));
    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
  });

  it("returns 403 when user lacks the required permission", async () => {
    const app = makeApp(makeAuth(), requirePermission("verification.approve"));
    const res = await app.request("/guarded");
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("forbidden");
  });

  it("returns 401 when no auth context is attached", async () => {
    const app = makeApp(null, requirePermission("profile.read"));
    const res = await app.request("/guarded");
    expect(res.status).toBe(401);
  });

  it("a frontend-supplied role in the request body cannot elevate permissions", async () => {
    // The auth context is fixed at middleware time from the DB.
    // No matter what the client sends in the body, the permission check
    // uses only c.var.auth.permissions.
    const app = makeApp(
      makeAuth({ permissions: new Set(["profile.read"]) }),
      requirePermission("system.manage"),
    );
    // Simulate a client trying to inject a privileged role in the body
    const res = await app.request("/guarded", {
      method: "GET",
      headers: { "x-role": "owner", "x-permissions": "system.manage" },
    });
    expect(res.status).toBe(403);
  });

  it("a user cannot grant themselves system.manage by manipulating headers", async () => {
    const app = makeApp(
      makeAuth({ accountType: "employer", permissions: new Set(["profile.read"]) }),
      requirePermission("system.manage"),
    );
    const res = await app.request("/guarded");
    expect(res.status).toBe(403);
  });
});

// ─── requireAnyPermission ─────────────────────────────────────────────────────

describe("requireAnyPermission()", () => {
  it("allows when user has the first listed permission", async () => {
    const app = makeApp(
      makeAuth({ permissions: new Set(["verification.read"]) }),
      requireAnyPermission("verification.read", "verification.manage"),
    );
    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
  });

  it("allows when user has the second listed permission", async () => {
    const app = makeApp(
      makeAuth({ permissions: new Set(["verification.manage"]) }),
      requireAnyPermission("verification.read", "verification.manage"),
    );
    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
  });

  it("returns 403 when user has none of the listed permissions", async () => {
    const app = makeApp(
      makeAuth({ permissions: new Set(["profile.read"]) }),
      requireAnyPermission("verification.read", "verification.manage"),
    );
    const res = await app.request("/guarded");
    expect(res.status).toBe(403);
  });
});

// ─── requireAccountType ───────────────────────────────────────────────────────

describe("requireAccountType()", () => {
  it("allows matching account type", async () => {
    const app = makeApp(makeAuth({ accountType: "employer" }), requireAccountType("employer"));
    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
  });

  it("returns 403 for non-matching account type", async () => {
    const app = makeApp(makeAuth({ accountType: "employer" }), requireAccountType("provider"));
    const res = await app.request("/guarded");
    expect(res.status).toBe(403);
  });

  it("allows when account type is in the allowed list", async () => {
    const app = makeApp(
      makeAuth({ accountType: "verification_team" }),
      requireAccountType("verification_team", "system_admin", "owner"),
    );
    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
  });
});

// ─── Role-based permission isolation ──────────────────────────────────────────

describe("role-based permission isolation", () => {
  const employerPerms = new Set(["profile.read", "profile.update", "providers.search", "providers.view", "messaging.use"]);
  const providerPerms = new Set(["profile.read", "profile.update", "verification.submit", "messaging.use"]);
  const verificationPerms = new Set(["verification.read", "verification.review", "verification.request_info", "verification.approve", "verification.reject"]);
  const supportPerms = new Set(["support.read", "support.respond", "support.manage"]);
  const moderationPerms = new Set(["moderation.read", "moderation.review", "moderation.action"]);

  it("employer has providers.search permission", async () => {
    const app = makeApp(makeAuth({ accountType: "employer", permissions: employerPerms }), requirePermission("providers.search"));
    expect((await app.request("/guarded")).status).toBe(200);
  });

  it("employer does NOT have verification.review", async () => {
    const app = makeApp(makeAuth({ accountType: "employer", permissions: employerPerms }), requirePermission("verification.review"));
    expect((await app.request("/guarded")).status).toBe(403);
  });

  it("provider has verification.submit", async () => {
    const app = makeApp(makeAuth({ accountType: "provider", permissions: providerPerms }), requirePermission("verification.submit"));
    expect((await app.request("/guarded")).status).toBe(200);
  });

  it("provider does NOT have providers.search", async () => {
    const app = makeApp(makeAuth({ accountType: "provider", permissions: providerPerms }), requirePermission("providers.search"));
    expect((await app.request("/guarded")).status).toBe(403);
  });

  it("verification_team has verification.approve", async () => {
    const app = makeApp(makeAuth({ accountType: "verification_team", permissions: verificationPerms }), requirePermission("verification.approve"));
    expect((await app.request("/guarded")).status).toBe(200);
  });

  it("verification_team does NOT have support.manage", async () => {
    const app = makeApp(makeAuth({ accountType: "verification_team", permissions: verificationPerms }), requirePermission("support.manage"));
    expect((await app.request("/guarded")).status).toBe(403);
  });

  it("support_team cannot perform verification actions", async () => {
    const app = makeApp(makeAuth({ accountType: "support_team", permissions: supportPerms }), requirePermission("verification.approve"));
    expect((await app.request("/guarded")).status).toBe(403);
  });

  it("moderation_team has moderation.action", async () => {
    const app = makeApp(makeAuth({ accountType: "moderation_team", permissions: moderationPerms }), requirePermission("moderation.action"));
    expect((await app.request("/guarded")).status).toBe(200);
  });

  it("moderation_team does NOT have system.manage", async () => {
    const app = makeApp(makeAuth({ accountType: "moderation_team", permissions: moderationPerms }), requirePermission("system.manage"));
    expect((await app.request("/guarded")).status).toBe(403);
  });
});
