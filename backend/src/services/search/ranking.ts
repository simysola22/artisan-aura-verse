/**
 * Provider ranking service — Stage 5.
 *
 * Pure functions: no database access, no side effects, fully deterministic.
 * Every scoring component is isolated and individually testable.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RANKING FORMULA                                                          │
 * │                                                                          │
 * │ finalScore =                                                             │
 * │     textRelevanceScore    (0–30)                                         │
 * │   + verificationScore     (0–20)                                         │
 * │   + completenessRankScore (0–15)                                         │
 * │   + categoryMatchScore    (0–10)                                         │
 * │   + skillMatchScore       (0–10)                                         │
 * │   + experienceScore       (0–8)                                          │
 * │   + certificationScore    (0–4)                                          │
 * │   + portfolioScore        (0–3)                                          │
 * │   + availabilityScore     (0–5)                                          │
 * │   + locationMatchScore    (0–5)                                          │
 * │                                ─────                                     │
 * │   maximum possible             110 (used for relative ordering only)     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Design principles:
 *   - "verified" is one signal among many — a highly-complete unverified
 *     provider can still outrank a low-quality verified one.
 *   - Promotion/sponsorship is a separate future signal, never mixed into
 *     organic scoring.
 *   - Tie-breaking is deterministic: createdAt DESC, then profileId ASC.
 */

import type {
  SearchCandidate,
  SearchQuery,
  RankingExplanation,
  RankedCandidate,
  SortOption,
} from "./types.js";

// ─── Component weights ────────────────────────────────────────────────────────

const W = {
  TEXT_HEADLINE: 20,
  TEXT_ABOUT: 10,
  VERIFICATION_VERIFIED: 20,
  VERIFICATION_IN_PROGRESS: 10,
  COMPLETENESS_MAX: 15,
  CATEGORY_MATCH: 10,
  SKILL_MATCH_PER: 3,
  SKILL_MATCH_MAX: 10,
  EXPERIENCE_MAX: 8,
  CERTIFICATION: 4,
  PORTFOLIO: 3,
  AVAILABILITY_AVAILABLE: 5,
  AVAILABILITY_LIMITED: 2,
  LOCATION_MATCH: 5,
} as const;

// ─── Individual scoring functions ─────────────────────────────────────────────

/**
 * Text relevance score (0–30).
 *
 * Checks whether the search term appears in headline (higher weight) or
 * about text (lower weight). Case-insensitive. Both can contribute.
 *
 * @param q Lowercase, trimmed search query. Empty/undefined → 0.
 */
export function scoreTextRelevance(
  candidate: Pick<SearchCandidate, "headline" | "about">,
  q: string | undefined,
): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  let score = 0;
  if (candidate.headline?.toLowerCase().includes(ql)) score += W.TEXT_HEADLINE;
  if (candidate.about?.toLowerCase().includes(ql)) score += W.TEXT_ABOUT;
  return score; // max 30
}

/**
 * Verification score (0–20).
 *
 * - verified:                     20 pts
 * - in_review / additional_info_requested: 10 pts (signal of intent)
 * - unverified / rejected:         0 pts
 */
export function scoreVerification(verificationStatus: string): number {
  switch (verificationStatus) {
    case "verified":
      return W.VERIFICATION_VERIFIED;
    case "in_review":
    case "additional_info_requested":
      return W.VERIFICATION_IN_PROGRESS;
    default:
      return 0;
  }
}

/**
 * Completeness rank score (0–15).
 *
 * Maps the stored 0–100 completeness score to a 0–15 range.
 * Uses Math.round to avoid fractional scores.
 */
export function scoreCompleteness(completenessScore: number): number {
  return Math.round((completenessScore / 100) * W.COMPLETENESS_MAX);
}

/**
 * Category match score (0–10).
 *
 * Awarded only when the query includes a category filter AND the candidate's
 * primary category matches it. When no category filter is active, returns 0
 * (neither a bonus nor a penalty).
 */
export function scoreCategoryMatch(
  candidate: Pick<SearchCandidate, "primaryCategoryId">,
  queryCategoryId: string | undefined,
): { score: number; match: boolean } {
  if (!queryCategoryId) return { score: 0, match: false };
  const match = candidate.primaryCategoryId === queryCategoryId;
  return { score: match ? W.CATEGORY_MATCH : 0, match };
}

/**
 * Skill match score (0–10).
 *
 * When a search query is active, counts how many of the candidate's skills
 * contain the query string. Each matched skill contributes SKILL_MATCH_PER
 * points, capped at SKILL_MATCH_MAX.
 *
 * When a skillId hard filter is active (meaning the candidate already has that
 * skill — they passed the filter), awards the maximum skill score.
 */
export function scoreSkillMatch(
  candidate: Pick<SearchCandidate, "skills">,
  q: string | undefined,
  skillId: string | undefined,
): { score: number; matchedSkillCount: number } {
  if (skillId) {
    // Candidate passed the hard skill filter → award maximum
    return { score: W.SKILL_MATCH_MAX, matchedSkillCount: 1 };
  }
  if (!q) return { score: 0, matchedSkillCount: 0 };
  const ql = q.toLowerCase();
  const matchedCount = candidate.skills.filter((s) => s.name.toLowerCase().includes(ql)).length;
  return {
    score: Math.min(matchedCount * W.SKILL_MATCH_PER, W.SKILL_MATCH_MAX),
    matchedSkillCount: matchedCount,
  };
}

/**
 * Experience score (0–8).
 *
 * Maps years_of_experience directly to points (capped at 8).
 * Null / 0 → 0 pts.
 */
export function scoreExperience(yearsOfExperience: number | null): number {
  if (!yearsOfExperience || yearsOfExperience <= 0) return 0;
  return Math.min(yearsOfExperience, W.EXPERIENCE_MAX);
}

/**
 * Certification score (0–4).
 *
 * Binary: 4 pts if the provider has at least one certification, 0 otherwise.
 */
export function scoreCertifications(certificationCount: number): number {
  return certificationCount > 0 ? W.CERTIFICATION : 0;
}

/**
 * Portfolio score (0–3).
 *
 * Binary: 3 pts if the provider has at least one portfolio item, 0 otherwise.
 */
export function scorePortfolio(portfolioCount: number): number {
  return portfolioCount > 0 ? W.PORTFOLIO : 0;
}

/**
 * Availability score (0–5).
 *
 * - available:   5 pts (ready to take new work)
 * - limited:     2 pts (may be able to take work)
 * - unavailable: 0 pts
 */
export function scoreAvailability(availability: string): number {
  switch (availability) {
    case "available":
      return W.AVAILABILITY_AVAILABLE;
    case "limited":
      return W.AVAILABILITY_LIMITED;
    default:
      return 0;
  }
}

/**
 * Location match score (0–5).
 *
 * Awarded when a location filter is active AND the candidate's location
 * field contains the query location string (case-insensitive).
 * When no location filter is active, returns 0.
 */
export function scoreLocationMatch(
  candidateLocation: string | null,
  queryLocation: string | undefined,
): number {
  if (!queryLocation || !candidateLocation) return 0;
  return candidateLocation.toLowerCase().includes(queryLocation.toLowerCase())
    ? W.LOCATION_MATCH
    : 0;
}

// ─── Composite scorer ─────────────────────────────────────────────────────────

/**
 * Compute the full ranking explanation for a single candidate.
 *
 * This is the single source of truth for ranking. All scoring logic lives
 * here — no ranking calculations anywhere else in the codebase.
 */
export function rankCandidate(
  candidate: SearchCandidate,
  query: Pick<SearchQuery, "q" | "categoryId" | "skillId" | "location">,
): RankingExplanation {
  const textRelevanceScore = scoreTextRelevance(candidate, query.q);
  const verificationScore = scoreVerification(candidate.verificationStatus);
  const completenessRankScore = scoreCompleteness(candidate.completenessScore);
  const { score: categoryMatchScore, match: categoryMatch } = scoreCategoryMatch(
    candidate,
    query.categoryId,
  );
  const { score: skillMatchScore, matchedSkillCount } = scoreSkillMatch(
    candidate,
    query.q,
    query.skillId,
  );
  const experienceScore = scoreExperience(candidate.yearsOfExperience);
  const certificationScore = scoreCertifications(candidate.certifications.length);
  const portfolioScore = scorePortfolio(candidate.portfolio.length);
  const availabilityScore = scoreAvailability(candidate.availability);
  const locationMatchScore = scoreLocationMatch(candidate.location, query.location);

  const totalScore =
    textRelevanceScore +
    verificationScore +
    completenessRankScore +
    categoryMatchScore +
    skillMatchScore +
    experienceScore +
    certificationScore +
    portfolioScore +
    availabilityScore +
    locationMatchScore;

  return {
    textRelevanceScore,
    verificationScore,
    completenessRankScore,
    categoryMatchScore,
    skillMatchScore,
    experienceScore,
    certificationScore,
    portfolioScore,
    availabilityScore,
    locationMatchScore,
    totalScore,
    matchedSkillCount,
    categoryMatch,
  };
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Sort ranked candidates according to the requested SortOption.
 *
 * All sort functions are deterministic: tied records are always broken by
 * createdAt DESC (newer first), then profileId ASC (stable string sort).
 * This guarantees stable pagination across requests.
 */
export function sortCandidates(ranked: RankedCandidate[], sort: SortOption): RankedCandidate[] {
  const copy = [...ranked];

  switch (sort) {
    case "relevance":
      // Primary: total ranking score DESC
      // Tie: createdAt DESC, profileId ASC
      return copy.sort((a, b) => {
        const scoreDiff = b.ranking.totalScore - a.ranking.totalScore;
        if (scoreDiff !== 0) return scoreDiff;
        const dateDiff = b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.candidate.profileId.localeCompare(b.candidate.profileId);
      });

    case "newest":
      // Primary: createdAt DESC
      // Tie: total score DESC, profileId ASC
      return copy.sort((a, b) => {
        const dateDiff = b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime();
        if (dateDiff !== 0) return dateDiff;
        const scoreDiff = b.ranking.totalScore - a.ranking.totalScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.candidate.profileId.localeCompare(b.candidate.profileId);
      });

    case "completeness":
      // Primary: completenessScore DESC
      // Tie: total score DESC, profileId ASC
      return copy.sort((a, b) => {
        const compDiff = b.candidate.completenessScore - a.candidate.completenessScore;
        if (compDiff !== 0) return compDiff;
        const scoreDiff = b.ranking.totalScore - a.ranking.totalScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.candidate.profileId.localeCompare(b.candidate.profileId);
      });

    case "experience":
      // Primary: yearsOfExperience DESC (null last)
      // Tie: total score DESC, profileId ASC
      return copy.sort((a, b) => {
        const aYears = a.candidate.yearsOfExperience ?? -1;
        const bYears = b.candidate.yearsOfExperience ?? -1;
        const expDiff = bYears - aYears;
        if (expDiff !== 0) return expDiff;
        const scoreDiff = b.ranking.totalScore - a.ranking.totalScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.candidate.profileId.localeCompare(b.candidate.profileId);
      });
  }
}

// ─── Batch ranking ────────────────────────────────────────────────────────────

/**
 * Rank a batch of candidates against a query, then sort them.
 *
 * Returns all candidates — the caller is responsible for pagination.
 * This is the main entry point for the search service.
 */
export function rankAndSort(
  candidates: SearchCandidate[],
  query: Pick<SearchQuery, "q" | "categoryId" | "skillId" | "location" | "sort">,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map((candidate) => ({
    candidate,
    ranking: rankCandidate(candidate, query),
  }));
  return sortCandidates(ranked, query.sort);
}
