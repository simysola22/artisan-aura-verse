/**
 * Provider profile route integration tests.
 *
 * We mock the service layer so routes are tested in isolation from the DB.
 * The service functions themselves are tested in profile-completeness.test.ts.
 *
 * Tests covered:
 *   - POST /v1/providers/profile             create
 *   - GET  /v1/providers/profile             own
 *   - PATCH /v1/providers/profile            update
 *   - POST /v1/providers/profile/experience
 *   - DELETE /v1/providers/profile/experience/:id
 *   - POST /v1/providers/profile/certifications
 *   - DELETE /v1/providers/profile/certifications/:id
 *   - POST /v1/providers/profile/portfolio
 *   - DELETE /v1/providers/profile/portfolio/:id
 *   - GET /v1/providers/:profileId           public
 *   - Auth enforcement (401/403)
 *   - Validation (400)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import { ConflictError, NotFoundError } from "../src/errors/index.js";

// ─── Mock service module ───────────────────────────────────────────────────────

vi.mock("../src/services/provider-profile.js", () => ({
  createProviderProfile: vi.fn(),
  getProviderProfileByUserId: vi.fn(),
  getProviderProfileById: vi.fn(),
  updateProviderProfile: vi.fn(),
  addExperience: vi.fn(),
  removeExperience: vi.fn(),
  addCertification: vi.fn(),
  removeCertification: vi.fn(),
  addPortfolioItem: vi.fn(),
  removePortfolioItem: vi.fn(),
  setSkills: vi.fn(),
  computeProviderCompleteness: vi.fn(),
}));

import {
  createProviderProfile,
  getProviderProfileByUserId,
  getProviderProfileById,
  updateProviderProfile,
  addExperience,
  removeExperience,
  addCertification,
  removeCertification,
  addPortfolioItem,
  removePortfolioItem,
} from "../src/services/provider-profile.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T00:00:00Z");

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
  permissions: new Set(["profile.read", "providers.search"]),
};

const sampleProfile = {
  id: "profile_1",
  userId: "pmp_provider_1",
  kind: "artisan",
  headline: "Senior Plumber",
  about: "10 years of experience",
  primaryCategory: { id: "cat_skilled_trades", name: "Skilled Trades", slug: "skilled-trades" },
  skills: [],
  experience: [],
  certifications: [],
  portfolio: [],
  location: "Lagos, Nigeria",
  serviceArea: "Lagos",
  availability: "available",
  yearsOfExperience: 10,
  hourlyRate: null,
  currency: "NGN",
  isPublic: true,
  completenessScore: 75,
  verificationStatus: "unverified",
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

  // Pass a stub DB — service functions are mocked so the DB is never called
  return createApp({
    clerkAdapter: createMockClerkAdapter(clerkMap),
    identityService: idService,
    db: {} as unknown as import("../src/db/client.js").Db,
  });
}

const providerTokens = new Map([["tok_prov", "user_clerk_provider"]]);
const providerIdentities = new Map([["user_clerk_provider", providerIdentity]]);
const employerTokens = new Map([["tok_emp", "user_clerk_employer"]]);
const employerIdentities = new Map([["user_clerk_employer", employerIdentity]]);

// ─── Reset mocks ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: profile exists
  vi.mocked(getProviderProfileByUserId).mockResolvedValue(sampleProfile);
  vi.mocked(getProviderProfileById).mockResolvedValue(sampleProfile);
  vi.mocked(createProviderProfile).mockResolvedValue(sampleProfile);
  vi.mocked(updateProviderProfile).mockResolvedValue({ ...sampleProfile, headline: "Updated" });
  vi.mocked(addExperience).mockResolvedValue({
    id: "exp_1",
    role: "Plumber",
    organization: "Lagos Pipes",
    startDate: "2020-01-01",
    endDate: null,
    description: null,
  });
  vi.mocked(removeExperience).mockResolvedValue(undefined);
  vi.mocked(addCertification).mockResolvedValue({
    id: "cert_1",
    name: "Certified Plumber",
    issuer: "NiPlumbers",
    issuedAt: "2020-06-01",
    expiresAt: null,
    evidenceUrl: null,
  });
  vi.mocked(removeCertification).mockResolvedValue(undefined);
  vi.mocked(addPortfolioItem).mockResolvedValue({
    id: "port_1",
    title: "Kitchen renovation",
    description: null,
    mediaUrl: "https://example.com/img.jpg",
    mediaType: "image",
    displayOrder: 0,
    createdAt: now.toISOString(),
  });
  vi.mocked(removePortfolioItem).mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /v1/providers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "artisan" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when an employer calls this endpoint", async () => {
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ kind: "artisan" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid kind value", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ kind: "wizard" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 on successful creation", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ kind: "artisan", headline: "Senior Plumber" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { profile: typeof sampleProfile };
    expect(body.profile.id).toBe("profile_1");
  });

  it("returns 409 when a profile already exists", async () => {
    vi.mocked(createProviderProfile).mockRejectedValue(
      new ConflictError("A provider profile already exists for this account."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ kind: "artisan" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /v1/providers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile");
    expect(res.status).toBe(401);
  });

  it("returns 403 for employer accounts", async () => {
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/providers/profile", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when provider has no profile yet", async () => {
    vi.mocked(getProviderProfileByUserId).mockResolvedValue(null);
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with profile data", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: typeof sampleProfile };
    expect(body.profile.id).toBe("profile_1");
    expect(body.profile.kind).toBe("artisan");
  });
});

describe("PATCH /v1/providers/profile", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headline: "New" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for employer accounts", async () => {
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ headline: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when provider has no profile", async () => {
    vi.mocked(getProviderProfileByUserId).mockResolvedValue(null);
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ headline: "Updated" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with updated profile", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile", {
      method: "PATCH",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ headline: "Updated Plumber" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { headline: string } };
    expect(body.profile.headline).toBe("Updated");
  });
});

describe("POST /v1/providers/profile/experience", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile/experience", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "Plumber", organization: "Acme", startDate: "2020-01-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid date format", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/experience", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ role: "Plumber", organization: "Acme", startDate: "Jan 2020" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 on valid experience entry", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/experience", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({
        role: "Plumber",
        organization: "Lagos Pipes",
        startDate: "2020-01-01",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { experience: { id: string } };
    expect(body.experience.id).toBe("exp_1");
  });
});

describe("DELETE /v1/providers/profile/experience/:id", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile/experience/exp_1", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("returns 204 on successful removal", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/experience/exp_1", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 when entry does not belong to profile", async () => {
    vi.mocked(removeExperience).mockRejectedValue(new NotFoundError("Experience entry"));
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/experience/exp_other", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/providers/profile/certifications", () => {
  it("returns 400 for invalid evidenceUrl", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/certifications", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({
        name: "Cert",
        issuer: "NiPlumbers",
        issuedAt: "2020-06-01",
        evidenceUrl: "not-a-url",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 on valid certification", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/certifications", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({
        name: "Certified Plumber",
        issuer: "NiPlumbers",
        issuedAt: "2020-06-01",
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("DELETE /v1/providers/profile/certifications/:id", () => {
  it("returns 204 on successful removal", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/certifications/cert_1", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 when cert does not belong to profile", async () => {
    vi.mocked(removeCertification).mockRejectedValue(new NotFoundError("Certification"));
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/certifications/cert_other", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/providers/profile/portfolio", () => {
  it("returns 400 for invalid mediaUrl", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/portfolio", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ title: "Work", mediaUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 on valid portfolio item", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/portfolio", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({
        title: "Kitchen renovation",
        mediaUrl: "https://example.com/img.jpg",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    expect(body.item.id).toBe("port_1");
  });
});

describe("DELETE /v1/providers/profile/portfolio/:id", () => {
  it("returns 204 on successful removal", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/portfolio/port_1", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 when item does not belong to profile", async () => {
    vi.mocked(removePortfolioItem).mockRejectedValue(new NotFoundError("Portfolio item"));
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile/portfolio/port_other", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/providers/:profileId", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/providers/profile_1");
    expect(res.status).toBe(401);
  });

  it("returns 200 for a public profile (requester is different user)", async () => {
    // Employer is fetching a provider's public profile
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/providers/profile_1", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 for a private profile viewed by a non-owner", async () => {
    vi.mocked(getProviderProfileById).mockResolvedValue({
      ...sampleProfile,
      isPublic: false,
      userId: "pmp_someone_else",
    });
    // employer (pmp_employer_1) tries to view private profile owned by pmp_someone_else
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/providers/profile_1", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 for owner viewing their own private profile", async () => {
    vi.mocked(getProviderProfileById).mockResolvedValue({
      ...sampleProfile,
      isPublic: false,
      userId: "pmp_provider_1",
    });
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when profile does not exist", async () => {
    vi.mocked(getProviderProfileById).mockResolvedValue(null);
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/providers/profile_missing", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });
});
