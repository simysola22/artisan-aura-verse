/**
 * Search & Ranking — shared types (Stage 5).
 *
 * Three layers of types live here:
 *
 *   SearchQuery   — validated, normalised input from the route handler
 *   SearchCandidate — a fully-loaded provider profile ready for scoring
 *   RankedCandidate — candidate plus its computed score breakdown
 *   SearchResultItem — the public API DTO (matches frontend Provider type)
 *   SearchPage      — paginated response wrapper
 *
 * Separation ensures that:
 *   - Ranking functions are pure (accept SearchCandidate, return scores)
 *   - The repository layer is swappable (returns SearchCandidate[])
 *   - Public DTOs never carry internal scoring data
 */

import type {
  SkillDto,
  ExperienceDto,
  CertificationDto,
  PortfolioItemDto,
} from "../provider-profile.js";

// ─── Input ────────────────────────────────────────────────────────────────────

/** Allowlisted sort options. No arbitrary SQL accepted from callers. */
export type SortOption = "relevance" | "newest" | "completeness" | "experience";

/**
 * Normalised search query.
 *
 * Route handler validates raw query params and produces this object.
 * All string inputs have been trimmed; categoryId has been resolved from
 * a slug if the caller supplied `category` (slug) instead of `categoryId`.
 */
export interface SearchQuery {
  /** Free-text keyword (trimmed, lowercase for comparison). */
  q?: string;

  /** Resolved primary category ID (may come from ?category=slug lookup). */
  categoryId?: string;

  /** Skill ID hard filter — only providers with this skill are returned. */
  skillId?: string;

  /** Provider kind filter. */
  kind?: "artisan" | "professional";

  /**
   * Specific verification status filter.
   * If verified=true shorthand is used instead, this is set to "verified".
   */
  verificationStatus?:
    "unverified" | "in_review" | "additional_info_requested" | "verified" | "rejected";

  /** Availability status filter. */
  availabilityStatus?: "available" | "limited" | "unavailable";

  /** Location substring filter (ILIKE). */
  location?: string;

  /** Minimum self-reported years of experience. */
  minExperience?: number;

  /** Minimum profile completeness score (0–100). */
  minCompleteness?: number;

  /** 1-based page number. */
  page: number;

  /** Page size — capped at MAX_PAGE_SIZE by the search service. */
  limit: number;

  /** Sort order. */
  sort: SortOption;
}

/** Hard limit on candidates fetched from the DB for in-memory ranking. */
export const CANDIDATE_FETCH_LIMIT = 500;

/** Maximum page size accepted from callers. */
export const MAX_PAGE_SIZE = 50;

/** Default page size when caller does not specify. */
export const DEFAULT_PAGE_SIZE = 20;

// ─── Candidate (repository output) ───────────────────────────────────────────

/**
 * A fully-loaded provider profile ready for scoring.
 *
 * The repository layer returns these; the ranking layer consumes them.
 * Replacing the PostgreSQL repository with Meilisearch means only the
 * repository needs changing — types and ranking functions are unaffected.
 */
export interface SearchCandidate {
  // ── Identity ──────────────────────────────────────────────────────────────
  profileId: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;

  // ── Profile core ──────────────────────────────────────────────────────────
  kind: "artisan" | "professional";
  headline: string | null;
  about: string | null;
  location: string | null;
  serviceArea: string | null;
  availability: "available" | "limited" | "unavailable";
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  currency: string | null;
  completenessScore: number;
  verificationStatus: string;
  isPublic: boolean;
  createdAt: Date;

  // ── Primary category ──────────────────────────────────────────────────────
  primaryCategoryId: string | null;
  primaryCategoryName: string | null;
  primaryCategorySlug: string | null;

  // ── Sub-resources (batch-loaded, never N+1) ───────────────────────────────
  skills: SkillDto[];
  experience: ExperienceDto[];
  certifications: CertificationDto[];
  portfolio: PortfolioItemDto[];
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Breakdown of how a candidate's score was computed.
 *
 * Internal only — never serialised into public API responses.
 * Used for analytics, debugging, and test assertions.
 *
 * Component weights (max possible per component):
 *   textRelevance  30  — keyword match in headline, about, skills
 *   verification   20  — verified=20, in_review|additional_info_req=10, other=0
 *   completeness   15  — completenessScore/100 * 15 (rounded)
 *   categoryMatch  10  — query has category filter AND it matches profile
 *   skillMatch     10  — min(matchedSkillCount × 3, 10)
 *   experience      8  — min(yearsOfExperience, 8)
 *   certification   4  — has ≥1 certification
 *   portfolio       3  — has ≥1 portfolio item
 *   availability    5  — available=5, limited=2, unavailable=0
 *   locationMatch   5  — query has location filter AND profile location matches
 *                  ──
 *   max total     110  (relative ordering, not a percentage)
 */
export interface RankingExplanation {
  textRelevanceScore: number;
  verificationScore: number;
  completenessRankScore: number;
  categoryMatchScore: number;
  skillMatchScore: number;
  experienceScore: number;
  certificationScore: number;
  portfolioScore: number;
  availabilityScore: number;
  locationMatchScore: number;
  totalScore: number;
  /** Number of skills whose name contains the search query. */
  matchedSkillCount: number;
  /** Whether the profile's primary category matches the query's categoryId. */
  categoryMatch: boolean;
}

/** A candidate augmented with its ranking result. */
export interface RankedCandidate {
  candidate: SearchCandidate;
  ranking: RankingExplanation;
}

// ─── Public API response ──────────────────────────────────────────────────────

/**
 * Public-facing search result item.
 *
 * Matches the frontend `Provider` type in src/types/index.ts.
 * No internal ranking data, no private verification evidence, no reviewer notes.
 *
 * Fields that do not yet have backend data (ratingAverage, ratingCount)
 * are intentionally omitted (undefined) so the frontend shows no rating UI.
 */
export interface SearchResultItem {
  /** Provider profile ID — used for /providers/:id routing. */
  id: string;
  email: string;
  role: "provider";
  displayName: string;
  avatarUrl?: string;
  kind: "artisan" | "professional";
  /** Empty string when no headline is set (frontend type expects string, not null). */
  headline: string;
  about?: string;
  /** Primary category name, empty string if no category assigned. */
  category: string;
  skills: SkillDto[];
  experience: ExperienceDto[];
  certifications: CertificationDto[];
  portfolio: PortfolioItemDto[];
  verification: string;
  serviceArea?: string;
  availability: "available" | "limited" | "unavailable";
  hourlyRate?: number;
  currency?: string;
  /** Undefined until the ratings system is implemented (Stage 7+). */
  ratingAverage?: number;
  /** Undefined until the ratings system is implemented (Stage 7+). */
  ratingCount?: number;
  createdAt: string;
}

/** Paginated search response. Matches frontend Paginated<Provider>. */
export interface SearchPage {
  items: SearchResultItem[];
  page: number;
  pageSize: number;
  total: number;
}
