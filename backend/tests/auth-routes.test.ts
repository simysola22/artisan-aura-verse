/**
 * Auth route integration tests — GET /v1/auth/me and POST /v1/auth/sync.
 *
 * Uses createApp() with injected mock Clerk adapter and mock identity service.
 * No real DB or live Clerk service is called.
 */
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import { serializeIdentity } from "../src/services/identity.js";
import { ForbiddenError } from "../src/errors/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T00:00:00Z");

const employerIdentity: ResolvedIdentity = {
  user: {
    id: "pmp_employer_1",
    clerkUserId: "user_clerk_employer",
    accountType: "employer",
    providerKind: null,
    status: "active",
    displayName: "Alice Employer",
    email: "alice@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  roleNames: ["employer"],
  permissions: new Set([
    "profile.read",
    "profile.update",
    "providers.search",
    "providers.view",
    "messaging.use",
  ]),
};

const providerIdentity: ResolvedIdentity = {
  user: {
    id: "pmp_provider_1",
    clerkUserId: "user_clerk_provider",
    accountType: "provider",
    providerKind: "artisan",
    status: "active",
    displayName: "Bob Artisan",
    email: "bob@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  roleNames: ["provider"],
  permissions: new Set(["profile.read", "profile.update", "verification.submit", "messaging.use"]),
};

const systemAdminIdentity: ResolvedIdentity = {
  user: {
    id: "pmp_admin_1",
    clerkUserId: "user_clerk_admin",
    accountType: "system_admin",
    providerKind: null,
    status: "active",
    displayName: "Admin User",
    email: "admin@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  roleNames: ["system_admin"],
  permissions: new Set([
    "users.read",
    "users.manage",
    "verification.manage",
    "support.manage",
    "moderation.manage",
    "system.manage",
  ]),
};

const ownerIdentity: ResolvedIdentity = {
  user: {
    id: "pmp_owner_1",
    clerkUserId: "user_clerk_owner",
    accountType: "owner",
    providerKind: null,
    status: "active",
    displayName: "Platform Owner",
    email: "owner@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  roleNames: ["owner"],
  permissions: new Set([
    "profile.read",
    "users.manage",
    "system.manage",
    "verification.manage",
    "moderation.manage",
  ]),
};

// ─── App builder ──────────────────────────────────────────────────────────────

/**
 * Build a test app with:
 *   - tokens map: Bearer token → Clerk user ID (or Error to simulate rejection)
 *   - identities map: Clerk user ID → ResolvedIdentity (or null = not provisioned)
 *   - newUser: identity to return when provisionUser is called (optional)
 */
function makeTestApp(
  tokens: Map<string, string | Error>,
  identities: Map<string, ResolvedIdentity | null>,
  opts: {
    newUser?: ResolvedIdentity;
    provisionShouldFail?: Error;
  } = {},
) {
  const clerkMap = new Map<string, { clerkUserId: string } | Error>();
  for (const [token, v] of tokens.entries()) {
    clerkMap.set(token, v instanceof Error ? v : { clerkUserId: v });
  }

  const service: AuthIdentityService = {
    resolve: (clerkUserId) => Promise.resolve(identities.get(clerkUserId) ?? null),
    provision: (params) => {
      if (opts.provisionShouldFail) return Promise.reject(opts.provisionShouldFail);
      if (opts.newUser) return Promise.resolve(opts.newUser);
      throw new Error("Unexpected provision call");
    },
    updateProfile: () => Promise.resolve(),
    correctAccountType: () => Promise.resolve(),
  };

  return createApp({
    clerkAdapter: createMockClerkAdapter(clerkMap),
    identityService: service,
  });
}

// ─── GET /v1/auth/me ──────────────────────────────────────────────────────────

describe("GET /v1/auth/me", () => {
  it("returns 401 without Authorization header", async () => {
    const app = makeTestApp(new Map(), new Map());
    const res = await app.request("/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid Clerk token", async () => {
    const app = makeTestApp(new Map([["bad", new Error("invalid")]]), new Map());
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer bad" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Clerk token is valid but no PMP account exists (sync required)", async () => {
    const app = makeTestApp(
      new Map([["token_unknown", "user_unknown"]]),
      new Map([["user_unknown", null]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_unknown" },
    });
    expect(res.status).toBe(401);
  });

  it("returns employer user with correct account type and permissions", async () => {
    const app = makeTestApp(
      new Map([["token_employer", "user_clerk_employer"]]),
      new Map([["user_clerk_employer", employerIdentity]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_employer" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["user"] as Record<string, unknown>)?.["accountType"]).toBe("employer");
    expect(body["roles"]).toEqual(["employer"]);
    const perms = body["permissions"] as string[];
    expect(perms).toContain("providers.search");
    expect(perms).toContain("messaging.use");
    // employer does NOT have internal permissions
    expect(perms).not.toContain("verification.approve");
    expect(perms).not.toContain("system.manage");
  });

  it("returns provider user with correct account type and permissions", async () => {
    const app = makeTestApp(
      new Map([["token_provider", "user_clerk_provider"]]),
      new Map([["user_clerk_provider", providerIdentity]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_provider" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["user"] as Record<string, unknown>)?.["accountType"]).toBe("provider");
    const perms = body["permissions"] as string[];
    expect(perms).toContain("verification.submit");
    // provider does NOT have providers.search
    expect(perms).not.toContain("providers.search");
  });

  it("returns system_admin with correct permissions", async () => {
    const app = makeTestApp(
      new Map([["token_admin", "user_clerk_admin"]]),
      new Map([["user_clerk_admin", systemAdminIdentity]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_admin" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const perms = body["permissions"] as string[];
    expect(perms).toContain("system.manage");
    expect(perms).toContain("users.manage");
  });

  it("returns owner with expected permissions", async () => {
    const app = makeTestApp(
      new Map([["token_owner", "user_clerk_owner"]]),
      new Map([["user_clerk_owner", ownerIdentity]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_owner" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const perms = body["permissions"] as string[];
    expect(perms).toContain("system.manage");
  });

  it("public user (employer) cannot access internal permissions", async () => {
    const app = makeTestApp(
      new Map([["token_employer", "user_clerk_employer"]]),
      new Map([["user_clerk_employer", employerIdentity]]),
    );
    const res = await app.request("/v1/auth/me", {
      headers: { authorization: "Bearer token_employer" },
    });
    const perms = ((await res.json()) as Record<string, unknown>)["permissions"] as string[];
    const internalPerms = [
      "verification.approve",
      "users.manage",
      "system.manage",
      "moderation.action",
    ];
    for (const p of internalPerms) {
      expect(perms).not.toContain(p);
    }
  });
});

// ─── POST /v1/auth/sync ───────────────────────────────────────────────────────

describe("POST /v1/auth/sync", () => {
  it("returns 401 without Authorization header", async () => {
    const app = makeTestApp(new Map(), new Map());
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountType: "employer" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 201 and creates an employer account on first sync", async () => {
    const app = makeTestApp(
      new Map([["token_new", "user_clerk_new"]]),
      new Map([["user_clerk_new", null]]), // not yet provisioned
      { newUser: employerIdentity },
    );
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_new", "content-type": "application/json" },
      body: JSON.stringify({ accountType: "employer", displayName: "New User" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["user"] as Record<string, unknown>)?.["accountType"]).toBe("employer");
  });

  it("returns 201 and creates a provider account with providerKind", async () => {
    const app = makeTestApp(
      new Map([["token_prov", "user_clerk_newprov"]]),
      new Map([["user_clerk_newprov", null]]),
      { newUser: providerIdentity },
    );
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_prov", "content-type": "application/json" },
      body: JSON.stringify({
        accountType: "provider",
        providerKind: "artisan",
        displayName: "Bob",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["user"] as Record<string, unknown>)?.["accountType"]).toBe("provider");
  });

  it("returns 200 (idempotent) when PMP account already exists", async () => {
    const app = makeTestApp(
      new Map([["token_existing", "user_clerk_employer"]]),
      new Map([["user_clerk_employer", employerIdentity]]),
    );
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_existing", "content-type": "application/json" },
      body: JSON.stringify({ accountType: "employer" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for an invalid accountType value", async () => {
    const app = makeTestApp(
      new Map([["token_new", "user_clerk_bad"]]),
      new Map([["user_clerk_bad", null]]),
    );
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_new", "content-type": "application/json" },
      body: JSON.stringify({ accountType: "wizard" }),
    });
    expect(res.status).toBe(400);
  });

  it("cannot provision an internal account type via the public API", async () => {
    // The Zod schema only accepts "employer" | "provider".
    // Sending "owner" is rejected at the schema validation layer.
    const app = makeTestApp(
      new Map([["token_new", "user_clerk_evil"]]),
      new Map([["user_clerk_evil", null]]),
    );
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_new", "content-type": "application/json" },
      body: JSON.stringify({ accountType: "owner" }),
    });
    // Schema rejects "owner" → 400
    expect(res.status).toBe(400);
  });

  it("returns 403 if provisionUser service rejects with ForbiddenError", async () => {
    const app = makeTestApp(
      new Map([["token_new", "user_clerk_evil2"]]),
      new Map([["user_clerk_evil2", null]]),
      { provisionShouldFail: new ForbiddenError("Cannot self-assign an internal account type.") },
    );
    // Use a valid body that passes schema (but fails at service layer)
    const res = await app.request("/v1/auth/sync", {
      method: "POST",
      headers: { authorization: "Bearer token_new", "content-type": "application/json" },
      body: JSON.stringify({ accountType: "employer" }),
    });
    expect(res.status).toBe(403);
  });
});
