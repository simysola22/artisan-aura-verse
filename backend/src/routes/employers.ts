/**
 * Employer profile routes — /v1/employers/*
 *
 * Mutations are always scoped to the authenticated user's own profile.
 *
 * POST  /v1/employers/profile   Create own employer profile
 * GET   /v1/employers/profile   Get own employer profile
 * PATCH /v1/employers/profile   Update own employer profile
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import { requireClerkAuth } from "../middleware/auth.js";
import type { UserResolver } from "../middleware/auth.js";
import type { Db } from "../db/client.js";
import {
  createEmployerProfile,
  getEmployerProfileByUserId,
  updateEmployerProfile,
  type CreateEmployerProfileParams,
  type UpdateEmployerProfileParams,
} from "../services/employer-profile.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";

// ─── Validation schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  employerType: z.enum(["individual", "organization"]).optional(),
  displayName: z.string().min(1).max(200).optional(),
  organizationName: z.string().min(1).max(200).optional(),
  industry: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  location: z.string().min(1).max(200).optional(),
  websiteUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

const updateSchema = z.object({
  employerType: z.enum(["individual", "organization"]).optional(),
  displayName: z.string().min(1).max(200).nullable().optional(),
  organizationName: z.string().min(1).max(200).nullable().optional(),
  industry: z.string().min(1).max(100).nullable().optional(),
  description: z.string().min(1).max(2000).nullable().optional(),
  location: z.string().min(1).max(200).nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  isPublic: z.boolean().optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createEmployerRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): Hono {
  const router = new Hono();
  const auth = requireClerkAuth(clerkAdapter, resolveUser);

  function assertEmployer(accountType: string): void {
    if (accountType !== "employer") {
      throw new ForbiddenError("Only employer accounts can manage an employer profile.");
    }
  }

  /** POST /v1/employers/profile */
  router.post("/v1/employers/profile", auth, zValidator("json", createSchema), async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertEmployer(accountType);

    const body = c.req.valid("json");
    const profile = await createEmployerProfile(db, pmpUserId, body as CreateEmployerProfileParams);
    return c.json({ profile }, 201);
  });

  /** GET /v1/employers/profile */
  router.get("/v1/employers/profile", auth, async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertEmployer(accountType);

    const profile = await getEmployerProfileByUserId(db, pmpUserId);
    if (!profile) throw new NotFoundError("Employer profile");
    return c.json({ profile });
  });

  /** PATCH /v1/employers/profile */
  router.patch("/v1/employers/profile", auth, zValidator("json", updateSchema), async (c) => {
    const { pmpUserId, accountType } = c.get("auth");
    assertEmployer(accountType);

    const existing = await getEmployerProfileByUserId(db, pmpUserId);
    if (!existing) throw new NotFoundError("Employer profile");

    const body = c.req.valid("json");
    const profile = await updateEmployerProfile(
      db,
      existing.id,
      body as UpdateEmployerProfileParams,
    );
    return c.json({ profile });
  });

  return router;
}
