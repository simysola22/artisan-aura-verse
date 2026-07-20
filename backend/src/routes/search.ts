/**
 * Search routes — /v1/search/* (Stage 5).
 *
 * GET /v1/search/providers
 *   Public endpoint — no authentication required (public provider profiles only).
 *   Private providers (is_public=false) are never returned.
 *
 * Query parameters (all optional):
 *   q                 — free-text keyword search
 *   categoryId        — filter by category UUID
 *   category          — filter by category slug (alternative to categoryId)
 *   skillId           — filter by skill UUID (hard filter)
 *   providerType      — "artisan" | "professional" (maps to kind)
 *   verificationStatus — exact status string
 *   verified          — "true" shorthand for verificationStatus=verified
 *   availabilityStatus — "available" | "limited" | "unavailable"
 *   location          — substring filter on location field
 *   minExperience     — minimum years_of_experience
 *   minCompleteness   — minimum completeness score (0–100)
 *   page              — 1-based page number (default: 1)
 *   limit             — page size (default: 20, max: 50)
 *   sort              — "relevance" | "newest" | "completeness" | "experience"
 *                       Also accepts frontend aliases: "recent" → "newest", "rating" → "relevance"
 *
 * Security:
 *   - All query params validated by Zod — no raw strings passed to SQL
 *   - Sort fields are allowlisted — no arbitrary ORDER BY injection
 *   - Pagination limits are enforced server-side
 *   - No authentication bypass — is_public=true enforced in repository
 *   - No internal ranking data in response
 *   - No verification evidence or reviewer notes in response
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { searchProviders } from "../services/search/index.js";

// ─── Validation schema ────────────────────────────────────────────────────────

/**
 * Query parameter schema for GET /v1/search/providers.
 *
 * All parameters are optional — a query with no parameters returns a
 * discovery feed of public providers sorted by relevance.
 *
 * Zod coerces string query params to numbers/booleans where needed.
 * No parameter directly flows into SQL — all are validated and normalised
 * by the search service before reaching the database layer.
 */
const searchSchema = z.object({
  q: z.string().max(200).optional(),

  categoryId: z.string().uuid("categoryId must be a valid UUID").optional(),

  /** Category slug — alternative to categoryId. */
  category: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, "category slug must be lowercase alphanumeric with hyphens")
    .optional(),

  skillId: z.string().uuid("skillId must be a valid UUID").optional(),

  /** Maps to provider_profiles.kind. Spec calls this "providerType". */
  providerType: z.enum(["artisan", "professional"]).optional(),

  verificationStatus: z
    .enum(["unverified", "in_review", "additional_info_requested", "verified", "rejected"])
    .optional(),

  /** Shorthand: verified=true → verificationStatus=verified */
  verified: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  availabilityStatus: z.enum(["available", "limited", "unavailable"]).optional(),

  location: z.string().max(200).optional(),

  minExperience: z.coerce.number().int().min(0).max(50).optional(),

  minCompleteness: z.coerce.number().int().min(0).max(100).optional(),

  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(50).default(20),

  /**
   * Allowlisted sort options. Arbitrary values default to "relevance".
   * Frontend aliases ("recent", "rating") are handled by normaliseSortOption.
   */
  sort: z
    .enum(["relevance", "newest", "completeness", "experience", "recent", "rating"])
    .default("relevance"),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createSearchRouter(db: Db): Hono {
  const router = new Hono();

  /**
   * GET /v1/search/providers
   *
   * Public endpoint — no authentication required.
   * Returns a paginated, backend-ranked list of public provider profiles.
   *
   * The frontend MUST render results in the exact order returned.
   * No client-side re-ranking is expected or intended.
   */
  router.get("/v1/search/providers", zValidator("query", searchSchema), async (c) => {
    const params = c.req.valid("query");

    const result = await searchProviders(db, {
      ...(params.q !== undefined ? { q: params.q } : {}),
      ...(params.categoryId !== undefined ? { categoryId: params.categoryId } : {}),
      ...(params.category !== undefined ? { category: params.category } : {}),
      ...(params.skillId !== undefined ? { skillId: params.skillId } : {}),
      // providerType in the spec maps to kind in the schema
      ...(params.providerType !== undefined ? { kind: params.providerType } : {}),
      ...(params.verificationStatus !== undefined
        ? { verificationStatus: params.verificationStatus }
        : {}),
      ...(params.verified ? { verified: params.verified } : {}),
      ...(params.availabilityStatus !== undefined
        ? { availabilityStatus: params.availabilityStatus }
        : {}),
      ...(params.location !== undefined ? { location: params.location } : {}),
      ...(params.minExperience !== undefined ? { minExperience: params.minExperience } : {}),
      ...(params.minCompleteness !== undefined ? { minCompleteness: params.minCompleteness } : {}),
      page: params.page,
      limit: params.limit,
      sort: params.sort,
    });

    return c.json(result);
  });

  return router;
}
