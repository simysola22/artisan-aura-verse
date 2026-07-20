/**
 * Ops audit log service — Stage 9.
 *
 * All writes are INSERT-only. Application code never calls UPDATE or DELETE
 * against ops_audit_log.
 */

import type { Db } from "../../db/client.js";
import { opsAuditLog, type OpsAuditAction } from "../../db/schema/index.js";
import { desc, eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppendAuditParams {
  actorId: string;
  action: OpsAuditAction;
  targetUserId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListAuditParams {
  actorId?: string;
  targetUserId?: string;
  action?: OpsAuditAction;
  limit?: number;
  offset?: number;
}

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Append one entry to the operations audit log.
 * Never throws — a logging failure must not block the primary operation.
 * If the DB write fails, the error is logged to stderr and swallowed.
 */
export async function appendOpsAudit(db: Db, params: AppendAuditParams): Promise<void> {
  try {
    await db.insert(opsAuditLog).values({
      id: crypto.randomUUID(),
      actorId: params.actorId,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
    });
  } catch (err) {
    // Audit failure must never break the primary request.
    console.error("[ops-audit] Failed to write audit entry:", err);
  }
}

/**
 * List audit log entries. Ordered newest-first.
 * Returns at most `limit` entries (default 50, max 200).
 */
export async function listOpsAudit(db: Db, params: ListAuditParams = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions = [];
  if (params.actorId !== undefined) {
    conditions.push(eq(opsAuditLog.actorId, params.actorId));
  }
  if (params.targetUserId !== undefined) {
    conditions.push(eq(opsAuditLog.targetUserId, params.targetUserId));
  }
  if (params.action !== undefined) {
    conditions.push(eq(opsAuditLog.action, params.action));
  }

  const rows = await db
    .select()
    .from(opsAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(opsAuditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r,
    metadata: r.metadata !== null ? (JSON.parse(r.metadata) as unknown) : null,
  }));
}
