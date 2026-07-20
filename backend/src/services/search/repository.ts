/**
 * Search repository — PostgreSQL implementation (Stage 5).
 *
 * This is the only layer that touches the database for search.
 * It retrieves a bounded set of SearchCandidate objects that satisfy
 * the hard filters in the SearchQuery.
 *
 * Architecture contract:
 *   - Returns SearchCandidate[] — the ranking layer never sees raw DB rows.
 *   - Never applies ranking or sorting (that is the ranking layer's job).
 *   - Fetches at most CANDIDATE_FETCH_LIMIT records to bound memory usage.
 *   - Sub-resources (skills, experience, certifications, portfolio) are
 *     batch-loaded with four parallel queries — never N+1.
 *
 * Replaceability:
 *   To swap in Meilisearch/Algolia/Elasticsearch, implement a new module
 *   that exports `fetchCandidates(db, query)` returning SearchCandidate[].
 *   No other file needs to change (ranking, service, route, tests are stable).
 *
 * Tradeoff (documented):
 *   We fetch a bounded candidate set (CANDIDATE_FETCH_LIMIT = 500) and rank
 *   in the application layer. When there are more than 500 matching providers,
 *   providers beyond rank 500 are not reachable via relevance sort. The total
 *   count returned is accurate (from a separate COUNT query). This tradeoff is
 *   acceptable for the initial dataset size; a dedicated search engine removes
 *   it entirely.
 */

import { and, eq, gte, ilike, inArray, or, sql, count } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  providerProfiles,
  providerSkills,
  providerExperience,
  providerCertifications,
  providerPortfolio,
  categories,
  skills,
  users,
} from "../../db/schema/index.js";
import type { SearchQuery, SearchCandidate } from "./types.js";
import { CANDIDATE_FETCH_LIMIT } from "./types.js";
import type {
  SkillDto,
  ExperienceDto,
  CertificationDto,
  PortfolioItemDto,
} from "../provider-profile.js";

// ─── Filter builder ───────────────────────────────────────────────────────────

/**
 * Build the Drizzle WHERE conditions array for the hard filters.
 *
 * "Hard filters" are conditions that exclude candidates entirely.
 * Text relevance and partial matches are handled in the ranking layer.
 *
 * Security: all values are bound parameters via Drizzle — no raw SQL
 * string interpolation, SQL injection is structurally impossible.
 */
function buildConditions(
  query: SearchQuery,
  skillProfileIds: string[] | null,
): ReturnType<typeof and>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [
    // Only ever surface publicly-visible profiles
    eq(providerProfiles.isPublic, true),
  ];

  if (query.kind) {
    conditions.push(eq(providerProfiles.kind, query.kind));
  }

  if (query.verificationStatus) {
    conditions.push(eq(providerProfiles.verificationStatus, query.verificationStatus));
  }

  if (query.availabilityStatus) {
    conditions.push(eq(providerProfiles.availability, query.availabilityStatus));
  }

  if (query.categoryId) {
    conditions.push(eq(providerProfiles.primaryCategoryId, query.categoryId));
  }

  if (query.minExperience !== undefined && query.minExperience > 0) {
    conditions.push(gte(providerProfiles.yearsOfExperience, query.minExperience));
  }

  if (query.minCompleteness !== undefined && query.minCompleteness > 0) {
    conditions.push(gte(providerProfiles.completenessScore, query.minCompleteness));
  }

  // Location ILIKE — we pre-filter on location when the caller supplies a location
  // so the candidate set is bounded. Ranking awards additional points for the match.
  if (query.location) {
    conditions.push(ilike(providerProfiles.location, `%${query.location}%`));
  }

  // Skill filter: pre-resolved to a set of matching profile IDs
  if (skillProfileIds !== null) {
    if (skillProfileIds.length === 0) {
      // No profiles have this skill — return nothing
      conditions.push(sql`false`);
    } else {
      conditions.push(inArray(providerProfiles.id, skillProfileIds));
    }
  }

  // Text search: ILIKE on headline OR about.
  // When q is provided, only include profiles that mention the keyword in at
  // least one of these fields. Skill name matching is a ranking-only signal
  // (not a hard filter), so providers with matching skills but no headline/about
  // match will still score on skillMatchScore if they were included via the skill
  // filter above.
  //
  // Limitation (documented): this is case-insensitive substring match, not
  // semantic search. "Frontend Developer" will not match query "web developer"
  // unless the profile text contains those words. Meilisearch replacement
  // handles semantic matching.
  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(
      or(
        ilike(providerProfiles.headline, pattern),
        ilike(providerProfiles.about, pattern),
        ilike(providerProfiles.location, pattern),
      ),
    );
  }

  return conditions;
}

// ─── Batch sub-resource loader ────────────────────────────────────────────────

/**
 * Load skills, experience, certifications, and portfolio for a set of
 * profile IDs in four parallel queries.
 *
 * Never issues per-profile queries — this eliminates the N+1 problem
 * regardless of how many candidates are returned.
 */
async function batchLoadSubResources(
  db: Db,
  profileIds: string[],
): Promise<{
  skillsByProfile: Map<string, SkillDto[]>;
  experienceByProfile: Map<string, ExperienceDto[]>;
  certificationsByProfile: Map<string, CertificationDto[]>;
  portfolioByProfile: Map<string, PortfolioItemDto[]>;
}> {
  if (profileIds.length === 0) {
    return {
      skillsByProfile: new Map(),
      experienceByProfile: new Map(),
      certificationsByProfile: new Map(),
      portfolioByProfile: new Map(),
    };
  }

  const [skillRows, experienceRows, certificationRows, portfolioRows] = await Promise.all([
    // Skills via JOIN to get category name
    db
      .select({
        providerProfileId: providerSkills.providerProfileId,
        id: skills.id,
        name: skills.name,
        categoryName: categories.name,
      })
      .from(providerSkills)
      .innerJoin(skills, eq(skills.id, providerSkills.skillId))
      .innerJoin(categories, eq(categories.id, skills.categoryId))
      .where(inArray(providerSkills.providerProfileId, profileIds)),

    // Experience
    db
      .select()
      .from(providerExperience)
      .where(inArray(providerExperience.providerProfileId, profileIds))
      .orderBy(providerExperience.startDate),

    // Certifications
    db
      .select()
      .from(providerCertifications)
      .where(inArray(providerCertifications.providerProfileId, profileIds))
      .orderBy(providerCertifications.issuedAt),

    // Portfolio
    db
      .select()
      .from(providerPortfolio)
      .where(inArray(providerPortfolio.providerProfileId, profileIds))
      .orderBy(providerPortfolio.displayOrder, providerPortfolio.createdAt),
  ]);

  // Group by profile ID
  const skillsByProfile = new Map<string, SkillDto[]>();
  for (const r of skillRows) {
    const list = skillsByProfile.get(r.providerProfileId) ?? [];
    list.push({ id: r.id, name: r.name, category: r.categoryName });
    skillsByProfile.set(r.providerProfileId, list);
  }

  const experienceByProfile = new Map<string, ExperienceDto[]>();
  for (const r of experienceRows) {
    const list = experienceByProfile.get(r.providerProfileId) ?? [];
    list.push({
      id: r.id,
      role: r.role,
      organization: r.organization,
      startDate: r.startDate,
      endDate: r.endDate,
      description: r.description,
    });
    experienceByProfile.set(r.providerProfileId, list);
  }

  const certificationsByProfile = new Map<string, CertificationDto[]>();
  for (const r of certificationRows) {
    const list = certificationsByProfile.get(r.providerProfileId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      issuer: r.issuer,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
      evidenceUrl: r.evidenceUrl,
    });
    certificationsByProfile.set(r.providerProfileId, list);
  }

  const portfolioByProfile = new Map<string, PortfolioItemDto[]>();
  for (const r of portfolioRows) {
    const list = portfolioByProfile.get(r.providerProfileId) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      description: r.description,
      mediaUrl: r.mediaUrl,
      mediaType: r.mediaType,
      displayOrder: r.displayOrder,
      createdAt: r.createdAt.toISOString(),
    });
    portfolioByProfile.set(r.providerProfileId, list);
  }

  return {
    skillsByProfile,
    experienceByProfile,
    certificationsByProfile,
    portfolioByProfile,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface FetchResult {
  /** Bounded set of candidates ready for ranking (max CANDIDATE_FETCH_LIMIT). */
  candidates: SearchCandidate[];
  /**
   * Accurate total count of all matching providers (from a separate COUNT
   * query). May be larger than candidates.length when the bounded fetch limit
   * is reached.
   */
  total: number;
}

/**
 * Fetch matching provider candidates from PostgreSQL.
 *
 * Steps:
 *   1. If skillId filter active, resolve matching profile IDs first.
 *   2. If category slug provided, resolve to categoryId first.
 *   3. Build WHERE conditions and run COUNT + bounded SELECT in parallel.
 *   4. Batch-load sub-resources for all returned profiles.
 *   5. Assemble SearchCandidate objects.
 */
export async function fetchCandidates(db: Db, query: SearchQuery): Promise<FetchResult> {
  // ── Resolve skill filter to profile IDs ────────────────────────────────────
  let skillProfileIds: string[] | null = null;
  if (query.skillId) {
    const rows = await db
      .select({ profileId: providerSkills.providerProfileId })
      .from(providerSkills)
      .where(eq(providerSkills.skillId, query.skillId));
    skillProfileIds = rows.map((r) => r.profileId);
  }

  // ── Build conditions ───────────────────────────────────────────────────────
  const conditions = buildConditions(query, skillProfileIds);
  const whereClause = and(...conditions);

  // ── COUNT + bounded SELECT in parallel ─────────────────────────────────────
  const [countRows, profileRows] = await Promise.all([
    db.select({ count: count() }).from(providerProfiles).where(whereClause),

    db
      .select({
        // Profile fields
        profileId: providerProfiles.id,
        userId: providerProfiles.userId,
        kind: providerProfiles.kind,
        headline: providerProfiles.headline,
        about: providerProfiles.about,
        location: providerProfiles.location,
        serviceArea: providerProfiles.serviceArea,
        availability: providerProfiles.availability,
        yearsOfExperience: providerProfiles.yearsOfExperience,
        hourlyRate: providerProfiles.hourlyRate,
        currency: providerProfiles.currency,
        completenessScore: providerProfiles.completenessScore,
        verificationStatus: providerProfiles.verificationStatus,
        isPublic: providerProfiles.isPublic,
        primaryCategoryId: providerProfiles.primaryCategoryId,
        createdAt: providerProfiles.createdAt,
        // Primary category fields (LEFT JOIN — may be null)
        primaryCategoryName: categories.name,
        primaryCategorySlug: categories.slug,
        // User identity fields (INNER JOIN — provider_profiles always has a user)
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(providerProfiles)
      .leftJoin(categories, eq(categories.id, providerProfiles.primaryCategoryId))
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .where(whereClause)
      .limit(CANDIDATE_FETCH_LIMIT),
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  if (profileRows.length === 0) {
    return { candidates: [], total };
  }

  // ── Batch-load sub-resources ───────────────────────────────────────────────
  const profileIds = profileRows.map((r) => r.profileId);
  const { skillsByProfile, experienceByProfile, certificationsByProfile, portfolioByProfile } =
    await batchLoadSubResources(db, profileIds);

  // ── Assemble candidates ────────────────────────────────────────────────────
  const candidates: SearchCandidate[] = profileRows.map((r) => ({
    profileId: r.profileId,
    userId: r.userId,
    displayName: r.displayName,
    email: r.email,
    avatarUrl: r.avatarUrl,
    kind: r.kind as "artisan" | "professional",
    headline: r.headline,
    about: r.about,
    location: r.location,
    serviceArea: r.serviceArea,
    availability: r.availability as "available" | "limited" | "unavailable",
    yearsOfExperience: r.yearsOfExperience,
    hourlyRate: r.hourlyRate,
    currency: r.currency,
    completenessScore: r.completenessScore,
    verificationStatus: r.verificationStatus,
    isPublic: r.isPublic,
    primaryCategoryId: r.primaryCategoryId,
    primaryCategoryName: r.primaryCategoryName ?? null,
    primaryCategorySlug: r.primaryCategorySlug ?? null,
    createdAt: r.createdAt,
    skills: skillsByProfile.get(r.profileId) ?? [],
    experience: experienceByProfile.get(r.profileId) ?? [],
    certifications: certificationsByProfile.get(r.profileId) ?? [],
    portfolio: portfolioByProfile.get(r.profileId) ?? [],
  }));

  return { candidates, total };
}
