/**
 * Employer profile route integration tests.
 *
 * Service layer is mocked so routes are tested in isolation from the DB.
 *
 * POST  /v1/employers/profile  — create
 * GET   /v1/employers/profile  — own profile
 * PATCH /v1/employers/profile  — update
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import { ConflictError, NotFoundError } from "../src/errors/index.js";

// ─── Mock service module ───────────────────────────────────────────────────────

vi.mock("../src/services/employer-profile.js", () => ({
  createEmployerProfile: vi.fn(),
  getEmployerProfileByUserId: vi.fn(),
  getEmployerProfileById: vi.fn(),
  updateEmployerProfile: vi.fn(),
  computeEmployerCompleteness: vi.fn(),
}));

import {
  createEmployerProfile,
  getEmployerProfileByUserId,
  updateEmployerProfile,
} from "../src/services/employer-profile.js";

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
  permissions: new Set(["profile.read", "profile.update", "providers.search"]),
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
  permissions: new Set(["profile.read", "profile.update"]),
};

const sampleProfile = {
  id: "emp_profile_1",
  userId: "pmp_employer_1",
  employerType: "individual",
  displayName: "Alice Employer",
  organizationName: null,
  industry: "Technology",
  description: "Hiring the best talent in Lagos",
  location: "Lagos",
  websiteUrl: null,
  logoUrl: null,
  isPublic: true,
  completenessScore: 80,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

// ─── App builder ───────────────────────────────────────────────────────────────

function makeApp(tokens: Map<string, string>, identities: Map<string, ResolvedIdentity | null>) {
  const clerkMap = new Map([...tokens.entries()].map(([tok, uid]) => [tok, { clerkUserId: uid }]));

  const idService: AuthIdentityService = {
    resolve: (id) => Promise.resolve(identities.get(id) ?? null),
    provision: async () => {
      throw new Error("unexpected");
    },
    updateProfile: async () => {},
  };

  return createApp({
    clerkAdapter: createMockClerkAdapter(clerkMap),
    identityService: idService,
    db: {} as unknown as import("../src/db/client.js").Db,
  });
}

const empTokens = new Map([["tok_emp", "user_clerk_employer"]]);
const empIdentities = new Map([["user_clerk_employer", employerIdentity]]);
const provTokens = new Map([["tok_prov", "user_clerk_provider"]]);
const provIdentities = new Map([["user_clerk_provider", providerIdentity]]);

// ─── Reset mocks ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createEmployerProfile).mockResolvedValue(sampleProfile);
  vi.mocked(getEmployerProfileByUserId).mockResolvedValue(sampleProfile);
  vi.mocked(updateEmployerProfile).mockResolvedValue({
    ...sampleProfile,
    displayName: "Alice Updated",
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /v1/employers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/employers/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a provider tries to create an employer profile", async () => {
    const app = makeApp(provTokens, provIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid websiteUrl", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 on successful creation", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice Employer", employerType: "individual" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { profile: typeof sampleProfile };
    expect(body.profile.id).toBe("emp_profile_1");
  });

  it("returns 409 when a profile already exists", async () => {
    vi.mocked(createEmployerProfile).mockRejectedValue(
      new ConflictError("An employer profile already exists for this account."),
    );
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /v1/employers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/employers/profile");
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider accounts", async () => {
    const app = makeApp(provTokens, provIdentities);
    const res = await app.request("/v1/employers/profile", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when no profile exists", async () => {
    vi.mocked(getEmployerProfileByUserId).mockResolvedValue(null);
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with profile data for authenticated employer", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: typeof sampleProfile };
    expect(body.profile.id).toBe("emp_profile_1");
    expect(body.profile.industry).toBe("Technology");
  });
});

describe("PATCH /v1/employers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider accounts", async () => {
    const app = makeApp(provTokens, provIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid employerType value", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ employerType: "corporation" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when no profile exists to update", async () => {
    vi.mocked(getEmployerProfileByUserId).mockResolvedValue(null);
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice Updated" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with the updated profile", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice Updated" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { displayName: string } };
    expect(body.profile.displayName).toBe("Alice Updated");
  });

  it("returns 400 for an invalid logoUrl", async () => {
    const app = makeApp(empTokens, empIdentities);
    const res = await app.request("/v1/employers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ logoUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });
});
