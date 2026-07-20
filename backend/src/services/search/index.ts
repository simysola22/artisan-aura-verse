/**
 * Search service — Stage 5.
 *
 * Orchestrates the full search pipeline:
 *
 *   SearchQuery (validated, normalised)
 *        ↓
 *   [repository] fetchCandidates(db, query)
 *        ↓
 *   SearchCandidate[]  (bounded set, with all sub-resources pre-loaded)
 *        ↓
 *   [ranking] rankAndSort(candidates, query)
 *        ↓
 *   RankedCandidate[]  (ordered by score + sort option)
 *        ↓
 *   paginate(ranked, page, limit)
 *        ↓
 *   SearchPage  (public API response)
 *
 * The service owns:
 *   - Category slug → categoryId resolution
 *   - Input normalisation (q trimming, limit capping)
 *   - Calling the repository
 *   - Calling ranking
 *   - Pagination and DTO mapping
 *
 * The service does NOT own:
 *   - HTTP validation (that is the route handler's job)
 *   - DB queries (that is the repository's job)
 *   - Score calculation (that is the ranking module's job)
 *
 * Caching hook points (future):
 *   - Category slug→ID resolution is stable reference data → ideal cache candidate
 *   - Popular search queries with no filters → ideal cache candidate
 *   - Neither is implemented now; the functions are structured for cache wrapping
 *     without any internal changes needed.
 */

import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { categories } from "../../db/schema/index.js";
import type { SearchQuery, SearchPage, SearchResultItem, SortOption } from "./types.js";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./types.js";
import { fetchCandidates } from "./repository.js";
import { rankAndSort } from "./ranking.js";
import type { SearchCandidate } from "./types.js";

// ─── Sort option mapping ──────────────────────────────────────────────────────

/**
 * Map raw sort string from the API to an internal SortOption.
 *
 * The frontend uses "rating" and "recent" — we map those to supported
 * internal values. "rating" falls back to "relevance" since ratings do
 * not yet exist; this is documented as a future extension.
 */
export function normaliseSortOption(raw: string | undefined): SortOption {
  switch (raw) {
    case "relevance":
      return "relevance";
    case "newest":
    case "recent": // frontend alias
      return "newest";
    case "completeness":
      return "completeness";
    case "experience":
      return "experience";
    case "rating": // future — falls back to relevance until ratings exist
    default:
      return "relevance";
  }
}

// ─── Category slug resolution ─────────────────────────────────────────────────

/**
 * Resolve a category slug to a category ID.
 *
 * Returns null if the slug does not match any known category.
 * This is stable reference data — ideal candidate for future caching.
 */
export async function resolveCategorySlug(db: Db, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

// ─── Input normalisation ──────────────────────────────────────────────────────

/** Raw, unvalidated search inputs from the route handler. */
export interface RawSearchInput {
  q?: string;
  categoryId?: string;
  /** Category slug — resolved to categoryId before search. */
  category?: string;
  skillId?: string;
  kind?: string;
  verificationStatus?: string;
  /** Shorthand for verificationStatus=verified. */
  verified?: boolean;
  availabilityStatus?: string;
  location?: string;
  minExperience?: number;
  minCompleteness?: number;
  page?: number;
  limit?: number;
  sort?: string;
}

/**
 * Normalise raw inputs into a validated SearchQuery.
 *
 * Handles:
 *   - Trimming and lower-casing q
 *   - Capping limit at MAX_PAGE_SIZE
 *   - Defaulting page and limit
 *   - Resolving verified boolean to verificationStatus
 *   - Mapping sort aliases
 */
export async function normaliseSearchQuery(db: Db, raw: RawSearchInput): Promise<SearchQuery> {
  const q = raw.q?.trim().toLowerCase() || undefined;

  // Resolve category: if categoryId given, use it directly; if slug given, resolve
  let categoryId = raw.categoryId;
  if (!categoryId && raw.category) {
    const resolved = await resolveCategorySlug(db, raw.category);
    categoryId = resolved ?? undefined;
    // If slug did not resolve, ignore — don't return empty results for unknown slugs
  }

  // Verification: explicit status takes precedence over the verified boolean shorthand
  let verificationStatus = raw.verificationStatus;
  if (!verificationStatus && raw.verified === true) {
    verificationStatus = "verified";
  }

  const page = Math.max(1, raw.page ?? 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, raw.limit ?? DEFAULT_PAGE_SIZE));

  const location = raw.location?.trim() || undefined;
  const availabilityStatus = raw.availabilityStatus as
    | "available"
    | "limited"
    | "unavailable"
    | undefined;
  const kind = raw.kind as "artisan" | "professional" | undefined;
  const vs = verificationStatus as
    | "unverified"
    | "in_review"
    | "additional_info_requested"
    | "verified"
    | "rejected"
    | undefined;

  return {
    ...(q !== undefined ? { q } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(raw.skillId !== undefined ? { skillId: raw.skillId } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(vs !== undefined ? { verificationStatus: vs } : {}),
    ...(availabilityStatus !== undefined ? { availabilityStatus } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(raw.minExperience !== undefined ? { minExperience: raw.minExperience } : {}),
    ...(raw.minCompleteness !== undefined ? { minCompleteness: raw.minCompleteness } : {}),
    page,
    limit,
    sort: normaliseSortOption(raw.sort),
  };
}

// ─── DTO mapping ──────────────────────────────────────────────────────────────

function toResultItem(candidate: SearchCandidate): SearchResultItem {
  return {
    id: candidate.profileId,
    email: candidate.email ?? "",
    role: "provider",
    displayName: candidate.displayName ?? "Provider",
    ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
    kind: candidate.kind,
    headline: candidate.headline ?? "",
    ...(candidate.about ? { about: candidate.about } : {}),
    category: candidate.primaryCategoryName ?? "",
    skills: candidate.skills,
    experience: candidate.experience,
    certifications: candidate.certifications,
    portfolio: candidate.portfolio,
    verification: candidate.verificationStatus,
    ...(candidate.serviceArea ? { serviceArea: candidate.serviceArea } : {}),
    availability: candidate.availability,
    ...(candidate.hourlyRate !== null ? { hourlyRate: candidate.hourlyRate } : {}),
    ...(candidate.currency ? { currency: candidate.currency } : {}),
    // ratingAverage and ratingCount intentionally absent (Stage 7+)
    createdAt: candidate.createdAt.toISOString(),
  };
}

// ─── Main search function ─────────────────────────────────────────────────────

/**
 * Execute a provider search and return a paginated, ranked result page.
 *
 * This is the single public entry point for the search system.
 * All callers (routes, tests) go through this function.
 */
export async function searchProviders(db: Db, raw: RawSearchInput): Promise<SearchPage> {
  const query = await normaliseSearchQuery(db, raw);

  const { candidates, total } = await fetchCandidates(db, query);

  if (candidates.length === 0) {
    return {
      items: [],
      page: query.page,
      pageSize: query.limit,
      total: 0,
    };
  }

  // Rank and sort the full candidate set in application memory
  const ranked = rankAndSort(candidates, query);

  // Paginate — slice after ranking so ordering is correct
  const start = (query.page - 1) * query.limit;
  const pageItems = ranked.slice(start, start + query.limit);

  return {
    items: pageItems.map((rc) => toResultItem(rc.candidate)),
    page: query.page,
    pageSize: query.limit,
    total,
  };
}
