/**
 * Stage 4 — Verification System
 *
 * Tables:
 *   verification_cases      — the primary case entity, one per provider per attempt
 *   verification_evidence   — metadata + secure URL references (no binary storage in PostgreSQL)
 *   verification_notes      — internal reviewer notes (NEVER exposed to providers)
 *   verification_audit_log  — append-only audit trail of every significant action
 *
 * Architectural decisions:
 *   1. Status transitions are enforced in the service layer (ALLOWED_TRANSITIONS map),
 *      not via DB constraints, so they are centrally testable without a live DB.
 *   2. Evidence stores URL references only — binary files live in object storage
 *      (S3 / Cloudflare R2 / Supabase Storage). The storage_key column holds the
 *      internal key so the URL can be regenerated on any compatible storage provider.
 *   3. The audit log is append-only from the application perspective — no UPDATE or
 *      DELETE is ever issued against it.
 *   4. Internal notes are stored in a separate table so they can never accidentally
 *      be included in provider-facing queries.
 *   5. The verification_engine abstraction point: the `claimed_by` column represents
 *      the current reviewer. A future AI provider would populate this with a synthetic
 *      actor ID and set a `verified_by_ai` flag — no schema change required.
 */

import { pgTable, text, timestamp, pgEnum, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { providerProfiles } from "./profiles.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * Full lifecycle of a verification case.
 *
 * Valid transitions (enforced by service, not DB):
 *   draft          → submitted
 *   submitted      → under_review
 *   under_review   → info_requested | approved | rejected | escalated
 *   info_requested → resubmitted
 *   resubmitted    → under_review
 *   escalated      → approved | rejected
 *   approved       — terminal
 *   rejected       — terminal
 */
export const verificationCaseStatusEnum = pgEnum("verification_case_status", [
  "draft",
  "submitted",
  "under_review",
  "info_requested",
  "resubmitted",
  "approved",
  "rejected",
  "escalated",
]);

/**
 * Type of evidence document a provider may submit.
 * Extensible via migration — add new values without touching service logic.
 */
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "cv_resume",
  "certificate",
  "work_sample",
  "portfolio_evidence",
  "employment_evidence",
  "reference",
  "identity_document",
  "other",
]);

/**
 * Audit actions — one value per meaningful state-changing or noteworthy event.
 */
export const verificationAuditActionEnum = pgEnum("verification_audit_action", [
  "case_created",
  "case_submitted",
  "case_claimed",
  "info_requested",
  "case_resubmitted",
  "case_approved",
  "case_rejected",
  "case_escalated",
  "note_added",
  "evidence_added",
  "evidence_removed",
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * A single verification attempt for a provider.
 *
 * Ownership model:
 *   provider creates → reviewer claims → reviewer decides → provider profile updated
 *
 * Only one non-terminal case per provider profile is expected in practice, but
 * the schema does not enforce a unique constraint so that a new case can always
 * be opened after a terminal rejection (future flow).
 */
export const verificationCases = pgTable(
  "verification_cases",
  {
    id: text("id").primaryKey(),

    /** FK to provider_profiles.id — the profile being verified. */
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),

    /** FK to users.id — the PMP user who owns this case. Denormalised for fast ownership checks. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    status: verificationCaseStatusEnum("status").notNull().default("draft"),

    /**
     * Mirrors provider_profiles.kind at submission time.
     * Stored here so historical cases remain accurate even if the profile kind changes.
     */
    verificationType: text("verification_type").notNull().$type<"artisan" | "professional">(),

    /** FK to users.id — the reviewer who currently has this case. Null until claimed. */
    claimedBy: text("claimed_by").references(() => users.id, { onDelete: "set null" }),

    /**
     * Message sent to the provider when more information is requested.
     * Set when transitioning to info_requested; preserved for history.
     */
    infoRequestMessage: text("info_request_message"),

    /**
     * Provider's response to an information request.
     * Set when the provider resubmits (info_requested → resubmitted).
     */
    providerResponse: text("provider_response"),

    /**
     * Reason provided by the reviewer when approving, rejecting, or escalating.
     * Visible to providers on approve/reject; internal-only on escalate.
     */
    decisionReason: text("decision_reason"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verification_cases_provider_profile_idx").on(t.providerProfileId),
    index("verification_cases_user_id_idx").on(t.userId),
    index("verification_cases_status_idx").on(t.status),
    index("verification_cases_claimed_by_idx").on(t.claimedBy),
  ],
);

/**
 * Evidence submitted for a verification case.
 *
 * Storage invariant:
 *   - `file_url` is a fully-qualified HTTPS URL returned by the storage provider.
 *   - `storage_key` is the internal path/key (e.g. "verif/<case-id>/<uuid>") that
 *     allows the URL to be re-signed or migrated between storage providers.
 *   - Binary data is NEVER stored in this table or any other PostgreSQL table.
 *
 * Lifecycle:
 *   - Evidence can be added and removed freely while the case is in DRAFT or INFO_REQUESTED.
 *   - After submission, evidence is immutable from the provider's perspective.
 *   - is_removed performs a soft delete so the audit trail remains complete.
 */
export const verificationEvidence = pgTable(
  "verification_evidence",
  {
    id: text("id").primaryKey(),

    caseId: text("case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "cascade" }),

    evidenceType: evidenceTypeEnum("evidence_type").notNull(),

    /** Human-readable label provided by the provider (e.g. "City & Guilds Certificate 2020"). */
    label: text("label").notNull(),

    /**
     * Fully-qualified HTTPS URL to the evidence file.
     * For pre-signed URLs: re-sign via storage_key when needed.
     * For public/CDN URLs: this is the permanent reference.
     */
    fileUrl: text("file_url").notNull(),

    /**
     * Internal storage key used to re-sign or migrate the file.
     * Format: "<provider>/<case-id>/<uuid>.<ext>"
     * Null for externally-hosted URLs provided directly by the provider.
     */
    storageKey: text("storage_key"),

    /** MIME type declared by the uploader. Not verified server-side at this stage. */
    mimeType: text("mime_type"),

    /**
     * Soft-delete flag.
     * Set to true when the provider removes evidence before submission.
     * Never physically deleted so the audit trail remains intact.
     */
    isRemoved: boolean("is_removed").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verification_evidence_case_idx").on(t.caseId),
    index("verification_evidence_type_idx").on(t.evidenceType),
    index("verification_evidence_removed_idx").on(t.isRemoved),
  ],
);

/**
 * Internal reviewer notes — NEVER exposed to providers.
 *
 * This is a separate table (not a column on the case) so that:
 *   - Queries selecting provider-facing case data can never accidentally include notes.
 *   - Multiple notes per case are supported naturally.
 *   - Note authorship is preserved even if the reviewer leaves the team.
 */
export const verificationNotes = pgTable(
  "verification_notes",
  {
    id: text("id").primaryKey(),

    caseId: text("case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "cascade" }),

    /** FK to users.id — the reviewer who wrote the note. */
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" })
      .$type<string>(),

    content: text("content").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_notes_case_idx").on(t.caseId)],
);

/**
 * Append-only audit log.
 *
 * Every meaningful action on a verification case creates one row.
 * Application code never issues UPDATE or DELETE against this table.
 * The `metadata` column holds a JSON string for action-specific context
 * (e.g. the info_request_message, the decision_reason).
 */
export const verificationAuditLog = pgTable(
  "verification_audit_log",
  {
    id: text("id").primaryKey(),

    caseId: text("case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "cascade" }),

    /** FK to users.id — who performed the action. */
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" })
      .$type<string>(),

    action: verificationAuditActionEnum("action").notNull(),

    /** Status before the action. Null for non-transition events (e.g. note_added). */
    fromStatus: verificationCaseStatusEnum("from_status"),

    /** Status after the action. Null for non-transition events. */
    toStatus: verificationCaseStatusEnum("to_status"),

    /** JSON string with action-specific metadata. Stored as text for portability. */
    metadata: text("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verification_audit_case_idx").on(t.caseId),
    index("verification_audit_actor_idx").on(t.actorId),
    index("verification_audit_action_idx").on(t.action),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type VerificationCase = typeof verificationCases.$inferSelect;
export type NewVerificationCase = typeof verificationCases.$inferInsert;
export type VerificationEvidence = typeof verificationEvidence.$inferSelect;
export type NewVerificationEvidence = typeof verificationEvidence.$inferInsert;
export type VerificationNote = typeof verificationNotes.$inferSelect;
export type NewVerificationNote = typeof verificationNotes.$inferInsert;
export type VerificationAuditEntry = typeof verificationAuditLog.$inferSelect;
export type NewVerificationAuditEntry = typeof verificationAuditLog.$inferInsert;

export type VerificationCaseStatus = (typeof verificationCaseStatusEnum.enumValues)[number];
export type EvidenceType = (typeof evidenceTypeEnum.enumValues)[number];
export type VerificationAuditAction = (typeof verificationAuditActionEnum.enumValues)[number];
