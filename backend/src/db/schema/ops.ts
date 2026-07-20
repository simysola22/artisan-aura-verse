/**
 * Stage 9 — Operations System
 *
 * Tables:
 *   support_tickets          — user-submitted help requests
 *   support_ticket_messages  — threaded replies (staff + user, with internal flag)
 *   content_reports          — user-submitted reports on profiles/messages/users
 *   moderation_actions       — actions taken by moderation team on reports
 *   ops_audit_log            — append-only cross-domain audit trail for all
 *                              sensitive operational actions (role changes,
 *                              suspensions, moderation decisions)
 *
 * Architectural decisions:
 *   1. ops_audit_log is separate from verification_audit_log so that each
 *      domain can evolve its action enum independently.
 *   2. Internal support messages (is_internal = true) are never shown to
 *      the submitting user — enforced at the service layer.
 *   3. moderation_actions are append-only — no UPDATE or DELETE issued.
 *   4. Role assignment uses the existing user_roles join table; ops_audit_log
 *      records every role change so it is always attributable.
 *   5. Support tickets store a snapshot of the submitter — the FK cascades
 *      on user deletion so that deleting a user does not orphan tickets.
 */

import { pgTable, text, timestamp, pgEnum, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "assigned",
  "resolved",
  "closed",
]);

export const supportTicketCategoryEnum = pgEnum("support_ticket_category", [
  "billing",
  "account",
  "verification",
  "technical",
  "other",
]);

export const supportTicketPriorityEnum = pgEnum("support_ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const contentReportStatusEnum = pgEnum("content_report_status", [
  "pending",
  "reviewing",
  "actioned",
  "dismissed",
]);

export const contentReportReasonEnum = pgEnum("content_report_reason", [
  "spam",
  "harassment",
  "inappropriate",
  "fraud",
  "other",
]);

export const contentReportEntityTypeEnum = pgEnum("content_report_entity_type", [
  "provider_profile",
  "message",
  "user",
]);

export const opsAuditActionEnum = pgEnum("ops_audit_action", [
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
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * A support request submitted by any authenticated user.
 *
 * Lifecycle: open → assigned → resolved → closed
 * Staff can skip directly from open → resolved.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),

    title: text("title").notNull(),
    description: text("description").notNull(),
    category: supportTicketCategoryEnum("category").notNull(),
    priority: supportTicketPriorityEnum("priority").notNull().default("medium"),
    status: supportTicketStatusEnum("status").notNull().default("open"),

    /** FK to users.id — any authenticated user can submit a ticket. */
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** FK to users.id — support agent currently assigned, null if unassigned. */
    assignedTo: text("assigned_to").references(() => users.id, { onDelete: "set null" }),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_tickets_submitted_by_idx").on(t.submittedBy),
    index("support_tickets_status_idx").on(t.status),
    index("support_tickets_assigned_to_idx").on(t.assignedTo),
    index("support_tickets_category_idx").on(t.category),
  ],
);

/**
 * Threaded messages on a support ticket.
 *
 * is_internal = true → visible only to support staff; never returned to submitter.
 * is_internal = false → visible to both the submitter and staff.
 */
export const supportTicketMessages = pgTable(
  "support_ticket_messages",
  {
    id: text("id").primaryKey(),

    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),

    /** FK to users.id — the user or staff member who wrote this message. */
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    content: text("content").notNull(),

    /**
     * When true this message is an internal staff note and must never be
     * included in responses to the ticket submitter.
     */
    isInternal: boolean("is_internal").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_ticket_messages_ticket_idx").on(t.ticketId)],
);

/**
 * A user-submitted report about a provider profile, message, or user account.
 *
 * Lifecycle: pending → reviewing → actioned | dismissed
 */
export const contentReports = pgTable(
  "content_reports",
  {
    id: text("id").primaryKey(),

    entityType: contentReportEntityTypeEnum("entity_type").notNull(),
    /** ID of the entity being reported (profile ID, message ID, user ID). */
    entityId: text("entity_id").notNull(),

    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    reason: contentReportReasonEnum("reason").notNull(),
    description: text("description"),

    status: contentReportStatusEnum("status").notNull().default("pending"),

    /** FK to users.id — moderation team member who reviewed this report. */
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("content_reports_status_idx").on(t.status),
    index("content_reports_entity_idx").on(t.entityType, t.entityId),
    index("content_reports_reporter_idx").on(t.reporterId),
  ],
);

/**
 * An action taken by the moderation team on a content report.
 *
 * Append-only — never updated or deleted from the application layer.
 * Multiple actions may be recorded for the same report (e.g. warn then restrict).
 */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: text("id").primaryKey(),

    /** The report that triggered this action. Null if the action was proactive. */
    reportId: text("report_id").references(() => contentReports.id, { onDelete: "set null" }),

    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: text("target_entity_id").notNull(),

    /**
     * Action taken:
     *   warn              — issued a warning to the user
     *   restrict          — limited what the user can do
     *   content_removed   — removed specific content
     *   dismiss           — dismissed the report without action
     */
    actionType: text("action_type")
      .notNull()
      .$type<"warn" | "restrict" | "content_removed" | "dismiss">(),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_actions_report_idx").on(t.reportId),
    index("moderation_actions_actor_idx").on(t.actorId),
    index("moderation_actions_entity_idx").on(t.targetEntityType, t.targetEntityId),
  ],
);

/**
 * Append-only operations audit log.
 *
 * Records every sensitive operational action across all ops domains:
 *   - Role assignments and removals
 *   - User account status changes (suspend/reactivate/delete)
 *   - Support ticket lifecycle events
 *   - Moderation actions and report dispositions
 *
 * Application code never issues UPDATE or DELETE against this table.
 * The metadata column holds a JSON string for action-specific context.
 */
export const opsAuditLog = pgTable(
  "ops_audit_log",
  {
    id: text("id").primaryKey(),

    /** FK to users.id — who performed the action. */
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    action: opsAuditActionEnum("action").notNull(),

    /** For user-targeted actions: the user being acted upon. */
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),

    /** Type of the primary entity this action relates to (ticket, report, role, etc.). */
    entityType: text("entity_type"),

    /** ID of the entity (ticket ID, report ID, role ID, etc.). */
    entityId: text("entity_id"),

    /** JSON string holding action-specific metadata. Stored as text for portability. */
    metadata: text("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ops_audit_log_actor_idx").on(t.actorId),
    index("ops_audit_log_action_idx").on(t.action),
    index("ops_audit_log_target_user_idx").on(t.targetUserId),
    index("ops_audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
export type SupportTicketMessage = typeof supportTicketMessages.$inferSelect;
export type NewSupportTicketMessage = typeof supportTicketMessages.$inferInsert;
export type ContentReport = typeof contentReports.$inferSelect;
export type NewContentReport = typeof contentReports.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;
export type OpsAuditEntry = typeof opsAuditLog.$inferSelect;
export type NewOpsAuditEntry = typeof opsAuditLog.$inferInsert;

export type SupportTicketStatus = (typeof supportTicketStatusEnum.enumValues)[number];
export type SupportTicketCategory = (typeof supportTicketCategoryEnum.enumValues)[number];
export type SupportTicketPriority = (typeof supportTicketPriorityEnum.enumValues)[number];
export type ContentReportStatus = (typeof contentReportStatusEnum.enumValues)[number];
export type ContentReportReason = (typeof contentReportReasonEnum.enumValues)[number];
export type ContentReportEntityType = (typeof contentReportEntityTypeEnum.enumValues)[number];
export type OpsAuditAction = (typeof opsAuditActionEnum.enumValues)[number];
