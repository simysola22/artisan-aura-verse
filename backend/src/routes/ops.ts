/**
 * Operations routes — /v1/ops/*
 *
 * User management (requires users.read / users.manage):
 *   GET    /v1/ops/users                           List users (filterable)
 *   GET    /v1/ops/users/:id                        Get user with roles
 *   POST   /v1/ops/users/:id/suspend               Suspend account
 *   POST   /v1/ops/users/:id/reactivate            Reactivate account
 *   DELETE /v1/ops/users/:id                        Soft-delete account
 *   POST   /v1/ops/users/:id/roles                  Assign role
 *   DELETE /v1/ops/users/:id/roles/:roleId          Remove role
 *   GET    /v1/ops/roles                            List all roles + permissions
 *
 * Support tickets:
 *   POST   /v1/ops/support/tickets                  Create ticket (any auth user)
 *   GET    /v1/ops/support/tickets                  List all tickets (support.read)
 *   GET    /v1/ops/support/tickets/mine             Own tickets (any auth user)
 *   GET    /v1/ops/support/tickets/:id              View ticket
 *   POST   /v1/ops/support/tickets/:id/messages     Add message
 *   POST   /v1/ops/support/tickets/:id/assign       Assign ticket (support.manage)
 *   POST   /v1/ops/support/tickets/:id/close        Close/resolve ticket (support.respond)
 *
 * Moderation:
 *   POST   /v1/ops/moderation/reports               Submit report (any auth user)
 *   GET    /v1/ops/moderation/reports               List reports (moderation.read)
 *   GET    /v1/ops/moderation/reports/:id           Get report + actions (moderation.read)
 *   POST   /v1/ops/moderation/reports/:id/review    Mark reviewing (moderation.review)
 *   POST   /v1/ops/moderation/reports/:id/action    Take action (moderation.action)
 *
 * Audit log:
 *   GET    /v1/ops/audit                            List audit entries (system.manage)
 *
 * Overview dashboard:
 *   GET    /v1/ops/overview                         Aggregated stats (any ops permission)
 *
 * Security invariants:
 *   - Every endpoint requires authentication via requireClerkAuth.
 *   - Every endpoint requires at minimum one explicit permission check.
 *   - Frontend role/permission visibility is never a substitute for server-side checks.
 *   - Role assignment prevents self-escalation and privilege escalation at the service layer.
 *   - Internal support messages are filtered server-side based on caller permission.
 *   - All sensitive actions are recorded in ops_audit_log.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, count, sql } from "drizzle-orm";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import { requireClerkAuth, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import type { Db } from "../db/client.js";
import { users, supportTickets, contentReports, verificationCases } from "../db/schema/index.js";
import {
  listUsers,
  getUserWithRoles,
  suspendUser,
  reactivateUser,
  deleteUser,
  assignRole,
  removeRole,
  listRoles,
} from "../services/ops/users.js";
import {
  createTicket,
  listTickets,
  getOwnTickets,
  getTicket,
  addMessage,
  assignTicket,
  closeTicket,
} from "../services/ops/support.js";
import {
  submitReport,
  listReports,
  getReport,
  markReportReviewing,
  takeModerationAction,
} from "../services/ops/moderation.js";
import { listOpsAudit, type AuditContext } from "../services/ops/audit.js";

// ─── Validation schemas ───────────────────────────────────────────────────────

const listUsersSchema = z.object({
  accountType: z
    .enum([
      "employer",
      "provider",
      "owner",
      "system_admin",
      "verification_team",
      "support_team",
      "moderation_team",
    ])
    .optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const suspendSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
});

const assignRoleSchema = z.object({
  roleId: z.string().min(1).max(100),
});

const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(["billing", "account", "verification", "technical", "other"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

const listTicketsSchema = z.object({
  status: z.enum(["open", "assigned", "resolved", "closed"]).optional(),
  category: z.enum(["billing", "account", "verification", "technical", "other"]).optional(),
  assignedTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const addMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  isInternal: z.boolean().optional(),
});

const assignTicketSchema = z.object({
  assigneeId: z.string().min(1),
});

const closeTicketSchema = z.object({
  resolution: z.enum(["resolved", "closed"]).optional(),
});

const submitReportSchema = z.object({
  entityType: z.enum(["provider_profile", "message", "user"]),
  entityId: z.string().min(1).max(200),
  reason: z.enum(["spam", "harassment", "inappropriate", "fraud", "other"]),
  description: z.string().max(2000).optional(),
});

const listReportsSchema = z.object({
  status: z.enum(["pending", "reviewing", "actioned", "dismissed"]).optional(),
  entityType: z.enum(["provider_profile", "message", "user"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const moderationActionSchema = z.object({
  actionType: z.enum(["warn", "restrict", "content_removed", "dismiss"]),
  notes: z.string().max(2000).optional(),
});

const listAuditSchema = z.object({
  actorId: z.string().optional(),
  targetUserId: z.string().optional(),
  action: z
    .enum([
      "role_assigned",
      "role_removed",
      "user_suspended",
      "user_reactivated",
      "user_deleted",
      "support_ticket_created",
      "support_ticket_assigned",
      "support_ticket_closed",
      "moderation_report_submitted",
      "moderation_action_taken",
      "moderation_report_dismissed",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Remove keys whose value is `undefined` from an object.
 * Needed because zod's `.optional()` produces `T | undefined` for each optional
 * field, but service interfaces use exact optional properties (no explicit `undefined`).
 * With `exactOptionalPropertyTypes: true` these are incompatible; stripping the
 * undefined values at the boundary makes the types line up.
 */
type WithoutUndefined<T> = { [K in keyof T]: Exclude<T[K], undefined> };
function compact<T extends object>(obj: T): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as WithoutUndefined<T>;
}

/**
 * Build a fully-attributed AuditContext from the current Hono request context.
 * Only includes fields that are actually present — undefined values are omitted
 * so the object is compatible with `exactOptionalPropertyTypes`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAuditContext(c: any, clerkUserId: string, sessionId: string | undefined, roleNames: string[], requiredPermission?: string): AuditContext {
  const ctx: AuditContext = {
    actorClerkUserId: clerkUserId,
    actorRoles: roleNames,
  };
  if (requiredPermission !== undefined) ctx.requiredPermission = requiredPermission;
  if (sessionId !== undefined) ctx.clerkSessionId = sessionId;
  const requestId = c.get("requestId") as string | undefined;
  if (requestId !== undefined) ctx.requestId = requestId;
  const ip = (c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip")) as string | undefined;
  if (ip !== undefined) ctx.ipAddress = ip;
  const ua = c.req.header("user-agent") as string | undefined;
  if (ua !== undefined) ctx.userAgent = ua;
  return ctx;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createOpsRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): Hono {
  const router = new Hono();
  const auth = requireClerkAuth(clerkAdapter, resolveUser);

  // ── User management ──────────────────────────────────────────────────────────

  /**
   * GET /v1/ops/users
   * Auth: users.read
   */
  router.get(
    "/v1/ops/users",
    auth,
    requirePermission("users.read"),
    zValidator("query", listUsersSchema),
    async (c) => {
      const query = c.req.valid("query");
      const result = await listUsers(db, compact(query));
      return c.json({ users: result });
    },
  );

  /**
   * GET /v1/ops/roles
   * Auth: system.manage
   */
  router.get("/v1/ops/roles", auth, requirePermission("system.manage"), async (c) => {
    const result = await listRoles(db);
    return c.json({ roles: result });
  });

  /**
   * GET /v1/ops/users/:id
   * Auth: users.read
   */
  router.get("/v1/ops/users/:id", auth, requirePermission("users.read"), async (c) => {
    const userId = c.req.param("id");
    const result = await getUserWithRoles(db, userId);
    return c.json({ user: result });
  });

  /**
   * POST /v1/ops/users/:id/suspend
   * Auth: users.manage
   */
  router.post(
    "/v1/ops/users/:id/suspend",
    auth,
    requirePermission("users.manage"),
    zValidator("json", suspendSchema),
    async (c) => {
      const { pmpUserId, accountType, clerkUserId, sessionId, roleNames } = c.get("auth");
      const targetId = c.req.param("id");
      const body = c.req.valid("json");
      await suspendUser(db, targetId, pmpUserId, accountType, body.reason, buildAuditContext(c, clerkUserId, sessionId, roleNames, "users.manage"));
      return c.json({ ok: true });
    },
  );

  /**
   * POST /v1/ops/users/:id/reactivate
   * Auth: users.manage
   */
  router.post(
    "/v1/ops/users/:id/reactivate",
    auth,
    requirePermission("users.manage"),
    async (c) => {
      const { pmpUserId, accountType, clerkUserId, sessionId, roleNames } = c.get("auth");
      const targetId = c.req.param("id");
      await reactivateUser(db, targetId, pmpUserId, accountType, buildAuditContext(c, clerkUserId, sessionId, roleNames, "users.manage"));
      return c.json({ ok: true });
    },
  );

  /**
   * DELETE /v1/ops/users/:id
   * Auth: users.manage
   */
  router.delete("/v1/ops/users/:id", auth, requirePermission("users.manage"), async (c) => {
    const { pmpUserId, accountType, clerkUserId, sessionId, roleNames } = c.get("auth");
    const targetId = c.req.param("id");
    await deleteUser(db, targetId, pmpUserId, accountType, buildAuditContext(c, clerkUserId, sessionId, roleNames, "users.manage"));
    return c.body(null, 204);
  });

  /**
   * POST /v1/ops/users/:id/roles
   * Auth: system.manage
   */
  router.post(
    "/v1/ops/users/:id/roles",
    auth,
    requirePermission("system.manage"),
    zValidator("json", assignRoleSchema),
    async (c) => {
      const { pmpUserId, accountType, clerkUserId, sessionId, roleNames } = c.get("auth");
      const targetId = c.req.param("id");
      const { roleId } = c.req.valid("json");
      await assignRole(db, targetId, roleId, pmpUserId, accountType, buildAuditContext(c, clerkUserId, sessionId, roleNames, "system.manage"));
      return c.json({ ok: true }, 201);
    },
  );

  /**
   * DELETE /v1/ops/users/:id/roles/:roleId
   * Auth: system.manage
   */
  router.delete(
    "/v1/ops/users/:id/roles/:roleId",
    auth,
    requirePermission("system.manage"),
    async (c) => {
      const { pmpUserId, accountType, clerkUserId, sessionId, roleNames } = c.get("auth");
      const targetId = c.req.param("id");
      const roleId = c.req.param("roleId");
      await removeRole(db, targetId, roleId, pmpUserId, accountType, buildAuditContext(c, clerkUserId, sessionId, roleNames, "system.manage"));
      return c.body(null, 204);
    },
  );

  // ── Support tickets ──────────────────────────────────────────────────────────

  /**
   * POST /v1/ops/support/tickets
   * Auth: any authenticated user
   */
  router.post(
    "/v1/ops/support/tickets",
    auth,
    zValidator("json", createTicketSchema),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const body = c.req.valid("json");
      const ticket = await createTicket(db, pmpUserId, compact(body), buildAuditContext(c, clerkUserId, sessionId, roleNames));
      return c.json({ ticket }, 201);
    },
  );

  /**
   * GET /v1/ops/support/tickets
   * Auth: support.read (staff — sees all tickets)
   */
  router.get(
    "/v1/ops/support/tickets",
    auth,
    requirePermission("support.read"),
    zValidator("query", listTicketsSchema),
    async (c) => {
      const query = c.req.valid("query");
      const tickets = await listTickets(db, compact(query));
      return c.json({ tickets });
    },
  );

  /**
   * GET /v1/ops/support/tickets/mine
   * Auth: any authenticated user (own tickets only)
   */
  router.get("/v1/ops/support/tickets/mine", auth, async (c) => {
    const { pmpUserId } = c.get("auth");
    const tickets = await getOwnTickets(db, pmpUserId);
    return c.json({ tickets });
  });

  /**
   * GET /v1/ops/support/tickets/:id
   * Auth: any authenticated user (own) or support.read (staff)
   */
  router.get("/v1/ops/support/tickets/:id", auth, async (c) => {
    const { pmpUserId, permissions } = c.get("auth");
    const ticketId = c.req.param("id");
    const isStaff = permissions.has("support.read");
    const result = await getTicket(db, ticketId, pmpUserId, isStaff);
    return c.json(result);
  });

  /**
   * POST /v1/ops/support/tickets/:id/messages
   * Auth: any authenticated user (own ticket) or support.respond (staff)
   */
  router.post(
    "/v1/ops/support/tickets/:id/messages",
    auth,
    zValidator("json", addMessageSchema),
    async (c) => {
      const { pmpUserId, permissions } = c.get("auth");
      const ticketId = c.req.param("id");
      const body = c.req.valid("json");
      const isStaff = permissions.has("support.respond");
      const isInternal = body.isInternal === true;
      const message = await addMessage(db, ticketId, pmpUserId, body.content, isInternal, isStaff);
      return c.json({ message }, 201);
    },
  );

  /**
   * POST /v1/ops/support/tickets/:id/assign
   * Auth: support.manage
   */
  router.post(
    "/v1/ops/support/tickets/:id/assign",
    auth,
    requirePermission("support.manage"),
    zValidator("json", assignTicketSchema),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const ticketId = c.req.param("id");
      const { assigneeId } = c.req.valid("json");
      const ticket = await assignTicket(db, ticketId, assigneeId, pmpUserId, buildAuditContext(c, clerkUserId, sessionId, roleNames, "support.manage"));
      return c.json({ ticket });
    },
  );

  /**
   * POST /v1/ops/support/tickets/:id/close
   * Auth: support.respond
   */
  router.post(
    "/v1/ops/support/tickets/:id/close",
    auth,
    requirePermission("support.respond"),
    zValidator("json", closeTicketSchema),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const ticketId = c.req.param("id");
      const body = c.req.valid("json");
      const ticket = await closeTicket(db, ticketId, pmpUserId, body.resolution ?? "resolved", buildAuditContext(c, clerkUserId, sessionId, roleNames, "support.respond"));
      return c.json({ ticket });
    },
  );

  // ── Moderation ───────────────────────────────────────────────────────────────

  /**
   * POST /v1/ops/moderation/reports
   * Auth: any authenticated user
   */
  router.post(
    "/v1/ops/moderation/reports",
    auth,
    zValidator("json", submitReportSchema),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const body = c.req.valid("json");
      const report = await submitReport(db, pmpUserId, compact(body), buildAuditContext(c, clerkUserId, sessionId, roleNames));
      return c.json({ report }, 201);
    },
  );

  /**
   * GET /v1/ops/moderation/reports
   * Auth: moderation.read
   */
  router.get(
    "/v1/ops/moderation/reports",
    auth,
    requirePermission("moderation.read"),
    zValidator("query", listReportsSchema),
    async (c) => {
      const query = c.req.valid("query");
      const reports = await listReports(db, compact(query));
      return c.json({ reports });
    },
  );

  /**
   * GET /v1/ops/moderation/reports/:id
   * Auth: moderation.read
   */
  router.get(
    "/v1/ops/moderation/reports/:id",
    auth,
    requirePermission("moderation.read"),
    async (c) => {
      const reportId = c.req.param("id");
      const result = await getReport(db, reportId);
      return c.json(result);
    },
  );

  /**
   * POST /v1/ops/moderation/reports/:id/review
   * Auth: moderation.review
   */
  router.post(
    "/v1/ops/moderation/reports/:id/review",
    auth,
    requirePermission("moderation.review"),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const reportId = c.req.param("id");
      const report = await markReportReviewing(db, reportId, pmpUserId, buildAuditContext(c, clerkUserId, sessionId, roleNames, "moderation.review"));
      return c.json({ report });
    },
  );

  /**
   * POST /v1/ops/moderation/reports/:id/action
   * Auth: moderation.action
   */
  router.post(
    "/v1/ops/moderation/reports/:id/action",
    auth,
    requirePermission("moderation.action"),
    zValidator("json", moderationActionSchema),
    async (c) => {
      const { pmpUserId, clerkUserId, sessionId, roleNames } = c.get("auth");
      const reportId = c.req.param("id");
      const body = c.req.valid("json");
      const result = await takeModerationAction(db, reportId, pmpUserId, compact(body), buildAuditContext(c, clerkUserId, sessionId, roleNames, "moderation.action"));
      return c.json(result);
    },
  );

  // ── Audit log ────────────────────────────────────────────────────────────────

  /**
   * GET /v1/ops/audit
   * Auth: system.manage
   */
  router.get(
    "/v1/ops/audit",
    auth,
    requirePermission("system.manage"),
    zValidator("query", listAuditSchema),
    async (c) => {
      const query = c.req.valid("query");
      const entries = await listOpsAudit(db, compact(query));
      return c.json({ entries });
    },
  );

  // ── Overview dashboard ───────────────────────────────────────────────────────

  /**
   * GET /v1/ops/overview
   * Auth: any of the ops read permissions.
   *
   * Returns aggregate counts relevant to the caller's permissions.
   * Counts are computed in parallel for performance.
   */
  router.get(
    "/v1/ops/overview",
    auth,
    requireAnyPermission(
      "users.read",
      "support.read",
      "moderation.read",
      "verification.read",
      "system.manage",
    ),
    async (c) => {
      const { permissions } = c.get("auth");

      const [userCounts, ticketCounts, reportCounts, verificationCounts] = await Promise.all([
        permissions.has("users.read")
          ? db
              .select({
                status: users.status,
                total: count(),
              })
              .from(users)
              .groupBy(users.status)
          : Promise.resolve(null),

        permissions.has("support.read")
          ? db
              .select({
                status: supportTickets.status,
                total: count(),
              })
              .from(supportTickets)
              .groupBy(supportTickets.status)
          : Promise.resolve(null),

        permissions.has("moderation.read")
          ? db
              .select({
                status: contentReports.status,
                total: count(),
              })
              .from(contentReports)
              .groupBy(contentReports.status)
          : Promise.resolve(null),

        permissions.has("verification.read")
          ? db
              .select({
                status: verificationCases.status,
                total: count(),
              })
              .from(verificationCases)
              .groupBy(verificationCases.status)
          : Promise.resolve(null),
      ]);

      const toMap = (rows: { status: string; total: number }[] | null) => {
        if (!rows) return null;
        return Object.fromEntries(rows.map((r) => [r.status, r.total]));
      };

      return c.json({
        users: toMap(userCounts as { status: string; total: number }[] | null),
        supportTickets: toMap(ticketCounts as { status: string; total: number }[] | null),
        contentReports: toMap(reportCounts as { status: string; total: number }[] | null),
        verificationCases: toMap(verificationCounts as { status: string; total: number }[] | null),
      });
    },
  );

  return router;
}
