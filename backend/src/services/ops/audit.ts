/**
 * Ops audit log service — Stage 9.
 *
 * All writes are INSERT-only. Application code never calls UPDATE or DELETE
 * against ops_audit_log.
 */

import type { Db } from "../../db/client.js";
import { opsAuditLog, type OpsAuditAction } from "../../db/schema/index.js";
import { desc, eq, and, gte, lte } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppendAuditParams {
  actorId: string;
  action: OpsAuditAction;
  targetUserId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  actorClerkUserId?: string;
  actorRoles?: readonly string[];
  requiredPermission?: string;
  clerkSessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorCode?: string;
}

/** Request-scoped context captured from verified Clerk/Hono state. */
export interface AuditContext {
  actorClerkUserId?: string;
  actorRoles?: readonly string[];
  requiredPermission?: string;
  clerkSessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListAuditParams {
  actorId?: string;
  targetUserId?: string;
  action?: OpsAuditAction;
  clerkSessionId?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
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
      actorClerkUserId: params.actorClerkUserId ?? null,
      actorRoles: params.actorRoles !== undefined ? JSON.stringify(params.actorRoles) : null,
      requiredPermission: params.requiredPermission ?? null,
      clerkSessionId: params.clerkSessionId ?? null,
      requestId: params.requestId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      success: params.success ?? true,
      errorCode: params.errorCode ?? null,
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
  if (params.clerkSessionId !== undefined) {
    conditions.push(eq(opsAuditLog.clerkSessionId, params.clerkSessionId));
  }
  if (params.success !== undefined) {
    conditions.push(eq(opsAuditLog.success, params.success));
  }
  if (params.from !== undefined) {
    conditions.push(gte(opsAuditLog.createdAt, params.from));
  }
  if (params.to !== undefined) {
    conditions.push(lte(opsAuditLog.createdAt, params.to));
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
    actorRoles: r.actorRoles !== null ? (JSON.parse(r.actorRoles) as string[]) : null,
  }));
}
