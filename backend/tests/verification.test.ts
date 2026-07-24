/**
 * Verification system tests — Stage 4.
 *
 * Two layers tested:
 *
 * 1. State machine unit tests (ALLOWED_TRANSITIONS + isValidTransition)
 *    — pure functions, no DB required.
 *
 * 2. Route integration tests using the same mock-injection pattern as
 *    provider-profile.test.ts: service functions are vi.mock'd, so routes
 *    are tested in isolation from the database.
 *
 * Tests covered:
 *   State machine
 *     - All valid transitions
 *     - Invalid transitions rejected
 *     - Terminal states have no outgoing transitions
 *
 *   Provider endpoints
 *     - POST /v1/verification/cases                          create
 *     - GET  /v1/verification/cases                          own list
 *     - GET  /v1/verification/cases/:id                      own by id
 *     - POST /v1/verification/cases/:id/submit               submit
 *     - POST /v1/verification/cases/:id/evidence             add evidence
 *     - DELETE /v1/verification/cases/:id/evidence/:eid      remove evidence
 *     - POST /v1/verification/cases/:id/resubmit             resubmit
 *     - Auth enforcement (401 without token, 403 for wrong account type)
 *     - Permission enforcement (403 without verification.submit)
 *     - Ownership enforcement (403 / NotFoundError when not owner)
 *
 *   Reviewer (admin) endpoints
 *     - GET  /v1/verification/admin/cases                    list
 *     - GET  /v1/verification/admin/cases/:id                view
 *     - POST /v1/verification/admin/cases/:id/claim          claim
 *     - POST /v1/verification/admin/cases/:id/notes          add note
 *     - POST /v1/verification/admin/cases/:id/request-info   request info
 *     - POST /v1/verification/admin/cases/:id/approve        approve
 *     - POST /v1/verification/admin/cases/:id/reject         reject
 *     - POST /v1/verification/admin/cases/:id/escalate       escalate
 *     - Auth + permission enforcement on each reviewer action
 *     - Internal notes never present in provider-facing responses
 *
 *   Audit trail
 *     - Audit entries present in reviewer DTO
 *     - Audit entries absent from provider DTO
 *
 *   Public verification status behaviour
 *     - Provider profile status does not leak internal case details
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import { ALLOWED_TRANSITIONS, isValidTransition } from "../src/services/verification.js";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from "../src/errors/index.js";

// ─── Mock service module ───────────────────────────────────────────────────────

vi.mock("../src/services/verification.js", async (importOriginal) => {
  // Keep the pure state-machine exports — we test those directly.
  const original = await importOriginal<typeof import("../src/services/verification.js")>();
  return {
    ...original,
    createVerificationCase: vi.fn(),
    getOwnCases: vi.fn(),
    getOwnCaseById: vi.fn(),
    submitCase: vi.fn(),
    addEvidence: vi.fn(),
    removeEvidence: vi.fn(),
    resubmitCase: vi.fn(),
    listCases: vi.fn(),
    getCaseForReviewer: vi.fn(),
    claimCase: vi.fn(),
    addNote: vi.fn(),
    requestInfo: vi.fn(),
    approveCase: vi.fn(),
    rejectCase: vi.fn(),
    escalateCase: vi.fn(),
  };
});

// Also mock provider-profile service so getProviderProfileByUserId is injectable
vi.mock("../src/services/provider-profile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/provider-profile.js")>();
  return {
    ...original,
    getProviderProfileByUserId: vi.fn(),
    createProviderProfile: vi.fn(),
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
  };
});

import {
  createVerificationCase,
  getOwnCases,
  getOwnCaseById,
  submitCase,
  addEvidence,
  removeEvidence,
  resubmitCase,
  listCases,
  getCaseForReviewer,
  claimCase,
  addNote,
  requestInfo,
  approveCase,
  rejectCase,
  escalateCase,
} from "../src/services/verification.js";

import { getProviderProfileByUserId } from "../src/services/provider-profile.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T00:00:00Z");

function makeUser(overrides: Partial<ResolvedIdentity["user"]> = {}): ResolvedIdentity["user"] {
  return {
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
    ...overrides,
  };
}

const providerIdentity: ResolvedIdentity = {
  user: makeUser(),
  roleNames: ["provider"],
  permissions: new Set(["profile.read", "profile.update", "verification.submit"]),
};

const employerIdentity: ResolvedIdentity = {
  user: makeUser({
    id: "pmp_employer_1",
    clerkUserId: "user_clerk_employer",
    accountType: "employer",
    providerKind: null,
  }),
  roleNames: ["employer"],
  permissions: new Set(["profile.read", "profile.update", "providers.search"]),
};

const reviewerIdentity: ResolvedIdentity = {
  user: makeUser({
    id: "pmp_reviewer_1",
    clerkUserId: "user_clerk_reviewer",
    accountType: "verification_team",
    providerKind: null,
  }),
  roleNames: ["verification_team"],
  permissions: new Set([
    "verification.read",
    "verification.review",
    "verification.request_info",
    "verification.approve",
    "verification.reject",
  ]),
};

const sampleProviderProfile = {
  id: "profile_1",
  userId: "pmp_provider_1",
  displayName: "Bob Artisan",
  kind: "artisan",
  headline: "Senior Plumber",
  about: null,
  primaryCategory: null,
  skills: [],
  experience: [],
  certifications: [],
  portfolio: [],
  location: null,
  serviceArea: null,
  availability: "available",
  yearsOfExperience: null,
  hourlyRate: null,
  currency: "NGN",
  isPublic: true,
  completenessScore: 40,
  verificationStatus: "unverified",
  verification: "unverified",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const sampleCase = {
  id: "case_1",
  providerProfileId: "profile_1",
  status: "draft",
  verificationType: "artisan",
  infoRequestMessage: null,
  providerResponse: null,
  decisionReason: null,
  evidence: [],
  submittedAt: null,
  decidedAt: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const sampleReviewerCase = {
  ...sampleCase,
  userId: "pmp_provider_1",
  claimedBy: null,
  claimedAt: null,
  notes: [],
  auditLog: [
    {
      id: "audit_1",
      actorId: "pmp_provider_1",
      action: "case_created",
      fromStatus: null,
      toStatus: "draft",
      metadata: null,
      createdAt: now.toISOString(),
    },
  ],
};

const sampleEvidence = {
  id: "evidence_1",
  evidenceType: "certificate",
  label: "City & Guilds Plumbing Level 3",
  fileUrl: "https://storage.example.com/verif/case_1/evidence_1.pdf",
  mimeType: "application/pdf",
  createdAt: now.toISOString(),
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
    correctAccountType: async () => {},
  };
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

const reviewerTokens = new Map([["tok_rev", "user_clerk_reviewer"]]);
const reviewerIdentities = new Map([["user_clerk_reviewer", reviewerIdentity]]);

// ─── Reset mocks ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default provider profile mock
  vi.mocked(getProviderProfileByUserId).mockResolvedValue(sampleProviderProfile);

  // Default service mocks
  vi.mocked(createVerificationCase).mockResolvedValue(sampleCase);
  vi.mocked(getOwnCases).mockResolvedValue([sampleCase]);
  vi.mocked(getOwnCaseById).mockResolvedValue(sampleCase);
  vi.mocked(submitCase).mockResolvedValue({ ...sampleCase, status: "submitted" });
  vi.mocked(addEvidence).mockResolvedValue(sampleEvidence);
  vi.mocked(removeEvidence).mockResolvedValue(undefined);
  vi.mocked(resubmitCase).mockResolvedValue({ ...sampleCase, status: "resubmitted" });
  vi.mocked(listCases).mockResolvedValue([sampleReviewerCase]);
  vi.mocked(getCaseForReviewer).mockResolvedValue(sampleReviewerCase);
  vi.mocked(claimCase).mockResolvedValue({
    ...sampleReviewerCase,
    status: "under_review",
    claimedBy: "pmp_reviewer_1",
  });
  vi.mocked(addNote).mockResolvedValue({
    id: "note_1",
    reviewerId: "pmp_reviewer_1",
    content: "Looks good",
    createdAt: now.toISOString(),
  });
  vi.mocked(requestInfo).mockResolvedValue({
    ...sampleReviewerCase,
    status: "info_requested",
    infoRequestMessage: "Please provide your certificate.",
  });
  vi.mocked(approveCase).mockResolvedValue({
    ...sampleReviewerCase,
    status: "approved",
    decidedAt: now.toISOString(),
  });
  vi.mocked(rejectCase).mockResolvedValue({
    ...sampleReviewerCase,
    status: "rejected",
    decidedAt: now.toISOString(),
    decisionReason: "Insufficient evidence",
  });
  vi.mocked(escalateCase).mockResolvedValue({ ...sampleReviewerCase, status: "escalated" });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. State machine unit tests
// ═════════════════════════════════════════════════════════════════════════════

describe("ALLOWED_TRANSITIONS — state machine", () => {
  it("draft → submitted is valid", () => {
    expect(isValidTransition("draft", "submitted")).toBe(true);
  });

  it("submitted → under_review is valid", () => {
    expect(isValidTransition("submitted", "under_review")).toBe(true);
  });

  it("under_review → info_requested is valid", () => {
    expect(isValidTransition("under_review", "info_requested")).toBe(true);
  });

  it("under_review → approved is valid", () => {
    expect(isValidTransition("under_review", "approved")).toBe(true);
  });

  it("under_review → rejected is valid", () => {
    expect(isValidTransition("under_review", "rejected")).toBe(true);
  });

  it("under_review → escalated is valid", () => {
    expect(isValidTransition("under_review", "escalated")).toBe(true);
  });

  it("info_requested → resubmitted is valid", () => {
    expect(isValidTransition("info_requested", "resubmitted")).toBe(true);
  });

  it("resubmitted → under_review is valid", () => {
    expect(isValidTransition("resubmitted", "under_review")).toBe(true);
  });

  it("escalated → approved is valid", () => {
    expect(isValidTransition("escalated", "approved")).toBe(true);
  });

  it("escalated → rejected is valid", () => {
    expect(isValidTransition("escalated", "rejected")).toBe(true);
  });

  it("draft → approved is invalid", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
  });

  it("draft → under_review is invalid", () => {
    expect(isValidTransition("draft", "under_review")).toBe(false);
  });

  it("submitted → approved is invalid (must be claimed first)", () => {
    expect(isValidTransition("submitted", "approved")).toBe(false);
  });

  it("info_requested → approved is invalid (must resubmit first)", () => {
    expect(isValidTransition("info_requested", "approved")).toBe(false);
  });

  it("approved is a terminal state — no outgoing transitions", () => {
    expect(ALLOWED_TRANSITIONS["approved"]).toHaveLength(0);
  });

  it("rejected is a terminal state — no outgoing transitions", () => {
    expect(ALLOWED_TRANSITIONS["rejected"]).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Provider endpoints
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /v1/verification/cases", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for employer account (wrong account type)", async () => {
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_emp", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    // Employer lacks verification.submit permission
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid verificationType", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "wizard" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when provider has no profile yet", async () => {
    vi.mocked(getProviderProfileByUserId).mockResolvedValue(null);
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 201 with new case on success", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { case: typeof sampleCase };
    expect(body.case.id).toBe("case_1");
    expect(body.case.status).toBe("draft");
  });

  it("returns 409 when an active case already exists", async () => {
    vi.mocked(createVerificationCase).mockRejectedValue(
      new ConflictError("An active verification case already exists for this profile."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    expect(res.status).toBe(409);
  });

  it("response does not contain internal notes or audit log", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ verificationType: "artisan" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    const c = body["case"] as Record<string, unknown>;
    expect(c).not.toHaveProperty("notes");
    expect(c).not.toHaveProperty("auditLog");
    expect(c).not.toHaveProperty("userId");
    expect(c).not.toHaveProperty("claimedBy");
  });
});

describe("GET /v1/verification/cases", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases");
    expect(res.status).toBe(401);
  });

  it("returns 200 with own cases for provider", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cases: (typeof sampleCase)[] };
    expect(Array.isArray(body.cases)).toBe(true);
    expect(body.cases[0]!.id).toBe("case_1");
  });

  it("provider response does not contain internal notes", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases", {
      headers: { authorization: "Bearer tok_prov" },
    });
    const body = (await res.json()) as { cases: Record<string, unknown>[] };
    expect(body.cases[0]).not.toHaveProperty("notes");
    expect(body.cases[0]).not.toHaveProperty("auditLog");
  });
});

describe("GET /v1/verification/cases/:id", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases/case_1");
    expect(res.status).toBe(401);
  });

  it("returns 200 for own case", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when provider does not own the case", async () => {
    vi.mocked(getOwnCaseById).mockRejectedValue(
      new ForbiddenError("You do not own this verification case."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_other", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when case does not exist", async () => {
    vi.mocked(getOwnCaseById).mockRejectedValue(new NotFoundError("Verification case"));
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_missing", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/verification/cases/:id/submit", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases/case_1/submit", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with submitted case", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/submit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string } };
    expect(body.case.status).toBe("submitted");
  });

  it("returns 400 when transition is invalid (service throws BadRequestError)", async () => {
    vi.mocked(submitCase).mockRejectedValue(
      new BadRequestError("Cannot transition from 'submitted' to 'submitted'."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/submit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when provider does not own the case", async () => {
    vi.mocked(submitCase).mockRejectedValue(
      new ForbiddenError("You do not own this verification case."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/submit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/verification/cases/:id/evidence — add evidence", () => {
  const validBody = {
    evidenceType: "certificate",
    label: "City & Guilds Level 3",
    fileUrl: "https://storage.example.com/cert.pdf",
    mimeType: "application/pdf",
  };

  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases/case_1/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid evidenceType", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, evidenceType: "INVALID" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid fileUrl", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, fileUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 with created evidence", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { evidence: { id: string } };
    expect(body.evidence.id).toBe("evidence_1");
  });

  it("returns 400 when case status does not allow evidence addition", async () => {
    vi.mocked(addEvidence).mockRejectedValue(
      new BadRequestError(
        "Evidence can only be added when the case is in 'draft' or 'info_requested' status.",
      ),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /v1/verification/cases/:id/evidence/:evidenceId", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases/case_1/evidence/evidence_1", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("returns 204 on successful removal", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence/evidence_1", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 when evidence does not exist or is already removed", async () => {
    vi.mocked(removeEvidence).mockRejectedValue(new NotFoundError("Evidence item"));
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence/evidence_other", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when case status does not allow removal", async () => {
    vi.mocked(removeEvidence).mockRejectedValue(
      new BadRequestError(
        "Evidence can only be removed when the case is in 'draft' or 'info_requested' status.",
      ),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/evidence/evidence_1", {
      method: "DELETE",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/verification/cases/:id/resubmit", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/cases/case_1/resubmit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerResponse: "I have uploaded additional documents." }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing providerResponse", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/resubmit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with resubmitted case", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/resubmit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ providerResponse: "I have uploaded my certificate." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string } };
    expect(body.case.status).toBe("resubmitted");
  });

  it("returns 400 when case is not in info_requested status", async () => {
    vi.mocked(resubmitCase).mockRejectedValue(
      new BadRequestError("Cannot transition from 'draft' to 'resubmitted'."),
    );
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1/resubmit", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ providerResponse: "See attached." }),
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Reviewer (admin) endpoints
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /v1/verification/admin/cases", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases");
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider account (lacks verification.review)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for employer account (lacks verification.review)", async () => {
    const app = makeApp(employerTokens, employerIdentities);
    const res = await app.request("/v1/verification/admin/cases", {
      headers: { authorization: "Bearer tok_emp" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with list for reviewer", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases", {
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cases: unknown[] };
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it("filters by status via query param", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    await app.request("/v1/verification/admin/cases?status=submitted", {
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(vi.mocked(listCases)).toHaveBeenCalledWith(expect.anything(), { status: "submitted" });
  });

  it("reviewer response includes internal notes and audit log", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases", {
      headers: { authorization: "Bearer tok_rev" },
    });
    const body = (await res.json()) as { cases: Record<string, unknown>[] };
    expect(body.cases[0]).toHaveProperty("notes");
    expect(body.cases[0]).toHaveProperty("auditLog");
    expect(body.cases[0]).toHaveProperty("userId");
  });
});

describe("GET /v1/verification/admin/cases/:id", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1");
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.review)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 for reviewer", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1", {
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when case does not exist", async () => {
    vi.mocked(getCaseForReviewer).mockRejectedValue(new NotFoundError("Verification case"));
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_missing", {
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(res.status).toBe(404);
  });

  it("reviewer response includes internal notes — internal note privacy boundary", async () => {
    vi.mocked(getCaseForReviewer).mockResolvedValue({
      ...sampleReviewerCase,
      notes: [
        {
          id: "note_1",
          reviewerId: "pmp_reviewer_1",
          content: "Internal: suspicious documents",
          createdAt: now.toISOString(),
        },
      ],
    });
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1", {
      headers: { authorization: "Bearer tok_rev" },
    });
    const body = (await res.json()) as { case: { notes: { content: string }[] } };
    expect(body.case.notes[0]!.content).toBe("Internal: suspicious documents");
  });
});

describe("POST /v1/verification/admin/cases/:id/claim", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/claim", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.review)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/claim", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with claimed case", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/claim", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string; claimedBy: string } };
    expect(body.case.status).toBe("under_review");
    expect(body.case.claimedBy).toBe("pmp_reviewer_1");
  });

  it("returns 400 when case cannot be claimed (invalid transition)", async () => {
    vi.mocked(claimCase).mockRejectedValue(
      new BadRequestError("Cannot transition from 'under_review' to 'under_review'."),
    );
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/claim", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/verification/admin/cases/:id/notes — internal notes privacy", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Looks genuine." }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.review)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/notes", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ content: "Looks genuine." }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 201 with created note for reviewer", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/notes", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ content: "Looks good." }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { note: { id: string; content: string } };
    expect(body.note.id).toBe("note_1");
  });

  it("returns 400 for empty note content", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/notes", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/verification/admin/cases/:id/request-info", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/request-info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Please provide your certificate." }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.request_info)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/request-info", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ message: "Please provide your certificate." }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with info_requested case", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/request-info", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ message: "Please provide your certificate." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string } };
    expect(body.case.status).toBe("info_requested");
  });

  it("returns 400 for empty message", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/request-info", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/verification/admin/cases/:id/approve", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.approve)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/approve", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with approved case", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/approve", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ reason: "All documents verified." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string } };
    expect(body.case.status).toBe("approved");
  });

  it("returns 400 when transition is invalid (e.g. already approved)", async () => {
    vi.mocked(approveCase).mockRejectedValue(
      new BadRequestError("Cannot transition from 'approved' to 'approved'."),
    );
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/approve", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/verification/admin/cases/:id/reject", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Insufficient evidence." }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.reject)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/reject", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Insufficient evidence." }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when reason is missing (required)", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/reject", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with rejected case", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/reject", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Insufficient evidence." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string; decisionReason: string } };
    expect(body.case.status).toBe("rejected");
    expect(body.case.decisionReason).toBe("Insufficient evidence");
  });
});

describe("POST /v1/verification/admin/cases/:id/escalate", () => {
  it("returns 401 without auth", async () => {
    const app = makeApp(new Map(), new Map());
    const res = await app.request("/v1/verification/admin/cases/case_1/escalate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for provider (lacks verification.review)", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/escalate", {
      method: "POST",
      headers: { authorization: "Bearer tok_prov", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 with escalated case", async () => {
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/escalate", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Requires senior review." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { case: { status: string } };
    expect(body.case.status).toBe("escalated");
  });

  it("returns 400 when transition is invalid (e.g. from draft)", async () => {
    vi.mocked(escalateCase).mockRejectedValue(
      new BadRequestError("Cannot transition from 'draft' to 'escalated'."),
    );
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1/escalate", {
      method: "POST",
      headers: { authorization: "Bearer tok_rev", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Audit trail
// ═════════════════════════════════════════════════════════════════════════════

describe("Audit trail", () => {
  it("reviewer DTO includes audit log entries", async () => {
    vi.mocked(getCaseForReviewer).mockResolvedValue({
      ...sampleReviewerCase,
      auditLog: [
        {
          id: "audit_1",
          actorId: "pmp_provider_1",
          action: "case_created",
          fromStatus: null,
          toStatus: "draft",
          metadata: null,
          createdAt: now.toISOString(),
        },
        {
          id: "audit_2",
          actorId: "pmp_provider_1",
          action: "case_submitted",
          fromStatus: "draft",
          toStatus: "submitted",
          metadata: null,
          createdAt: now.toISOString(),
        },
      ],
    });
    const app = makeApp(reviewerTokens, reviewerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1", {
      headers: { authorization: "Bearer tok_rev" },
    });
    const body = (await res.json()) as { case: { auditLog: { action: string }[] } };
    expect(body.case.auditLog).toHaveLength(2);
    expect(body.case.auditLog[0]!.action).toBe("case_created");
    expect(body.case.auditLog[1]!.action).toBe("case_submitted");
  });

  it("provider DTO does not include audit log entries", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    const body = (await res.json()) as { case: Record<string, unknown> };
    expect(body.case).not.toHaveProperty("auditLog");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Public verification status behaviour
// ═════════════════════════════════════════════════════════════════════════════

describe("Public verification status", () => {
  it("provider profile verification status is not leaked through verification case DTO", async () => {
    // Provider can see verificationStatus on their own profile (via profile endpoint)
    // but the case DTO does not expose the internal case's effect on the profile
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    const body = (await res.json()) as { case: Record<string, unknown> };
    // Case DTO does not contain the profile's verification status
    expect(body.case).not.toHaveProperty("verificationStatus");
    // It does contain the case's own status
    expect(body.case).toHaveProperty("status");
  });

  it("internal notes are not accessible via provider-facing endpoints", async () => {
    // Provider cannot access /v1/verification/admin/cases/:id
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/admin/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    expect(res.status).toBe(403);
  });

  it("reviewer identity is not exposed in provider-facing case DTO", async () => {
    const app = makeApp(providerTokens, providerIdentities);
    const res = await app.request("/v1/verification/cases/case_1", {
      headers: { authorization: "Bearer tok_prov" },
    });
    const body = (await res.json()) as { case: Record<string, unknown> };
    expect(body.case).not.toHaveProperty("claimedBy");
    expect(body.case).not.toHaveProperty("claimedAt");
    expect(body.case).not.toHaveProperty("userId");
  });
});
