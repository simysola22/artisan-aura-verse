/**
 * Clerk authentication middleware tests.
 *
 * Uses MockClerkAdapter + in-memory UserResolver — no live Clerk service,
 * no database queries.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import { requireClerkAuth, optionalClerkAuth, type UserResolver } from "../src/middleware/auth.js";
import type { AppError } from "../src/errors/index.js";
import type { ResolvedIdentity } from "../src/services/identity.js";

// ─── Shared test identity ─────────────────────────────────────────────────────

function makeIdentity(clerkUserId: string, accountType = "employer"): ResolvedIdentity {
  return {
    user: {
      id: `pmp_${clerkUserId}`,
      clerkUserId,
      accountType: accountType as ResolvedIdentity["user"]["accountType"],
      providerKind: null,
      status: "active",
      displayName: "Test User",
      email: "test@example.com",
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    roleNames: [accountType],
    permissions: new Set(["profile.read"]),
  };
}

// ─── App builder ──────────────────────────────────────────────────────────────

function makeApp(
  tokens: Map<string, string | Error>, // token → clerkUserId or Error
  identities: Map<string, ResolvedIdentity | null>, // clerkUserId → identity or null
  optional = false,
) {
  const clerkMap = new Map<string, { clerkUserId: string } | Error>();
  for (const [token, v] of tokens.entries()) {
    clerkMap.set(token, v instanceof Error ? v : { clerkUserId: v });
  }
  const adapter = createMockClerkAdapter(clerkMap);

  const resolver: UserResolver = (id) => Promise.resolve(identities.get(id) ?? null);

  const app = new Hono();

  // Mirror createApp()'s error handler so AppError maps to its own status
  app.onError((err, c) => {
    if ("status" in err && "code" in err) {
      const e = err as AppError;
      return c.json(e.toBody(), e.status as ContentfulStatusCode);
    }
    return c.json({ status: 500, code: "internal_error", message: "unexpected" }, 500);
  });

  app.use(
    "*",
    optional ? optionalClerkAuth(adapter, resolver) : requireClerkAuth(adapter, resolver),
  );
  app.get("/protected", (c) => {
    const auth = c.get("auth");
    return c.json({
      ok: true,
      pmpUserId: auth?.pmpUserId ?? null,
      accountType: auth?.accountType ?? null,
    });
  });

  return app;
}

// ─── requireClerkAuth ─────────────────────────────────────────────────────────

describe("requireClerkAuth middleware", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("unauthorized");
  });

  it("returns 401 when Authorization is not Bearer", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/protected", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Clerk rejects the token", async () => {
    const app = makeApp(new Map([["bad-token", new Error("Invalid signature")]]), new Map());
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("unauthorized");
  });

  it("returns 401 when Clerk token is valid but no PMP user exists", async () => {
    const app = makeApp(
      new Map([["valid-token", "user_unknown"]]),
      new Map([["user_unknown", null]]), // null = not provisioned
    );
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("unauthorized");
  });

  it("attaches auth context when token is valid and PMP user exists", async () => {
    const identity = makeIdentity("user_abc", "employer");
    const app = makeApp(new Map([["valid-token", "user_abc"]]), new Map([["user_abc", identity]]));
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["pmpUserId"]).toBe("pmp_user_abc");
    expect(body["accountType"]).toBe("employer");
  });

  it("attaches correct context for a provider account", async () => {
    const identity = makeIdentity("user_prov", "provider");
    const app = makeApp(new Map([["prov-token", "user_prov"]]), new Map([["user_prov", identity]]));
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer prov-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["accountType"]).toBe("provider");
  });
});

// ─── optionalClerkAuth ────────────────────────────────────────────────────────

describe("optionalClerkAuth middleware", () => {
  it("continues without auth when no header is present", async () => {
    const app = makeApp(new Map(), new Map(), true);
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["pmpUserId"]).toBeNull();
  });

  it("continues without auth when token is invalid", async () => {
    const app = makeApp(new Map([["bad", new Error("bad")]]), new Map(), true);
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer bad" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["pmpUserId"]).toBeNull();
  });
});
