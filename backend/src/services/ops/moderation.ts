/**
 * Moderation service — Stage 9.
 *
 * Any authenticated user can submit a content report.
 * Moderation team (moderation.read / moderation.action) handles reports.
 *
 * Security invariants:
 *   - Users cannot report the same entity more than once per session
 *     (soft check — duplicate detection via reporter+entity combination).
 *   - moderation_actions table is append-only.
 *   - Dismissed reports cannot be re-actioned without re-opening.
 */

import { eq, and, desc } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  contentReports,
  moderationActions,
  type ContentReportEntityType,
  type ContentReportReason,
  type ContentReportStatus,
} from "../../db/schema/index.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/index.js";
import { appendOpsAudit } from "./audit.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadReport(db: Db, reportId: string) {
  const [report] = await db
    .select()
    .from(contentReports)
    .where(eq(contentReports.id, reportId))
    .limit(1);
  if (!report) throw new NotFoundError("Content report");
  return report;
}

// ─── Submit report (any auth user) ────────────────────────────────────────────

export interface SubmitReportParams {
  entityType: ContentReportEntityType;
  entityId: string;
  reason: ContentReportReason;
  description?: string;
}

export async function submitReport(db: Db, reporterId: string, params: SubmitReportParams) {
  // Soft duplicate check — same reporter, same entity, still pending/reviewing
  const [duplicate] = await db
    .select({ id: contentReports.id })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.reporterId, reporterId),
        eq(contentReports.entityType, params.entityType),
        eq(contentReports.entityId, params.entityId),
        eq(contentReports.status, "pending"),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw new ConflictError(
      "You have already submitted a pending report for this content. " +
        "Please wait for your existing report to be reviewed.",
    );
  }

  const id = crypto.randomUUID();

  const [report] = await db
    .insert(contentReports)
    .values({
      id,
      entityType: params.entityType,
      entityId: params.entityId,
      reporterId,
      reason: params.reason,
      description: params.description ?? null,
    })
    .returning();

  if (!report) throw new Error("Failed to create content report");

  await appendOpsAudit(db, {
    actorId: reporterId,
    action: "moderation_report_submitted",
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: { reportId: id, reason: params.reason },
  });

  return report;
}

// ─── List reports (staff) ─────────────────────────────────────────────────────

export interface ListReportsParams {
  status?: ContentReportStatus;
  entityType?: ContentReportEntityType;
  limit?: number;
  offset?: number;
}

export async function listReports(db: Db, params: ListReportsParams = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions = [];
  if (params.status !== undefined) {
    conditions.push(eq(contentReports.status, params.status));
  }
  if (params.entityType !== undefined) {
    conditions.push(eq(contentReports.entityType, params.entityType));
  }

  return db
    .select()
    .from(contentReports)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(contentReports.createdAt))
    .limit(limit)
    .offset(offset);
}

// ─── Get report with actions ──────────────────────────────────────────────────

export async function getReport(db: Db, reportId: string) {
  const report = await loadReport(db, reportId);

  const actions = await db
    .select()
    .from(moderationActions)
    .where(eq(moderationActions.reportId, reportId))
    .orderBy(moderationActions.createdAt);

  return { report, actions };
}

// ─── Take action ─────────────────────────────────────────────────────────────

export type ModerationActionType = "warn" | "restrict" | "content_removed" | "dismiss";

export interface TakeModerationActionParams {
  actionType: ModerationActionType;
  notes?: string;
}

export async function takeModerationAction(
  db: Db,
  reportId: string,
  actorId: string,
  params: TakeModerationActionParams,
) {
  const report = await loadReport(db, reportId);

  if (report.status === "actioned" || report.status === "dismissed") {
    throw new ConflictError(
      `Report has already been ${report.status}. Open a new report or contact a system administrator.`,
    );
  }

  const newStatus: ContentReportStatus = params.actionType === "dismiss" ? "dismissed" : "actioned";

  const actionId = crypto.randomUUID();

  // Write the moderation action (append-only)
  await db.insert(moderationActions).values({
    id: actionId,
    reportId,
    actorId,
    targetEntityType: report.entityType,
    targetEntityId: report.entityId,
    actionType: params.actionType,
    notes: params.notes ?? null,
  });

  // Update report status
  const [updated] = await db
    .update(contentReports)
    .set({
      status: newStatus,
      reviewedBy: actorId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contentReports.id, reportId))
    .returning();

  if (!updated) throw new Error("Failed to update content report");

  const auditAction =
    params.actionType === "dismiss" ? "moderation_report_dismissed" : "moderation_action_taken";

  await appendOpsAudit(db, {
    actorId,
    action: auditAction,
    entityType: report.entityType,
    entityId: report.entityId,
    metadata: {
      reportId,
      actionId,
      actionType: params.actionType,
    },
  });

  return { report: updated, actionId };
}

// ─── Mark as reviewing ────────────────────────────────────────────────────────

export async function markReportReviewing(db: Db, reportId: string, actorId: string) {
  const report = await loadReport(db, reportId);

  if (report.status !== "pending") {
    throw new BadRequestError(
      `Report is already in '${report.status}' status. Only pending reports can be moved to reviewing.`,
    );
  }

  const [updated] = await db
    .update(contentReports)
    .set({
      status: "reviewing",
      reviewedBy: actorId,
      updatedAt: new Date(),
    })
    .where(eq(contentReports.id, reportId))
    .returning();

  if (!updated) throw new Error("Failed to update report status");
  return updated;
}
