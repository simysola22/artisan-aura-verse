/**
 * Verification routes — /v1/verification/*
 *
 * Provider endpoints:
 *   POST   /v1/verification/cases                             Create verification case
 *   GET    /v1/verification/cases                             Get own cases
 *   GET    /v1/verification/cases/:id                         Get own case by ID
 *   POST   /v1/verification/cases/:id/submit                  Submit case (DRAFT → SUBMITTED)
 *   POST   /v1/verification/cases/:id/evidence                Add evidence
 *   DELETE /v1/verification/cases/:id/evidence/:evidenceId    Remove evidence
 *   POST   /v1/verification/cases/:id/resubmit                Respond + resubmit (INFO_REQUESTED → RESUBMITTED)
 *
 * Reviewer endpoints (require verification.review or higher):
 *   GET    /v1/verification/admin/cases                       List cases (filter by status)
 *   GET    /v1/verification/admin/cases/:id                   Get case with full reviewer context
 *   POST   /v1/verification/admin/cases/:id/claim             Claim case
 *   POST   /v1/verification/admin/cases/:id/notes             Add internal note
 *   POST   /v1/verification/admin/cases/:id/request-info      Request more information
 *   POST   /v1/verification/admin/cases/:id/approve           Approve
 *   POST   /v1/verification/admin/cases/:id/reject            Reject
 *   POST   /v1/verification/admin/cases/:id/escalate          Escalate
 *
 * Security invariants:
 *   - Providers can only access their own cases (ownership enforced by service).
 *   - Internal notes are never included in provider-facing responses.
 *   - All permissions are enforced server-side via requirePermission middleware.
 *   - Reviewer endpoints use /admin/ prefix and are permission-gated.
 *   - No authorization is achieved by route hiding — every handler checks permissions.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import { requireClerkAuth, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import type { Db } from "../db/client.js";
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
} from "../services/verification.js";
import { getProviderProfileByUserId } from "../services/provider-profile.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";

// ─── Validation schemas ────────────────────────────────────────────────────────

const createCaseSchema = z.object({
  verificationType: z.enum(["artisan", "professional"]),
});

const addEvidenceSchema = z.object({
  evidenceType: z.enum([
    "cv_resume",
    "certificate",
    "work_sample",
    "portfolio_evidence",
    "employment_evidence",
    "reference",
    "identity_document",
    "other",
  ]),
  label: z.string().min(1).max(300),
  fileUrl: z.string().url("fileUrl must be a valid HTTPS URL"),
  storageKey: z.string().max(500).optional(),
  mimeType: z.string().max(100).optional(),
});

const resubmitSchema = z.object({
  providerResponse: z.string().min(1).max(5000),
});

const addNoteSchema = z.object({
  content: z.string().min(1).max(10000),
});

const requestInfoSchema = z.object({
  message: z.string().min(1).max(5000),
});

const decisionSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const listFilterSchema = z.object({
  status: z
    .enum([
      "draft",
      "submitted",
      "under_review",
      "info_requested",
      "resubmitted",
      "approved",
      "rejected",
      "escalated",
    ])
    .optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createVerificationRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): Hono {
  const router = new Hono();
  const auth = requireClerkAuth(clerkAdapter, resolveUser);

  /** Guard: caller must be a provider account type. */
  function assertProvider(accountType: string): void {
    if (accountType !== "provider") {
      throw new ForbiddenError("Only provider accounts can manage verification cases.");
    }
  }

  // ── Provider: own profile helper ─────────────────────────────────────────────

  /**
   * Resolve the provider profile for the authenticated provider.
   * Returns the profile or throws NotFoundError.
   */
  async function resolveProviderProfile(pmpUserId: string) {
    const profile = await getProviderProfileByUserId(db, pmpUserId);
    if (!profile) throw new NotFoundError("Provider profile");
    return profile;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Provider endpoints
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/verification/cases
   * Auth: provider, requires verification.submit
   */
  router.post(
    "/v1/verification/cases",
    auth,
    requirePermission("verification.submit"),
    zValidator("json", createCaseSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const profile = await resolveProviderProfile(pmpUserId);
      const body = c.req.valid("json");

      const verificationCase = await createVerificationCase(db, pmpUserId, profile.id, {
        verificationType: body.verificationType,
      });

      return c.json({ case: verificationCase }, 201);
    },
  );

  /**
   * GET /v1/verification/cases
   * Auth: provider, requires verification.submit (they can only see their own)
   */
  router.get(
    "/v1/verification/cases",
    auth,
    requirePermission("verification.submit"),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const profile = await resolveProviderProfile(pmpUserId);
      const cases = await getOwnCases(db, pmpUserId, profile.id);

      return c.json({ cases });
    },
  );

  /**
   * GET /v1/verification/cases/:id
   * Auth: provider, requires verification.submit, must own the case
   */
  router.get(
    "/v1/verification/cases/:id",
    auth,
    requirePermission("verification.submit"),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const caseId = c.req.param("id");
      const verificationCase = await getOwnCaseById(db, caseId, pmpUserId);

      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/cases/:id/submit
   * Auth: provider, requires verification.submit, must own the case
   */
  router.post(
    "/v1/verification/cases/:id/submit",
    auth,
    requirePermission("verification.submit"),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const caseId = c.req.param("id");
      const verificationCase = await submitCase(db, caseId, pmpUserId);

      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/cases/:id/evidence
   * Auth: provider, requires verification.submit, must own the case
   */
  router.post(
    "/v1/verification/cases/:id/evidence",
    auth,
    requirePermission("verification.submit"),
    zValidator("json", addEvidenceSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const caseId = c.req.param("id");
      const body = c.req.valid("json");

      const evidence = await addEvidence(db, caseId, pmpUserId, {
        evidenceType: body.evidenceType,
        label: body.label,
        fileUrl: body.fileUrl,
        ...(body.storageKey !== undefined ? { storageKey: body.storageKey } : {}),
        ...(body.mimeType !== undefined ? { mimeType: body.mimeType } : {}),
      });
      return c.json({ evidence }, 201);
    },
  );

  /**
   * DELETE /v1/verification/cases/:id/evidence/:evidenceId
   * Auth: provider, requires verification.submit, must own the case
   */
  router.delete(
    "/v1/verification/cases/:id/evidence/:evidenceId",
    auth,
    requirePermission("verification.submit"),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const caseId = c.req.param("id");
      const evidenceId = c.req.param("evidenceId");

      await removeEvidence(db, caseId, pmpUserId, evidenceId);
      return c.body(null, 204);
    },
  );

  /**
   * POST /v1/verification/cases/:id/resubmit
   * Auth: provider, requires verification.submit, must own the case
   */
  router.post(
    "/v1/verification/cases/:id/resubmit",
    auth,
    requirePermission("verification.submit"),
    zValidator("json", resubmitSchema),
    async (c) => {
      const { pmpUserId, accountType } = c.get("auth");
      assertProvider(accountType);

      const caseId = c.req.param("id");
      const body = c.req.valid("json");

      const verificationCase = await resubmitCase(db, caseId, pmpUserId, {
        providerResponse: body.providerResponse,
      });

      return c.json({ case: verificationCase });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Reviewer (admin) endpoints
  // All require at minimum verification.review permission.
  // Finer-grained permissions (approve, reject) are checked per handler.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/verification/admin/cases
   * Auth: verification.review | verification.read
   * Query: ?status=submitted (optional)
   */
  router.get(
    "/v1/verification/admin/cases",
    auth,
    requireAnyPermission("verification.review", "verification.read"),
    zValidator("query", listFilterSchema),
    async (c) => {
      const { status } = c.req.valid("query");
      const cases = await listCases(db, status ? { status } : {});
      return c.json({ cases });
    },
  );

  /**
   * GET /v1/verification/admin/cases/:id
   * Auth: verification.review | verification.read
   */
  router.get(
    "/v1/verification/admin/cases/:id",
    auth,
    requireAnyPermission("verification.review", "verification.read"),
    async (c) => {
      const caseId = c.req.param("id");
      const verificationCase = await getCaseForReviewer(db, caseId);
      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/claim
   * Auth: verification.review
   */
  router.post(
    "/v1/verification/admin/cases/:id/claim",
    auth,
    requirePermission("verification.review"),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const verificationCase = await claimCase(db, caseId, pmpUserId);
      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/notes
   * Auth: verification.review
   */
  router.post(
    "/v1/verification/admin/cases/:id/notes",
    auth,
    requirePermission("verification.review"),
    zValidator("json", addNoteSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const body = c.req.valid("json");
      const note = await addNote(db, caseId, pmpUserId, { content: body.content });
      return c.json({ note }, 201);
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/request-info
   * Auth: verification.request_info
   */
  router.post(
    "/v1/verification/admin/cases/:id/request-info",
    auth,
    requirePermission("verification.request_info"),
    zValidator("json", requestInfoSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const body = c.req.valid("json");
      const verificationCase = await requestInfo(db, caseId, pmpUserId, {
        message: body.message,
      });
      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/approve
   * Auth: verification.approve
   */
  router.post(
    "/v1/verification/admin/cases/:id/approve",
    auth,
    requirePermission("verification.approve"),
    zValidator("json", decisionSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const body = c.req.valid("json");
      const verificationCase = await approveCase(db, caseId, pmpUserId, {
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
      });
      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/reject
   * Auth: verification.reject
   */
  router.post(
    "/v1/verification/admin/cases/:id/reject",
    auth,
    requirePermission("verification.reject"),
    zValidator("json", rejectSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const body = c.req.valid("json");
      const verificationCase = await rejectCase(db, caseId, pmpUserId, {
        reason: body.reason,
      });
      return c.json({ case: verificationCase });
    },
  );

  /**
   * POST /v1/verification/admin/cases/:id/escalate
   * Auth: verification.review (any reviewer can escalate)
   */
  router.post(
    "/v1/verification/admin/cases/:id/escalate",
    auth,
    requirePermission("verification.review"),
    zValidator("json", decisionSchema),
    async (c) => {
      const { pmpUserId } = c.get("auth");
      const caseId = c.req.param("id");
      const body = c.req.valid("json");
      const verificationCase = await escalateCase(db, caseId, pmpUserId, {
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
      });
      return c.json({ case: verificationCase });
    },
  );

  return router;
}
