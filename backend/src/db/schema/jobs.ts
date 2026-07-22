/**
 * Stage 10 — Job Marketplace
 *
 * Tables:
 *   jobs              — job postings created by employers
 *   job_applications  — provider applications to jobs
 *
 * Business rules (enforced in service layer):
 *   - Only employers (account_type='employer') can create/manage jobs.
 *   - Only providers (account_type='provider') can apply to jobs.
 *   - Duplicate applications are prevented by a UNIQUE constraint.
 *   - Unpublished jobs are only visible to their owner.
 *   - Closed jobs do not accept new applications.
 */

import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { employerProfiles, providerProfiles } from "./profiles.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", ["draft", "published", "closed"]);
export const workTypeEnum = pgEnum("work_type", ["remote", "onsite", "hybrid"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "pending",
  "reviewed",
  "shortlisted",
  "rejected",
  "accepted",
]);

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),

    /** FK to employer_profiles.id — the employer who posted this job. */
    employerProfileId: text("employer_profile_id")
      .notNull()
      .references(() => employerProfiles.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description").notNull(),

    /** Primary service category (matches categories.slug). */
    category: text("category"),

    /** Array of skill names or IDs required for the job. */
    skills: text("skills")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    location: text("location"),
    workType: workTypeEnum("work_type").notNull().default("onsite"),

    /** Budget range in whole currency units (e.g. NGN). */
    budgetMin: integer("budget_min"),
    budgetMax: integer("budget_max"),
    currency: text("currency").notNull().default("NGN"),

    status: jobStatusEnum("status").notNull().default("draft"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /** Set when status transitions draft → published. */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** Optional application deadline. */
    deadline: timestamp("deadline", { withTimezone: true }),
  },
  (t) => [
    index("jobs_employer_profile_idx").on(t.employerProfileId),
    index("jobs_status_idx").on(t.status),
    index("jobs_created_at_idx").on(t.createdAt),
    index("jobs_category_idx").on(t.category),
  ],
);

// ─── Job Applications ─────────────────────────────────────────────────────────

export const jobApplications = pgTable(
  "job_applications",
  {
    id: text("id").primaryKey(),

    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    /** FK to provider_profiles.id — the provider who applied. */
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),

    coverMessage: text("cover_message").notNull(),

    /** Optional proposed rate in whole currency units. */
    proposedRate: integer("proposed_rate"),
    currency: text("currency").notNull().default("NGN"),

    status: applicationStatusEnum("status").notNull().default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("job_applications_job_idx").on(t.jobId),
    index("job_applications_provider_idx").on(t.providerProfileId),
    index("job_applications_status_idx").on(t.status),
    /** One application per provider per job. */
    uniqueIndex("job_applications_unique_idx").on(t.jobId, t.providerProfileId),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobApplication = typeof jobApplications.$inferSelect;
export type NewJobApplication = typeof jobApplications.$inferInsert;
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type WorkType = (typeof workTypeEnum.enumValues)[number];
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number];
