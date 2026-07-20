/**
 * Search & Ranking tests — Stage 5.
 *
 * Two test layers:
 *
 * 1. Ranking unit tests — pure functions, no DB, no mocks needed.
 *    Covers every scoring component individually and the composite scorer.
 *
 * 2. Route integration tests — mock the search service, verify HTTP contract.
 *    Uses the same mock-injection pattern as other test files.
 *
 * Tests covered:
 *
 *   Scoring components (pure unit)
 *     - textRelevance: headline match, about match, both, no match, empty q
 *     - verification: verified, in_review, additional_info_requested, unverified, rejected
 *     - completeness: 0%, 50%, 100%
 *     - categoryMatch: match, no match, no filter active
 *     - skillMatch: q match (0, 1, many), skillId filter
 *     - experience: 0, 3, 8, >8 (capped)
 *     - certifications: 0, 1
 *     - portfolio: 0, 1
 *     - availability: available, limited, unavailable
 *     - locationMatch: match, no match, no filter
 *
 *   Composite ranking
 *     - rankCandidate assembles all components correctly
 *     - totalScore is sum of components
 *
 *   Sorting
 *     - relevance: higher score first
 *     - newest: newer first
 *     - completeness: higher completeness first
 *     - experience: more experience first (null last)
 *     - Tie-breaking: createdAt DESC, then profileId ASC
 *     - Stable ordering: deterministic across equal candidates
 *
 *   Sort alias normalisation
 *     - "recent" → "newest"
 *     - "rating" → "relevance"
 *     - unknown → "relevance"
 *
 *   Route: GET /v1/search/providers
 *     - Returns 200 with correct shape
 *     - Returns paginated response {items, page, pageSize, total}
 *     - Accepts all valid filter params
 *     - Rejects invalid categoryId (not UUID)
 *     - Rejects invalid skillId (not UUID)
 *     - Rejects invalid verificationStatus value
 *     - Rejects invalid providerType value
 *     - Rejects limit > 50
 *     - Accepts limit=50 (max)
 *     - Defaults page=1, limit=20 when omitted
 *     - No internal ranking data in response
 *     - No verification evidence or reviewer notes in response
 *     - verified=true shorthand
 *     - sort=recent (frontend alias)
 *     - sort=rating (frontend alias)
 *     - Empty results → {items:[], page:1, pageSize:20, total:0}
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import {
  scoreTextRelevance,
  scoreVerification,
  scoreCompleteness,
  scoreCategoryMatch,
  scoreSkillMatch,
  scoreExperience,
  scoreCertifications,
  scorePortfolio,
  scoreAvailability,
  scoreLocationMatch,
  rankCandidate,
  sortCandidates,
  rankAndSort,
} from "../src/services/search/ranking.js";
import { normaliseSortOption } from "../src/services/search/index.js";
import type { SearchCandidate, RankedCandidate } from "../src/services/search/types.js";

// ─── Mock search service ───────────────────────────────────────────────────────

vi.mock("../src/services/search/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/search/index.js")>();
  return {
    ...original,
    searchProviders: vi.fn(),
  };
});

import {
  searchProviders,
  normaliseSortOption as _normaliseSortOption,
} from "../src/services/search/index.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T12:00:00Z");
const earlier = new Date("2026-01-01T00:00:00Z");

function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    profileId: "profile_1",
    userId: "user_1",
    displayName: "Ada Plumber",
    email: "ada@example.com",
    avatarUrl: null,
    kind: "artisan",
    headline: "Expert Plumber in Lagos",
    about: "I have been fixing pipes for 10 years.",
    location: "Lagos",
    serviceArea: "Lagos State",
    availability: "available",
    yearsOfExperience: 5,
    hourlyRate: 5000,
    currency: "NGN",
    completenessScore: 80,
    verificationStatus: "verified",
    isPublic: true,
    primaryCategoryId: "cat_plumbing",
    primaryCategoryName: "Plumbing",
    primaryCategorySlug: "plumbing",
    createdAt: now,
    skills: [
      { id: "skill_1", name: "Pipe Installation", category: "Plumbing" },
      { id: "skill_2", name: "Drainage Systems", category: "Plumbing" },
    ],
    experience: [
      {
        id: "exp_1",
        role: "Senior Plumber",
        organization: "Lagos Water Co.",
        startDate: "2018-01-01",
        endDate: null,
        description: null,
      },
    ],
    certifications: [
      {
        id: "cert_1",
        name: "City & Guilds Plumbing",
        issuer: "City & Guilds",
        issuedAt: "2020-01-01",
        expiresAt: null,
        evidenceUrl: null,
      },
    ],
    portfolio: [
      {
        id: "port_1",
        title: "Bathroom renovation",
        description: null,
        mediaUrl: "https://example.com/photo.jpg",
        mediaType: "image",
        displayOrder: 0,
        createdAt: now.toISOString(),
      },
    ],
    ...overrides,
  };
}

const samplePage = {
  items: [
    {
      id: "profile_1",
      email: "ada@example.com",
      role: "provider" as const,
      displayName: "Ada Plumber",
      kind: "artisan" as const,
      headline: "Expert Plumber in Lagos",
      category: "Plumbing",
      skills: [],
      experience: [],
      certifications: [],
      portfolio: [],
      verification: "verified",
      availability: "available" as const,
      createdAt: now.toISOString(),
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
};

// ─── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const idService: AuthIdentityService = {
    resolve: async () => null,
    provision: async () => {
      throw new Error("unexpected");
    },
    updateProfile: async () => {},
  };
  return createApp({
    clerkAdapter: createMockClerkAdapter(new Map()),
    identityService: idService,
    db: {} as unknown as import("../src/db/client.js").Db,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchProviders).mockResolvedValue(samplePage);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Scoring components — pure unit tests
// ═════════════════════════════════════════════════════════════════════════════

describe("scoreTextRelevance", () => {
  // about does NOT contain "plumber" — isolates headline-only match for these tests
  const candidate = { headline: "Expert Plumber in Lagos", about: "I specialise in pipework." };

  it("returns 0 when q is undefined", () => {
    expect(scoreTextRelevance(candidate, undefined)).toBe(0);
  });

  it("returns 0 when q is empty string", () => {
    expect(scoreTextRelevance(candidate, "")).toBe(0);
  });

  it("awards 20 for headline match only", () => {
    expect(scoreTextRelevance(candidate, "plumber")).toBe(20);
  });

  it("awards 10 for about match only", () => {
    expect(
      scoreTextRelevance({ headline: "Electrician", about: "expert plumber" }, "plumber"),
    ).toBe(10);
  });

  it("awards 30 when both headline and about match", () => {
    expect(
      scoreTextRelevance(
        { headline: "plumber in lagos", about: "Best plumber around." },
        "plumber",
      ),
    ).toBe(30);
  });

  it("is case-insensitive", () => {
    // "PLUMBER" matches "Expert Plumber in Lagos" headline → 20
    expect(scoreTextRelevance(candidate, "PLUMBER")).toBe(20);
  });

  it("returns 0 when neither headline nor about matches", () => {
    expect(scoreTextRelevance(candidate, "electrician")).toBe(0);
  });

  it("returns 0 when headline and about are null", () => {
    expect(scoreTextRelevance({ headline: null, about: null }, "plumber")).toBe(0);
  });
});

describe("scoreVerification", () => {
  it("returns 20 for verified", () => {
    expect(scoreVerification("verified")).toBe(20);
  });

  it("returns 10 for in_review", () => {
    expect(scoreVerification("in_review")).toBe(10);
  });

  it("returns 10 for additional_info_requested", () => {
    expect(scoreVerification("additional_info_requested")).toBe(10);
  });

  it("returns 0 for unverified", () => {
    expect(scoreVerification("unverified")).toBe(0);
  });

  it("returns 0 for rejected", () => {
    expect(scoreVerification("rejected")).toBe(0);
  });
});

describe("scoreCompleteness", () => {
  it("returns 0 for score of 0", () => {
    expect(scoreCompleteness(0)).toBe(0);
  });

  it("returns 15 for score of 100", () => {
    expect(scoreCompleteness(100)).toBe(15);
  });

  it("returns 8 for score of 50 (rounded)", () => {
    expect(scoreCompleteness(50)).toBe(8);
  });

  it("returns 11 for score of 75 (rounded)", () => {
    expect(scoreCompleteness(75)).toBe(11);
  });
});

describe("scoreCategoryMatch", () => {
  it("returns 0 and false when no category filter active", () => {
    const { score, match } = scoreCategoryMatch({ primaryCategoryId: "cat_1" }, undefined);
    expect(score).toBe(0);
    expect(match).toBe(false);
  });

  it("returns 10 and true when category matches", () => {
    const { score, match } = scoreCategoryMatch({ primaryCategoryId: "cat_1" }, "cat_1");
    expect(score).toBe(10);
    expect(match).toBe(true);
  });

  it("returns 0 and false when category does not match", () => {
    const { score, match } = scoreCategoryMatch({ primaryCategoryId: "cat_2" }, "cat_1");
    expect(score).toBe(0);
    expect(match).toBe(false);
  });

  it("returns 0 and false when profile has no primary category", () => {
    const { score, match } = scoreCategoryMatch({ primaryCategoryId: null }, "cat_1");
    expect(score).toBe(0);
    expect(match).toBe(false);
  });
});

describe("scoreSkillMatch", () => {
  const skills = [
    { id: "s1", name: "Pipe Installation", category: "Plumbing" },
    { id: "s2", name: "Drainage Systems", category: "Plumbing" },
  ];

  it("returns 0 when no q and no skillId", () => {
    const { score, matchedSkillCount } = scoreSkillMatch({ skills }, undefined, undefined);
    expect(score).toBe(0);
    expect(matchedSkillCount).toBe(0);
  });

  it("awards max (10) when skillId filter is present", () => {
    const { score, matchedSkillCount } = scoreSkillMatch({ skills }, undefined, "s1");
    expect(score).toBe(10);
    expect(matchedSkillCount).toBe(1);
  });

  it("awards 3 per matched skill (up to 10)", () => {
    const { score, matchedSkillCount } = scoreSkillMatch({ skills }, "pipe", undefined);
    // "pipe" matches "Pipe Installation" → 1 skill × 3 = 3
    expect(score).toBe(3);
    expect(matchedSkillCount).toBe(1);
  });

  it("awards 6 for 2 matched skills", () => {
    const { score } = scoreSkillMatch(
      {
        skills: [
          { id: "s1", name: "web development", category: "Tech" },
          { id: "s2", name: "web design", category: "Tech" },
        ],
      },
      "web",
      undefined,
    );
    expect(score).toBe(6);
  });

  it("caps at 10 when many skills match", () => {
    const manySkills = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      name: `plumbing skill ${i}`,
      category: "Plumbing",
    }));
    const { score } = scoreSkillMatch({ skills: manySkills }, "plumbing", undefined);
    expect(score).toBe(10); // 10×3=30 but capped at 10
  });

  it("returns 0 when q does not match any skill", () => {
    const { score, matchedSkillCount } = scoreSkillMatch({ skills }, "electrician", undefined);
    expect(score).toBe(0);
    expect(matchedSkillCount).toBe(0);
  });
});

describe("scoreExperience", () => {
  it("returns 0 for null", () => {
    expect(scoreExperience(null)).toBe(0);
  });

  it("returns 0 for 0 years", () => {
    expect(scoreExperience(0)).toBe(0);
  });

  it("returns 3 for 3 years", () => {
    expect(scoreExperience(3)).toBe(3);
  });

  it("returns 8 for exactly 8 years (max)", () => {
    expect(scoreExperience(8)).toBe(8);
  });

  it("caps at 8 for more than 8 years", () => {
    expect(scoreExperience(20)).toBe(8);
  });
});

describe("scoreCertifications", () => {
  it("returns 0 for 0 certifications", () => {
    expect(scoreCertifications(0)).toBe(0);
  });

  it("returns 4 for 1 certification", () => {
    expect(scoreCertifications(1)).toBe(4);
  });

  it("returns 4 for many certifications (binary)", () => {
    expect(scoreCertifications(5)).toBe(4);
  });
});

describe("scorePortfolio", () => {
  it("returns 0 for 0 portfolio items", () => {
    expect(scorePortfolio(0)).toBe(0);
  });

  it("returns 3 for 1 portfolio item", () => {
    expect(scorePortfolio(1)).toBe(3);
  });

  it("returns 3 for many portfolio items (binary)", () => {
    expect(scorePortfolio(10)).toBe(3);
  });
});

describe("scoreAvailability", () => {
  it("returns 5 for available", () => {
    expect(scoreAvailability("available")).toBe(5);
  });

  it("returns 2 for limited", () => {
    expect(scoreAvailability("limited")).toBe(2);
  });

  it("returns 0 for unavailable", () => {
    expect(scoreAvailability("unavailable")).toBe(0);
  });
});

describe("scoreLocationMatch", () => {
  it("returns 0 when no location filter active", () => {
    expect(scoreLocationMatch("Lagos", undefined)).toBe(0);
  });

  it("returns 5 when location matches (case-insensitive)", () => {
    expect(scoreLocationMatch("Lagos, Nigeria", "lagos")).toBe(5);
  });

  it("returns 5 for partial location match", () => {
    expect(scoreLocationMatch("Lagos Island", "Lagos")).toBe(5);
  });

  it("returns 0 when location does not match", () => {
    expect(scoreLocationMatch("Abuja", "Lagos")).toBe(0);
  });

  it("returns 0 when candidate has no location", () => {
    expect(scoreLocationMatch(null, "Lagos")).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Composite ranking
// ═════════════════════════════════════════════════════════════════════════════

describe("rankCandidate", () => {
  it("totalScore equals sum of all components", () => {
    const candidate = makeCandidate({
      headline: "Expert Plumber",
      about: "Best plumber",
      verificationStatus: "verified",
      completenessScore: 80,
      primaryCategoryId: "cat_plumbing",
      skills: [{ id: "s1", name: "Plumbing", category: "Plumbing" }],
      yearsOfExperience: 5,
      certifications: [
        {
          id: "c1",
          name: "Cert",
          issuer: "Org",
          issuedAt: "2020-01-01",
          expiresAt: null,
          evidenceUrl: null,
        },
      ],
      portfolio: [
        {
          id: "p1",
          title: "Work",
          description: null,
          mediaUrl: "https://x.com",
          mediaType: "image",
          displayOrder: 0,
          createdAt: now.toISOString(),
        },
      ],
      availability: "available",
      location: "Lagos",
    });

    const explanation = rankCandidate(candidate, {
      q: "plumber",
      categoryId: "cat_plumbing",
      location: "Lagos",
    });

    const sum =
      explanation.textRelevanceScore +
      explanation.verificationScore +
      explanation.completenessRankScore +
      explanation.categoryMatchScore +
      explanation.skillMatchScore +
      explanation.experienceScore +
      explanation.certificationScore +
      explanation.portfolioScore +
      explanation.availabilityScore +
      explanation.locationMatchScore;

    expect(explanation.totalScore).toBe(sum);
  });

  it("a fully complete verified provider scores higher than an incomplete unverified one", () => {
    const strong = makeCandidate({
      verificationStatus: "verified",
      completenessScore: 100,
      availability: "available",
      yearsOfExperience: 8,
      certifications: [
        {
          id: "c1",
          name: "Cert",
          issuer: "Org",
          issuedAt: "2020-01-01",
          expiresAt: null,
          evidenceUrl: null,
        },
      ],
      portfolio: [
        {
          id: "p1",
          title: "Work",
          description: null,
          mediaUrl: "https://x.com",
          mediaType: "image",
          displayOrder: 0,
          createdAt: now.toISOString(),
        },
      ],
    });
    const weak = makeCandidate({
      profileId: "profile_2",
      verificationStatus: "unverified",
      completenessScore: 20,
      availability: "unavailable",
      yearsOfExperience: null,
      certifications: [],
      portfolio: [],
    });

    const strongScore = rankCandidate(strong, {}).totalScore;
    const weakScore = rankCandidate(weak, {}).totalScore;

    expect(strongScore).toBeGreaterThan(weakScore);
  });

  it("categoryMatch is true when category matches", () => {
    const candidate = makeCandidate({ primaryCategoryId: "cat_1" });
    const result = rankCandidate(candidate, { categoryId: "cat_1" });
    expect(result.categoryMatch).toBe(true);
    expect(result.categoryMatchScore).toBe(10);
  });

  it("categoryMatch is false and no score when categories differ", () => {
    const candidate = makeCandidate({ primaryCategoryId: "cat_2" });
    const result = rankCandidate(candidate, { categoryId: "cat_1" });
    expect(result.categoryMatch).toBe(false);
    expect(result.categoryMatchScore).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Sorting
// ═════════════════════════════════════════════════════════════════════════════

function makeRanked(
  score: number,
  profileId: string,
  createdAt = now,
  completenessScore = 50,
  yearsOfExperience: number | null = null,
): RankedCandidate {
  return {
    candidate: makeCandidate({ profileId, createdAt, completenessScore, yearsOfExperience }),
    ranking: {
      textRelevanceScore: 0,
      verificationScore: 0,
      completenessRankScore: 0,
      categoryMatchScore: 0,
      skillMatchScore: 0,
      experienceScore: 0,
      certificationScore: 0,
      portfolioScore: 0,
      availabilityScore: 0,
      locationMatchScore: 0,
      totalScore: score,
      matchedSkillCount: 0,
      categoryMatch: false,
    },
  };
}

describe("sortCandidates — relevance", () => {
  it("orders by totalScore DESC", () => {
    const candidates = [makeRanked(30, "p1"), makeRanked(80, "p2"), makeRanked(50, "p3")];
    const sorted = sortCandidates(candidates, "relevance");
    expect(sorted.map((r) => r.candidate.profileId)).toEqual(["p2", "p3", "p1"]);
  });

  it("breaks ties by createdAt DESC", () => {
    const a = makeRanked(50, "p_a", earlier);
    const b = makeRanked(50, "p_b", now);
    const sorted = sortCandidates([a, b], "relevance");
    expect(sorted[0]!.candidate.profileId).toBe("p_b");
  });

  it("breaks remaining ties by profileId ASC (deterministic)", () => {
    const a = makeRanked(50, "profile_b", now);
    const b = makeRanked(50, "profile_a", now);
    const sorted = sortCandidates([a, b], "relevance");
    expect(sorted[0]!.candidate.profileId).toBe("profile_a");
  });
});

describe("sortCandidates — newest", () => {
  it("orders by createdAt DESC", () => {
    const a = makeRanked(80, "p_old", earlier);
    const b = makeRanked(10, "p_new", now);
    const sorted = sortCandidates([a, b], "newest");
    expect(sorted[0]!.candidate.profileId).toBe("p_new");
  });
});

describe("sortCandidates — completeness", () => {
  it("orders by completenessScore DESC", () => {
    const a = makeRanked(0, "p1", now, 40);
    const b = makeRanked(0, "p2", now, 90);
    const sorted = sortCandidates([a, b], "completeness");
    expect(sorted[0]!.candidate.profileId).toBe("p2");
  });
});

describe("sortCandidates — experience", () => {
  it("orders by yearsOfExperience DESC, null last", () => {
    const a = makeRanked(0, "p1", now, 50, 3);
    const b = makeRanked(0, "p2", now, 50, null);
    const c = makeRanked(0, "p3", now, 50, 10);
    const sorted = sortCandidates([a, b, c], "experience");
    expect(sorted.map((r) => r.candidate.profileId)).toEqual(["p3", "p1", "p2"]);
  });
});

describe("rankAndSort integration", () => {
  it("returns empty array for empty candidates", () => {
    const result = rankAndSort([], { q: "plumber", sort: "relevance" });
    expect(result).toHaveLength(0);
  });

  it("returns candidates in ranked order", () => {
    const strong = makeCandidate({
      profileId: "p_strong",
      verificationStatus: "verified",
      completenessScore: 100,
      availability: "available",
    });
    const weak = makeCandidate({
      profileId: "p_weak",
      verificationStatus: "unverified",
      completenessScore: 10,
      availability: "unavailable",
    });
    const result = rankAndSort([weak, strong], { sort: "relevance" });
    expect(result[0]!.candidate.profileId).toBe("p_strong");
  });

  it("does not mutate the original candidates array", () => {
    const candidates = [makeCandidate({ profileId: "p1" }), makeCandidate({ profileId: "p2" })];
    const original = [...candidates];
    rankAndSort(candidates, { sort: "relevance" });
    expect(candidates[0]!.profileId).toBe(original[0]!.profileId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Sort alias normalisation
// ═════════════════════════════════════════════════════════════════════════════

describe("normaliseSortOption", () => {
  it("maps 'relevance' to 'relevance'", () => {
    expect(normaliseSortOption("relevance")).toBe("relevance");
  });

  it("maps 'newest' to 'newest'", () => {
    expect(normaliseSortOption("newest")).toBe("newest");
  });

  it("maps 'recent' (frontend alias) to 'newest'", () => {
    expect(normaliseSortOption("recent")).toBe("newest");
  });

  it("maps 'rating' (frontend alias, future) to 'relevance'", () => {
    expect(normaliseSortOption("rating")).toBe("relevance");
  });

  it("maps unknown string to 'relevance'", () => {
    expect(normaliseSortOption("magic_sort")).toBe("relevance");
  });

  it("maps undefined to 'relevance'", () => {
    expect(normaliseSortOption(undefined)).toBe("relevance");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Route integration tests
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /v1/search/providers", () => {
  it("returns 200 with correct paginated shape", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof samplePage;
    expect(body).toMatchObject({
      items: expect.any(Array),
      page: 1,
      pageSize: 20,
      total: expect.any(Number),
    });
  });

  it("passes q to search service", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?q=plumber");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: "plumber" }),
    );
  });

  it("passes providerType as kind to search service", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?providerType=artisan");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "artisan" }),
    );
  });

  it("passes categoryId directly", async () => {
    const app = makeApp();
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    await app.request(`/v1/search/providers?categoryId=${uuid}`);
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ categoryId: uuid }),
    );
  });

  it("passes category slug for resolution", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?category=plumbing");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: "plumbing" }),
    );
  });

  it("passes skillId", async () => {
    const app = makeApp();
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    await app.request(`/v1/search/providers?skillId=${uuid}`);
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skillId: uuid }),
    );
  });

  it("passes verified=true as boolean", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?verified=true");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verified: true }),
    );
  });

  it("passes verificationStatus", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?verificationStatus=verified");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verificationStatus: "verified" }),
    );
  });

  it("passes availabilityStatus", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?availabilityStatus=available");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ availabilityStatus: "available" }),
    );
  });

  it("passes location", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?location=Lagos");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ location: "Lagos" }),
    );
  });

  it("passes minExperience as number", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?minExperience=3");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minExperience: 3 }),
    );
  });

  it("passes minCompleteness as number", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?minCompleteness=60");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minCompleteness: 60 }),
    );
  });

  it("defaults page=1 and limit=20 when omitted", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("passes page and limit", async () => {
    const app = makeApp();
    await app.request("/v1/search/providers?page=2&limit=10");
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, limit: 10 }),
    );
  });

  it("accepts limit=50 (maximum)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?limit=50");
    expect(res.status).toBe(200);
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("rejects limit > 50 with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?limit=51");
    expect(res.status).toBe(400);
  });

  it("rejects invalid categoryId (not UUID) with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?categoryId=not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("rejects invalid skillId (not UUID) with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?skillId=not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("rejects invalid providerType with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?providerType=wizard");
    expect(res.status).toBe(400);
  });

  it("rejects invalid verificationStatus with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?verificationStatus=hacked");
    expect(res.status).toBe(400);
  });

  it("rejects invalid availabilityStatus with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?availabilityStatus=always");
    expect(res.status).toBe(400);
  });

  it("accepts sort=relevance", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?sort=relevance");
    expect(res.status).toBe(200);
  });

  it("accepts sort=newest", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?sort=newest");
    expect(res.status).toBe(200);
  });

  it("accepts sort=recent (frontend alias)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?sort=recent");
    expect(res.status).toBe(200);
  });

  it("accepts sort=rating (frontend alias for future ratings)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?sort=rating");
    expect(res.status).toBe(200);
  });

  it("rejects completely unknown sort value with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers?sort=__sql_injection__");
    expect(res.status).toBe(400);
  });

  it("returns empty result when search service returns no items", async () => {
    vi.mocked(searchProviders).mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const app = makeApp();
    const res = await app.request("/v1/search/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("response does not contain internal ranking data", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers");
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    if (body.items.length > 0) {
      expect(body.items[0]).not.toHaveProperty("ranking");
      expect(body.items[0]).not.toHaveProperty("totalScore");
      expect(body.items[0]).not.toHaveProperty("textRelevanceScore");
    }
  });

  it("response does not contain verification evidence or reviewer notes", async () => {
    const app = makeApp();
    const res = await app.request("/v1/search/providers");
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    if (body.items.length > 0) {
      const item = body.items[0]!;
      expect(item).not.toHaveProperty("verificationEvidence");
      expect(item).not.toHaveProperty("reviewerNotes");
      expect(item).not.toHaveProperty("notes");
      expect(item).not.toHaveProperty("auditLog");
    }
  });

  it("multiple filters together are passed to search service", async () => {
    const app = makeApp();
    const catId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    await app.request(
      `/v1/search/providers?q=plumber&providerType=artisan&categoryId=${catId}&verified=true&location=Lagos&minExperience=2&page=1&limit=10&sort=newest`,
    );
    expect(vi.mocked(searchProviders)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        q: "plumber",
        kind: "artisan",
        categoryId: catId,
        verified: true,
        location: "Lagos",
        minExperience: 2,
        page: 1,
        limit: 10,
        sort: "newest",
      }),
    );
  });
});
