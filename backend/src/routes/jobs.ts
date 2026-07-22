/**
 * Jobs routes — /v1/jobs/* (Stage 10)
 *
 * Public:
 *   GET  /v1/jobs                          List published jobs (filter by category, workType)
 *   GET  /v1/jobs/:id                      Get job details (published = public; draft = employer-only)
 *
 * Employer:
 *   POST /v1/jobs                          Create a draft job
 *   GET  /v1/jobs/my                       List own jobs (all statuses)
 *   PATCH /v1/jobs/:id                     Update own job (draft/published)
 *   POST /v1/jobs/:id/publish              Publish a draft job
 *   POST /v1/jobs/:id/close               Close a published job
 *   GET  /v1/jobs/:id/applications         List applications for own job
 *   PATCH /v1/jobs/applications/:appId     Update application status
 *
 * Provider:
 *   POST /v1/jobs/:id/apply                Apply to a published job
 *   GET  /v1/jobs/applications/mine        List own applications
 *
 * Security:
 *   - Employer-only endpoints check accountType === 'employer'.
 *   - Provider-only endpoints check accountType === 'provider'.
 *   - Ownership is enforced in the service layer.
 *   - All authenticated endpoints require a valid Clerk Bearer token.
 *   - Public endpoints (list, get published) require no auth.
 *   - Route ordering: fixed paths (/my, /applications/mine) before params (/:id).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import {
  requireClerkAuth,
  requireAccountType,
  optionalClerkAuth,
} from "../middleware/auth.js";
import type { Db } from "../db/client.js";
import {
  createJob,
  getJobById,
  listPublishedJobs,
  listEmployerJobs,
  updateJob,
  publishJob,
  closeJob,
  applyToJob,
  listApplicationsForJob,
  listProviderApplications,
  updateApplicationStatus,
  hasApplied,
} from "../services/jobs.js";
import { getEmployerProfileByUserId } from "../services/employer-profile.js";
import { getProviderProfileByUserId } from "../services/provider-profile.js";
import { NotFoundError, ForbiddenError } from "../errors/index.js";
import type { WorkType } from "../db/schema/jobs.js";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createJobSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(10_000),
  category: z.string().max(100).optional(),
  skills: z.array(z.string().max(100)).max(30).optional(),
  location: z.string().max(200).optional(),
  workType: z.enum(["remote", "onsite", "hybrid"]).optional(),
  budgetMin: z.number().int().min(0).optional(),
  budgetMax: z.number().int().min(0).optional(),
  currency: z.string().max(10).optional(),
  deadline: z.string().datetime({ message: "deadline must be ISO-8601" }).optional(),
});

const updateJobSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(10_000).optional(),
  category: z.string().max(100).nullable().optional(),
  skills: z.array(z.string().max(100)).max(30).optional(),
  location: z.string().max(200).nullable().optional(),
  workType: z.enum(["remote", "onsite", "hybrid"]).optional(),
  budgetMin: z.number().int().min(0).nullable().optional(),
  budgetMax: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(10).optional(),
  deadline: z.string().datetime().nullable().optional(),
});

const listJobsSchema = z.object({
  category: z.string().max(100).optional(),
  workType: z.enum(["remote", "onsite", "hybrid"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const applySchema = z.object({
  coverMessage: z.string().min(10).max(5_000),
  proposedRate: z.number().int().min(0).optional(),
  currency: z.string().max(10).optional(),
});

const updateApplicationSchema = z.object({
  status: z.enum(["pending", "reviewed", "shortlisted", "rejected", "accepted"]),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createJobsRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): Hono {
  const router = new Hono();

  const auth = requireClerkAuth(clerkAdapter, resolveUser);
  const optAuth = optionalClerkAuth(clerkAdapter, resolveUser);
  const requireEmployer = requireAccountType("employer");
  const requireProvider = requireAccountType("provider");

  // ── Helper: resolve employer profile for authenticated user ──────────────────
  async function resolveEmployerProfile(pmpUserId: string) {
    const profile = await getEmployerProfileByUserId(db, pmpUserId);
    if (!profile) throw new NotFoundError("Employer profile — create your profile first.");
    return profile;
  }

  // ── Helper: resolve provider profile for authenticated user ──────────────────
  async function resolveProviderProfile(pmpUserId: string) {
    const profile = await getProviderProfileByUserId(db, pmpUserId);
    if (!profile) throw new NotFoundError("Provider profile — create your profile first.");
    return profile;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORTANT: Fixed paths MUST be registered before parameterized paths.
  // /v1/jobs/my and /v1/jobs/applications/mine before /v1/jobs/:id
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/jobs/my
   * Employer: list own jobs (all statuses).
   */
  router.get("/v1/jobs/my", auth, requireEmployer, async (c) => {
    const { pmpUserId } = c.get("auth");
    const profile = await resolveEmployerProfile(pmpUserId);
    const result = await listEmployerJobs(db, profile.id);
    return c.json({ jobs: result });
  });

  /**
   * GET /v1/jobs/applications/mine
   * Provider: list own applications.
   */
  router.get("/v1/jobs/applications/mine", auth, requireProvider, async (c) => {
    const { pmpUserId } = c.get("auth");
    const profile = await resolveProviderProfile(pmpUserId);
    const result = await listProviderApplications(db, profile.id);
    return c.json({ applications: result });
  });

  /**
   * PATCH /v1/jobs/applications/:appId
   * Employer: update application status.
   * Fixed prefix avoids collision with /v1/jobs/:id/applications.
   */
  router.patch(
    "/v1/jobs/applications/:appId",
    auth,
    requireEmployer,
    zValidator("json", updateApplicationSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const appId = c.req.param("appId");
      const profile = await resolveEmployerProfile(pmpUserId);
      const body = c.req.valid("json");
      const result = await updateApplicationStatus(db, appId, profile.id, {
        status: body.status,
      });
      return c.json({ application: result });
    },
  );

  /**
   * GET /v1/jobs
   * Public: list published jobs.
   */
  router.get("/v1/jobs", zValidator("query", listJobsSchema), async (c) => {
    const { category, workType, limit, offset } = c.req.valid("query");
    const filter: import("../services/jobs.js").ListJobsFilter = { limit, offset };
    if (category) filter.category = category;
    if (workType) filter.workType = workType as WorkType;
    const result = await listPublishedJobs(db, filter);
    return c.json({ jobs: result, total: result.length });
  });

  /**
   * POST /v1/jobs
   * Employer: create a draft job.
   */
  router.post(
    "/v1/jobs",
    auth,
    requireEmployer,
    zValidator("json", createJobSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const profile = await resolveEmployerProfile(pmpUserId);
      const body = c.req.valid("json");
      const result = await createJob(db, profile.id, {
        title: body.title,
        description: body.description,
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.skills !== undefined ? { skills: body.skills } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.workType !== undefined ? { workType: body.workType } : {}),
        ...(body.budgetMin !== undefined ? { budgetMin: body.budgetMin } : {}),
        ...(body.budgetMax !== undefined ? { budgetMax: body.budgetMax } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
      });
      return c.json({ job: result }, 201);
    },
  );

  /**
   * GET /v1/jobs/:id
   * Public for published; employer-only for own drafts/closed.
   */
  router.get("/v1/jobs/:id", optAuth, async (c) => {
    const jobId = c.req.param("id");
    const authCtx = c.get("auth");

    let viewerEmployerProfileId: string | undefined;
    if (authCtx?.accountType === "employer") {
      const profile = await getEmployerProfileByUserId(db, authCtx.pmpUserId);
      viewerEmployerProfileId = profile?.id;
    }

    const result = await getJobById(db, jobId, viewerEmployerProfileId);
    return c.json({ job: result });
  });

  /**
   * PATCH /v1/jobs/:id
   * Employer: update own job.
   */
  router.patch(
    "/v1/jobs/:id",
    auth,
    requireEmployer,
    zValidator("json", updateJobSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const jobId = c.req.param("id");
      const profile = await resolveEmployerProfile(pmpUserId);
      const body = c.req.valid("json");
      const result = await updateJob(db, jobId, profile.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.skills !== undefined ? { skills: body.skills } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.workType !== undefined ? { workType: body.workType } : {}),
        ...(body.budgetMin !== undefined ? { budgetMin: body.budgetMin } : {}),
        ...(body.budgetMax !== undefined ? { budgetMax: body.budgetMax } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
      });
      return c.json({ job: result });
    },
  );

  /**
   * POST /v1/jobs/:id/publish
   * Employer: publish a draft job.
   */
  router.post("/v1/jobs/:id/publish", auth, requireEmployer, async (c) => {
    const { pmpUserId } = c.get("auth");
    const jobId = c.req.param("id");
    const profile = await resolveEmployerProfile(pmpUserId);
    const result = await publishJob(db, jobId, profile.id);
    return c.json({ job: result });
  });

  /**
   * POST /v1/jobs/:id/close
   * Employer: close a published job.
   */
  router.post("/v1/jobs/:id/close", auth, requireEmployer, async (c) => {
    const { pmpUserId } = c.get("auth");
    const jobId = c.req.param("id");
    const profile = await resolveEmployerProfile(pmpUserId);
    const result = await closeJob(db, jobId, profile.id);
    return c.json({ job: result });
  });

  /**
   * GET /v1/jobs/:id/applications
   * Employer: list applications for own job.
   */
  router.get("/v1/jobs/:id/applications", auth, requireEmployer, async (c) => {
    const { pmpUserId } = c.get("auth");
    const jobId = c.req.param("id");
    const profile = await resolveEmployerProfile(pmpUserId);
    const result = await listApplicationsForJob(db, jobId, profile.id);
    return c.json({ applications: result });
  });

  /**
   * POST /v1/jobs/:id/apply
   * Provider: apply to a published job.
   */
  router.post(
    "/v1/jobs/:id/apply",
    auth,
    requireProvider,
    zValidator("json", applySchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const jobId = c.req.param("id");
      const profile = await resolveProviderProfile(pmpUserId);
      const body = c.req.valid("json");
      const result = await applyToJob(db, jobId, profile.id, {
        coverMessage: body.coverMessage,
        ...(body.proposedRate !== undefined ? { proposedRate: body.proposedRate } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
      });
      return c.json({ application: result }, 201);
    },
  );

  /**
   * GET /v1/jobs/:id/has-applied
   * Provider: check if already applied to a job.
   */
  router.get("/v1/jobs/:id/has-applied", auth, requireProvider, async (c) => {
    const { pmpUserId } = c.get("auth");
    const jobId = c.req.param("id");
    const profile = await resolveProviderProfile(pmpUserId);
    const applied = await hasApplied(db, jobId, profile.id);
    return c.json({ applied });
  });

  return router;
}
