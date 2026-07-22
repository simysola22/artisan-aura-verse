/**
 * Provider profile routes — /v1/providers/*
 *
 * All mutations are scoped to the authenticated user's own profile.
 * Ownership is enforced by loading the profile via auth.pmpUserId,
 * never by trusting a client-supplied ID for mutations.
 *
 * POST   /v1/providers/profile                    Create own provider profile
 * GET    /v1/providers/profile                    Get own provider profile
 * PATCH  /v1/providers/profile                    Update own provider profile
 * POST   /v1/providers/profile/experience         Add experience entry
 * DELETE /v1/providers/profile/experience/:id     Remove experience entry
 * POST   /v1/providers/profile/certifications     Add certification
 * DELETE /v1/providers/profile/certifications/:id Remove certification
 * POST   /v1/providers/profile/portfolio          Add portfolio item
 * DELETE /v1/providers/profile/portfolio/:id      Remove portfolio item
 * GET    /v1/providers/:profileId                 Get public provider profile
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import { requireClerkAuth, optionalClerkAuth } from "../middleware/auth.js";
import type { UserResolver } from "../middleware/auth.js";
import type { Db } from "../db/client.js";
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
  type CreateProviderProfileParams,
  type UpdateProviderProfileParams,
  type AddExperienceParams,
  type AddCertificationParams,
  type AddPortfolioItemParams,
} from "../services/provider-profile.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";

// ─── Validation schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  kind: z.enum(["artisan", "professional"]),
  headline: z.string().min(1).max(200).optional(),
  about: z.string().min(1).max(2000).optional(),
  primaryCategoryId: z.string().optional(),
  location: z.string().min(1).max(200).optional(),
  serviceArea: z.string().min(1).max(200).optional(),
  availability: z.enum(["available", "limited", "unavailable"]).optional(),
  yearsOfExperience: z.number().int().min(0).max(60).optional(),
  hourlyRate: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  isPublic: z.boolean().optional(),
});

const updateSchema = z.object({
  headline: z.string().min(1).max(200).nullable().optional(),
  about: z.string().min(1).max(2000).nullable().optional(),
  primaryCategoryId: z.string().nullable().optional(),
  location: z.string().min(1).max(200).nullable().optional(),
  serviceArea: z.string().min(1).max(200).nullable().optional(),
  availability: z.enum(["available", "limited", "unavailable"]).optional(),
  yearsOfExperience: z.number().int().min(0).max(60).nullable().optional(),
  hourlyRate: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).optional(),
  isPublic: z.boolean().optional(),
  /** Replaces the full skill set when provided. */
  skillIds: z.array(z.string()).optional(),
});

const experienceSchema = z.object({
  role: z.string().min(1).max(200),
  organization: z.string().min(1).max(200),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  description: z.string().max(1000).nullable().optional(),
});

const certificationSchema = z.object({
  name: z.string().min(1).max(200),
  issuer: z.string().min(1).max(200),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "issuedAt must be YYYY-MM-DD"),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expiresAt must be YYYY-MM-DD")
    .nullable()
    .optional(),
  evidenceUrl: z.string().url().nullable().optional(),
});

const portfolioSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  mediaUrl: z.string().url("mediaUrl must be a valid URL"),
  mediaType: z.enum(["image", "video", "document"]).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createProviderRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): Hono {
  const router = new Hono();
  const auth = requireClerkAuth(clerkAdapter, resolveUser);

  /** Guard: caller must be a provider account type. */
  function assertProvider(accountType: string): void {
    if (accountType !== "provider") {
      throw new ForbiddenError("Only provider accounts can manage a provider profile.");
    }
  }

  // ── Own profile ─────────────────────────────────────────────────────────────

  /** POST /v1/providers/profile — Create own provider profile. */
  router.post("/v1/providers/profile", auth, zValidator("json", createSchema), async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const body = c.req.valid("json");
    const profile = await createProviderProfile(db, pmpUserId, body as CreateProviderProfileParams);
    return c.json({ profile }, 201);
  });

  /** GET /v1/providers/profile — Get own provider profile. */
  router.get("/v1/providers/profile", auth, async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const profile = await getProviderProfileByUserId(db, pmpUserId);
    if (!profile) throw new NotFoundError("Provider profile");
    return c.json({ profile });
  });

  /** PATCH /v1/providers/profile — Update own provider profile. */
  router.patch("/v1/providers/profile", auth, zValidator("json", updateSchema), async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const existing = await getProviderProfileByUserId(db, pmpUserId);
    if (!existing) throw new NotFoundError("Provider profile");

    const body = c.req.valid("json");
    const profile = await updateProviderProfile(
      db,
      existing.id,
      body as UpdateProviderProfileParams,
    );
    return c.json({ profile });
  });

  // ── Experience ──────────────────────────────────────────────────────────────

  /** POST /v1/providers/profile/experience */
  router.post(
    "/v1/providers/profile/experience",
    auth,
    zValidator("json", experienceSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const existing = await getProviderProfileByUserId(db, pmpUserId);
      if (!existing) throw new NotFoundError("Provider profile");

      const body = c.req.valid("json");
      const experience = await addExperience(db, existing.id, body as AddExperienceParams);
      return c.json({ experience }, 201);
    },
  );

  /** DELETE /v1/providers/profile/experience/:id */
  router.delete("/v1/providers/profile/experience/:id", auth, async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const existing = await getProviderProfileByUserId(db, pmpUserId);
    if (!existing) throw new NotFoundError("Provider profile");

    const experienceId = c.req.param("id");
    await removeExperience(db, existing.id, experienceId);
    return c.body(null, 204);
  });

  // ── Certifications ──────────────────────────────────────────────────────────

  /** POST /v1/providers/profile/certifications */
  router.post(
    "/v1/providers/profile/certifications",
    auth,
    zValidator("json", certificationSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const existing = await getProviderProfileByUserId(db, pmpUserId);
      if (!existing) throw new NotFoundError("Provider profile");

      const body = c.req.valid("json");
      const certification = await addCertification(db, existing.id, body as AddCertificationParams);
      return c.json({ certification }, 201);
    },
  );

  /** DELETE /v1/providers/profile/certifications/:id */
  router.delete("/v1/providers/profile/certifications/:id", auth, async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const existing = await getProviderProfileByUserId(db, pmpUserId);
    if (!existing) throw new NotFoundError("Provider profile");

    const certificationId = c.req.param("id");
    await removeCertification(db, existing.id, certificationId);
    return c.body(null, 204);
  });

  // ── Portfolio ───────────────────────────────────────────────────────────────

  /** POST /v1/providers/profile/portfolio */
  router.post(
    "/v1/providers/profile/portfolio",
    auth,
    zValidator("json", portfolioSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const existing = await getProviderProfileByUserId(db, pmpUserId);
      if (!existing) throw new NotFoundError("Provider profile");

      const body = c.req.valid("json");
      const item = await addPortfolioItem(db, existing.id, body as AddPortfolioItemParams);
      return c.json({ item }, 201);
    },
  );

  /** DELETE /v1/providers/profile/portfolio/:id */
  router.delete("/v1/providers/profile/portfolio/:id", auth, async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertProvider(accountType);

    const existing = await getProviderProfileByUserId(db, pmpUserId);
    if (!existing) throw new NotFoundError("Provider profile");

    const itemId = c.req.param("id");
    await removePortfolioItem(db, existing.id, itemId);
    return c.body(null, 204);
  });

  // ── Public profile ──────────────────────────────────────────────────────────

  /**
   * GET /v1/providers/:profileId
   *
   * Returns a public provider profile. No auth required.
   * Only returns profiles where is_public = true (public access).
   * Authenticated owners can also see their own private profiles.
   */
  router.get("/v1/providers/:profileId", optionalClerkAuth(clerkAdapter, resolveUser), async (c) => {
    const authCtx = c.get("auth");
    const profileId = c.req.param("profileId");

    const profile = await getProviderProfileById(db, profileId);
    if (!profile) throw new NotFoundError("Provider profile");

    // Owners can always see their own profile; others only see public profiles
    if (!profile.isPublic && profile.userId !== authCtx?.pmpUserId) {
      throw new NotFoundError("Provider profile");
    }

    return c.json({ profile });
  });

  return router;
}
