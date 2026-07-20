/**
 * Verification service — Stage 4.
 *
 * Owns all business logic for the verification workflow.
 * Routes never touch verification tables directly.
 *
 * Key invariants:
 *   1. Status transitions are centralised in ALLOWED_TRANSITIONS and validated by
 *      assertTransition() before any DB write — making the state machine testable
 *      without a live database.
 *   2. Internal notes are never returned in provider-facing DTOs.
 *   3. Evidence file references are URL strings — no binary data ever touches PostgreSQL.
 *   4. Every meaningful action appends a row to verification_audit_log (never updated,
 *      never deleted from the application layer).
 *   5. provider_profiles.verification_status is always derived from the latest
 *      verification case — no separate source of truth.
 *
 * Future AI/API verification:
 *   The `claimedBy` field on a case represents the current reviewer. A future
 *   automated verification provider would:
 *     - Insert a synthetic "system" actor user (or use a dedicated actor ID).
 *     - Call claimCase() and then approve/reject via the same service functions.
 *   No schema or service changes are required to add an AI provider.
 */

import { eq, desc, and, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  verificationCases,
  verificationEvidence,
  verificationNotes,
  verificationAuditLog,
  providerProfiles,
  type VerificationCaseStatus,
  type EvidenceType,
  type VerificationAuditAction,
} from "../db/schema/index.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors/index.js";

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Centralised, testable status transition map.
 *
 * To validate a transition without a DB: assertTransition(from, to).
 * This is the single source of truth — no other code checks transitions.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<VerificationCaseStatus, VerificationCaseStatus[]>
> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["info_requested", "approved", "rejected", "escalated"],
  info_requested: ["resubmitted"],
  resubmitted: ["under_review"],
  approved: [],
  rejected: [],
  escalated: ["approved", "rejected"],
};

export function isValidTransition(
  from: VerificationCaseStatus,
  to: VerificationCaseStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

function assertTransition(from: VerificationCaseStatus, to: VerificationCaseStatus): void {
  if (!isValidTransition(from, to)) {
    throw new BadRequestError(
      `Cannot transition verification case from '${from}' to '${to}'. ` +
        `Allowed from '${from}': [${(ALLOWED_TRANSITIONS[from] ?? []).join(", ")}].`,
    );
  }
}

// ─── Provider profile sync ────────────────────────────────────────────────────

/**
 * Map a verification case status to the provider_profiles.verification_status
 * that should reflect it.
 *
 * Single source of truth for the status → profile status mapping.
 * The provider profile is always derived from the case — never a separate source.
 */
function caseStatusToProfileStatus(
  caseStatus: VerificationCaseStatus,
): "unverified" | "in_review" | "additional_info_requested" | "verified" | "rejected" {
  switch (caseStatus) {
    case "draft":
      return "unverified";
    case "submitted":
    case "under_review":
    case "resubmitted":
    case "escalated":
      return "in_review";
    case "info_requested":
      return "additional_info_requested";
    case "approved":
      return "verified";
    case "rejected":
      return "rejected";
  }
}

async function syncProfileStatus(
  db: Db,
  providerProfileId: string,
  caseStatus: VerificationCaseStatus,
): Promise<void> {
  const profileStatus = caseStatusToProfileStatus(caseStatus);
  await db
    .update(providerProfiles)
    .set({ verificationStatus: profileStatus, updatedAt: new Date() })
    .where(eq(providerProfiles.id, providerProfileId));
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

async function appendAudit(
  db: Db,
  caseId: string,
  actorId: string,
  action: VerificationAuditAction,
  opts: {
    fromStatus?: VerificationCaseStatus | null;
    toStatus?: VerificationCaseStatus | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await db.insert(verificationAuditLog).values({
    id: crypto.randomUUID(),
    caseId,
    actorId,
    action,
    fromStatus: opts.fromStatus ?? null,
    toStatus: opts.toStatus ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
  });
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface EvidenceDto {
  id: string;
  evidenceType: string;
  label: string;
  fileUrl: string;
  mimeType: string | null;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  reviewerId: string;
  content: string;
  createdAt: string;
}

/** Provider-facing case DTO — never includes internal notes or reviewer details. */
export interface VerificationCaseDto {
  id: string;
  providerProfileId: string;
  status: string;
  verificationType: string;
  infoRequestMessage: string | null;
  providerResponse: string | null;
  /** Approval/rejection reason — only present on approved/rejected cases. */
  decisionReason: string | null;
  evidence: EvidenceDto[];
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reviewer-facing case DTO — includes notes, reviewer identity, and audit log. */
export interface ReviewerCaseDto extends VerificationCaseDto {
  userId: string;
  claimedBy: string | null;
  claimedAt: string | null;
  notes: NoteDto[];
  auditLog: AuditEntryDto[];
}

// ─── Internal loaders ─────────────────────────────────────────────────────────

async function loadEvidence(db: Db, caseId: string): Promise<EvidenceDto[]> {
  const rows = await db
    .select()
    .from(verificationEvidence)
    .where(and(eq(verificationEvidence.caseId, caseId), eq(verificationEvidence.isRemoved, false)))
    .orderBy(verificationEvidence.createdAt);

  return rows.map((r) => ({
    id: r.id,
    evidenceType: r.evidenceType,
    label: r.label,
    fileUrl: r.fileUrl,
    mimeType: r.mimeType,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadNotes(db: Db, caseId: string): Promise<NoteDto[]> {
  const rows = await db
    .select()
    .from(verificationNotes)
    .where(eq(verificationNotes.caseId, caseId))
    .orderBy(verificationNotes.createdAt);

  return rows.map((r) => ({
    id: r.id,
    reviewerId: r.reviewerId,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadAuditLog(db: Db, caseId: string): Promise<AuditEntryDto[]> {
  const rows = await db
    .select()
    .from(verificationAuditLog)
    .where(eq(verificationAuditLog.caseId, caseId))
    .orderBy(verificationAuditLog.createdAt);

  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    action: r.action,
    fromStatus: r.fromStatus ?? null,
    toStatus: r.toStatus ?? null,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function buildProviderDto(
  db: Db,
  row: typeof verificationCases.$inferSelect,
): Promise<VerificationCaseDto> {
  const evidence = await loadEvidence(db, row.id);
  return {
    id: row.id,
    providerProfileId: row.providerProfileId,
    status: row.status,
    verificationType: row.verificationType,
    infoRequestMessage: row.infoRequestMessage,
    providerResponse: row.providerResponse,
    decisionReason:
      row.status === "approved" || row.status === "rejected" ? row.decisionReason : null,
    evidence,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function buildReviewerDto(
  db: Db,
  row: typeof verificationCases.$inferSelect,
): Promise<ReviewerCaseDto> {
  const [evidence, notes, auditLog] = await Promise.all([
    loadEvidence(db, row.id),
    loadNotes(db, row.id),
    loadAuditLog(db, row.id),
  ]);

  return {
    id: row.id,
    providerProfileId: row.providerProfileId,
    userId: row.userId,
    status: row.status,
    verificationType: row.verificationType,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    infoRequestMessage: row.infoRequestMessage,
    providerResponse: row.providerResponse,
    decisionReason: row.decisionReason,
    evidence,
    notes,
    auditLog,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Public service API — Provider operations ─────────────────────────────────

export interface CreateCaseParams {
  verificationType: "artisan" | "professional";
}

/**
 * Create a verification case in DRAFT status.
 *
 * One active (non-terminal) case per provider profile is allowed.
 * Throws ConflictError if an active case already exists.
 */
export async function createVerificationCase(
  db: Db,
  userId: string,
  providerProfileId: string,
  params: CreateCaseParams,
): Promise<VerificationCaseDto> {
  // Check for an existing active (non-terminal) case
  const existing = await db
    .select({ id: verificationCases.id, status: verificationCases.status })
    .from(verificationCases)
    .where(
      and(
        eq(verificationCases.providerProfileId, providerProfileId),
        inArray(verificationCases.status, [
          "draft",
          "submitted",
          "under_review",
          "info_requested",
          "resubmitted",
          "escalated",
        ]),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError(
      `An active verification case (${existing[0]!.status}) already exists for this profile. ` +
        "Resolve or complete the existing case before creating a new one.",
    );
  }

  const id = crypto.randomUUID();
  await db.insert(verificationCases).values({
    id,
    providerProfileId,
    userId,
    status: "draft",
    verificationType: params.verificationType,
    claimedBy: null,
    infoRequestMessage: null,
    providerResponse: null,
    decisionReason: null,
    submittedAt: null,
    claimedAt: null,
    decidedAt: null,
  });

  await appendAudit(db, id, userId, "case_created", { toStatus: "draft" });

  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, id))
    .limit(1);

  return buildProviderDto(db, row!);
}

/**
 * Get the provider's own verification cases (most recent first).
 * Only returns cases owned by this userId.
 */
export async function getOwnCases(
  db: Db,
  userId: string,
  providerProfileId: string,
): Promise<VerificationCaseDto[]> {
  const rows = await db
    .select()
    .from(verificationCases)
    .where(
      and(
        eq(verificationCases.userId, userId),
        eq(verificationCases.providerProfileId, providerProfileId),
      ),
    )
    .orderBy(desc(verificationCases.createdAt));

  return Promise.all(rows.map((r) => buildProviderDto(db, r)));
}

/**
 * Get a single verification case by ID for the owning provider.
 * Throws ForbiddenError if the userId does not own the case.
 */
export async function getOwnCaseById(
  db: Db,
  caseId: string,
  userId: string,
): Promise<VerificationCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  if (row.userId !== userId) throw new ForbiddenError("You do not own this verification case.");

  return buildProviderDto(db, row);
}

/** Submit a DRAFT case (DRAFT → SUBMITTED). */
export async function submitCase(
  db: Db,
  caseId: string,
  userId: string,
): Promise<VerificationCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  if (row.userId !== userId) throw new ForbiddenError("You do not own this verification case.");

  assertTransition(row.status, "submitted");

  // Must have at least one piece of evidence
  const evidenceCount = await db
    .select({ id: verificationEvidence.id })
    .from(verificationEvidence)
    .where(and(eq(verificationEvidence.caseId, caseId), eq(verificationEvidence.isRemoved, false)))
    .then((r) => r.length);

  if (evidenceCount === 0) {
    throw new BadRequestError(
      "At least one piece of evidence must be added before submitting a verification case.",
    );
  }

  const now = new Date();
  await db
    .update(verificationCases)
    .set({ status: "submitted", submittedAt: now, updatedAt: now })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, userId, "case_submitted", {
    fromStatus: row.status,
    toStatus: "submitted",
  });

  await syncProfileStatus(db, row.providerProfileId, "submitted");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildProviderDto(db, updated!);
}

export interface AddEvidenceParams {
  evidenceType: EvidenceType;
  label: string;
  fileUrl: string;
  storageKey?: string;
  mimeType?: string;
}

/**
 * Add an evidence reference to a case.
 * Only permitted when the case is in DRAFT or INFO_REQUESTED status.
 */
export async function addEvidence(
  db: Db,
  caseId: string,
  userId: string,
  params: AddEvidenceParams,
): Promise<EvidenceDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  if (row.userId !== userId) throw new ForbiddenError("You do not own this verification case.");

  if (row.status !== "draft" && row.status !== "info_requested") {
    throw new BadRequestError(
      `Evidence can only be added when the case is in 'draft' or 'info_requested' status. ` +
        `Current status: '${row.status}'.`,
    );
  }

  const id = crypto.randomUUID();
  await db.insert(verificationEvidence).values({
    id,
    caseId,
    evidenceType: params.evidenceType,
    label: params.label,
    fileUrl: params.fileUrl,
    storageKey: params.storageKey ?? null,
    mimeType: params.mimeType ?? null,
    isRemoved: false,
  });

  await appendAudit(db, caseId, userId, "evidence_added", {
    metadata: { evidenceId: id, evidenceType: params.evidenceType, label: params.label },
  });

  const [created] = await db
    .select()
    .from(verificationEvidence)
    .where(eq(verificationEvidence.id, id))
    .limit(1);

  return {
    id: created!.id,
    evidenceType: created!.evidenceType,
    label: created!.label,
    fileUrl: created!.fileUrl,
    mimeType: created!.mimeType,
    createdAt: created!.createdAt.toISOString(),
  };
}

/**
 * Soft-remove an evidence item before submission.
 * Only permitted when the case is in DRAFT or INFO_REQUESTED status.
 */
export async function removeEvidence(
  db: Db,
  caseId: string,
  userId: string,
  evidenceId: string,
): Promise<void> {
  const [caseRow] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!caseRow) throw new NotFoundError("Verification case");
  if (caseRow.userId !== userId) throw new ForbiddenError("You do not own this verification case.");

  if (caseRow.status !== "draft" && caseRow.status !== "info_requested") {
    throw new BadRequestError(
      `Evidence can only be removed when the case is in 'draft' or 'info_requested' status. ` +
        `Current status: '${caseRow.status}'.`,
    );
  }

  const [evidence] = await db
    .select()
    .from(verificationEvidence)
    .where(and(eq(verificationEvidence.id, evidenceId), eq(verificationEvidence.caseId, caseId)))
    .limit(1);

  if (!evidence || evidence.isRemoved) throw new NotFoundError("Evidence item");

  await db
    .update(verificationEvidence)
    .set({ isRemoved: true })
    .where(eq(verificationEvidence.id, evidenceId));

  await appendAudit(db, caseId, userId, "evidence_removed", {
    metadata: { evidenceId },
  });
}

export interface ResubmitParams {
  providerResponse: string;
}

/**
 * Provider responds to an information request and resubmits (INFO_REQUESTED → RESUBMITTED).
 * The previous info_request_message is preserved for history.
 */
export async function resubmitCase(
  db: Db,
  caseId: string,
  userId: string,
  params: ResubmitParams,
): Promise<VerificationCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  if (row.userId !== userId) throw new ForbiddenError("You do not own this verification case.");

  assertTransition(row.status, "resubmitted");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({
      status: "resubmitted",
      providerResponse: params.providerResponse,
      submittedAt: now,
      updatedAt: now,
    })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, userId, "case_resubmitted", {
    fromStatus: row.status,
    toStatus: "resubmitted",
    metadata: { providerResponse: params.providerResponse },
  });

  await syncProfileStatus(db, row.providerProfileId, "resubmitted");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildProviderDto(db, updated!);
}

// ─── Public service API — Reviewer operations ─────────────────────────────────

export interface ListCasesFilter {
  status?: VerificationCaseStatus | VerificationCaseStatus[];
}

/** List verification cases for the review queue. Optionally filter by status. */
export async function listCases(db: Db, filter: ListCasesFilter = {}): Promise<ReviewerCaseDto[]> {
  let query = db.select().from(verificationCases).$dynamic();

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    query = query.where(inArray(verificationCases.status, statuses));
  }

  const rows = await query.orderBy(desc(verificationCases.updatedAt));
  return Promise.all(rows.map((r) => buildReviewerDto(db, r)));
}

/** Get a single case with full reviewer context (notes + audit log). */
export async function getCaseForReviewer(db: Db, caseId: string): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  return buildReviewerDto(db, row);
}

/**
 * Claim a case (SUBMITTED or RESUBMITTED → UNDER_REVIEW).
 * A case can only be claimed by one reviewer at a time.
 * If already under review by another reviewer, throws ConflictError.
 */
export async function claimCase(
  db: Db,
  caseId: string,
  reviewerId: string,
): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  assertTransition(row.status, "under_review");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({ status: "under_review", claimedBy: reviewerId, claimedAt: now, updatedAt: now })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, reviewerId, "case_claimed", {
    fromStatus: row.status,
    toStatus: "under_review",
  });

  await syncProfileStatus(db, row.providerProfileId, "under_review");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildReviewerDto(db, updated!);
}

export interface AddNoteParams {
  content: string;
}

/** Add an internal reviewer note. Never exposed to providers. */
export async function addNote(
  db: Db,
  caseId: string,
  reviewerId: string,
  params: AddNoteParams,
): Promise<NoteDto> {
  const [row] = await db
    .select({ id: verificationCases.id })
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");

  const id = crypto.randomUUID();
  await db.insert(verificationNotes).values({
    id,
    caseId,
    reviewerId,
    content: params.content,
  });

  await appendAudit(db, caseId, reviewerId, "note_added");

  return {
    id,
    reviewerId,
    content: params.content,
    createdAt: new Date().toISOString(),
  };
}

export interface RequestInfoParams {
  message: string;
}

/** Request additional information from the provider (UNDER_REVIEW → INFO_REQUESTED). */
export async function requestInfo(
  db: Db,
  caseId: string,
  reviewerId: string,
  params: RequestInfoParams,
): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  assertTransition(row.status, "info_requested");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({ status: "info_requested", infoRequestMessage: params.message, updatedAt: now })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, reviewerId, "info_requested", {
    fromStatus: row.status,
    toStatus: "info_requested",
    metadata: { message: params.message },
  });

  await syncProfileStatus(db, row.providerProfileId, "info_requested");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildReviewerDto(db, updated!);
}

export interface DecisionParams {
  reason?: string;
}

/** Approve a case (UNDER_REVIEW or ESCALATED → APPROVED). Sets provider profile to 'verified'. */
export async function approveCase(
  db: Db,
  caseId: string,
  reviewerId: string,
  params: DecisionParams = {},
): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  assertTransition(row.status, "approved");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({
      status: "approved",
      decisionReason: params.reason ?? null,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, reviewerId, "case_approved", {
    fromStatus: row.status,
    toStatus: "approved",
    ...(params.reason ? { metadata: { reason: params.reason } } : {}),
  });

  await syncProfileStatus(db, row.providerProfileId, "approved");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildReviewerDto(db, updated!);
}

/** Reject a case (UNDER_REVIEW or ESCALATED → REJECTED). Sets provider profile to 'rejected'. */
export async function rejectCase(
  db: Db,
  caseId: string,
  reviewerId: string,
  params: DecisionParams & { reason: string },
): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  assertTransition(row.status, "rejected");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({
      status: "rejected",
      decisionReason: params.reason,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, reviewerId, "case_rejected", {
    fromStatus: row.status,
    toStatus: "rejected",
    metadata: { reason: params.reason },
  });

  await syncProfileStatus(db, row.providerProfileId, "rejected");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildReviewerDto(db, updated!);
}

/** Escalate a case (UNDER_REVIEW → ESCALATED). */
export async function escalateCase(
  db: Db,
  caseId: string,
  reviewerId: string,
  params: DecisionParams = {},
): Promise<ReviewerCaseDto> {
  const [row] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!row) throw new NotFoundError("Verification case");
  assertTransition(row.status, "escalated");

  const now = new Date();
  await db
    .update(verificationCases)
    .set({
      status: "escalated",
      decisionReason: params.reason ?? null,
      updatedAt: now,
    })
    .where(eq(verificationCases.id, caseId));

  await appendAudit(db, caseId, reviewerId, "case_escalated", {
    fromStatus: row.status,
    toStatus: "escalated",
    ...(params.reason ? { metadata: { reason: params.reason } } : {}),
  });

  await syncProfileStatus(db, row.providerProfileId, "escalated");

  const [updated] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  return buildReviewerDto(db, updated!);
}
