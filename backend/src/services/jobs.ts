/**
 * Jobs service — Stage 10.
 *
 * Enforces business rules:
 *   - Only employer profiles can create/manage jobs.
 *   - Only provider profiles can apply.
 *   - Duplicate applications are rejected (ConflictError).
 *   - Closed/unpublished jobs reject new applications.
 *   - Job ownership is verified before every mutation.
 *   - Drafts/closed jobs are only visible to their owner.
 */

import { randomUUID } from "crypto";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { jobs, jobApplications } from "../db/schema/jobs.js";
import { employerProfiles, providerProfiles } from "../db/schema/profiles.js";
import { users } from "../db/schema/users.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors/index.js";
import type { JobStatus, WorkType, ApplicationStatus } from "../db/schema/jobs.js";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface JobDto {
  id: string;
  employerProfileId: string;
  employerDisplayName: string | null;
  title: string;
  description: string;
  category: string | null;
  skills: string[];
  location: string | null;
  workType: WorkType;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deadline: string | null;
}

export interface ApplicationDto {
  id: string;
  jobId: string;
  jobTitle: string;
  providerProfileId: string;
  providerDisplayName: string | null;
  coverMessage: string;
  proposedRate: number | null;
  currency: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateJobInput {
  title: string;
  description: string;
  category?: string;
  skills?: string[];
  location?: string;
  workType?: WorkType;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  deadline?: string;
}

export interface UpdateJobInput {
  title?: string;
  description?: string;
  category?: string | null;
  skills?: string[];
  location?: string | null;
  workType?: WorkType;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string;
  deadline?: string | null;
}

export interface ApplyToJobInput {
  coverMessage: string;
  proposedRate?: number;
  currency?: string;
}

export interface UpdateApplicationInput {
  status: ApplicationStatus;
}

export interface ListJobsFilter {
  category?: string;
  workType?: WorkType;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toJobDto(
  job: typeof jobs.$inferSelect,
  employerDisplayName: string | null,
): JobDto {
  return {
    id: job.id,
    employerProfileId: job.employerProfileId,
    employerDisplayName,
    title: job.title,
    description: job.description,
    category: job.category,
    skills: job.skills ?? [],
    location: job.location,
    workType: job.workType,
    budgetMin: job.budgetMin,
    budgetMax: job.budgetMax,
    currency: job.currency,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    publishedAt: job.publishedAt?.toISOString() ?? null,
    deadline: job.deadline?.toISOString() ?? null,
  };
}

function toApplicationDto(
  app: typeof jobApplications.$inferSelect,
  jobTitle: string,
  providerDisplayName: string | null,
): ApplicationDto {
  return {
    id: app.id,
    jobId: app.jobId,
    jobTitle,
    providerProfileId: app.providerProfileId,
    providerDisplayName,
    coverMessage: app.coverMessage,
    proposedRate: app.proposedRate,
    currency: app.currency,
    status: app.status,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

/** Create a draft job for an employer. */
export async function createJob(
  db: Db,
  employerProfileId: string,
  input: CreateJobInput,
): Promise<JobDto> {
  // Verify employer profile exists
  const [employer] = await db
    .select({ id: employerProfiles.id, displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, employerProfileId))
    .limit(1);
  if (!employer) throw new NotFoundError("Employer profile");

  const id = `job_${randomUUID().replace(/-/g, "")}`;
  const [job] = await db
    .insert(jobs)
    .values({
      id,
      employerProfileId,
      title: input.title,
      description: input.description,
      category: input.category ?? null,
      skills: input.skills ?? [],
      location: input.location ?? null,
      workType: input.workType ?? "onsite",
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      currency: input.currency ?? "NGN",
      deadline: input.deadline ? new Date(input.deadline) : null,
    })
    .returning();

  return toJobDto(job!, employer.displayName);
}

/** Get a single job by ID. Non-owners only see published jobs. */
export async function getJobById(
  db: Db,
  jobId: string,
  viewerEmployerProfileId?: string,
): Promise<JobDto> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) throw new NotFoundError("Job");

  // Non-owners can only see published jobs
  if (job.status !== "published" && job.employerProfileId !== viewerEmployerProfileId) {
    throw new NotFoundError("Job");
  }

  const [employer] = await db
    .select({ displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, job.employerProfileId))
    .limit(1);

  return toJobDto(job, employer?.displayName ?? null);
}

/** List published jobs with optional filtering. */
export async function listPublishedJobs(
  db: Db,
  filter: ListJobsFilter = {},
): Promise<JobDto[]> {
  const rows = await db
    .select({
      job: jobs,
      employerDisplayName: employerProfiles.displayName,
    })
    .from(jobs)
    .leftJoin(employerProfiles, eq(jobs.employerProfileId, employerProfiles.id))
    .where(eq(jobs.status, "published"))
    .orderBy(desc(jobs.publishedAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  return rows.map((r) => toJobDto(r.job, r.employerDisplayName ?? null));
}

/** List all jobs owned by a specific employer profile. */
export async function listEmployerJobs(
  db: Db,
  employerProfileId: string,
): Promise<JobDto[]> {
  const [employer] = await db
    .select({ displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, employerProfileId))
    .limit(1);

  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.employerProfileId, employerProfileId))
    .orderBy(desc(jobs.createdAt));

  return rows.map((j) => toJobDto(j, employer?.displayName ?? null));
}

/** Update a job (employer-only, own job, draft/published only). */
export async function updateJob(
  db: Db,
  jobId: string,
  employerProfileId: string,
  input: UpdateJobInput,
): Promise<JobDto> {
  const [existing] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!existing) throw new NotFoundError("Job");
  if (existing.employerProfileId !== employerProfileId) {
    throw new ForbiddenError("You do not own this job.");
  }
  if (existing.status === "closed") {
    throw new BadRequestError("Closed jobs cannot be edited.");
  }

  const updateValues: Partial<typeof jobs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) updateValues.title = input.title;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.category !== undefined) updateValues.category = input.category;
  if (input.skills !== undefined) updateValues.skills = input.skills;
  if (input.location !== undefined) updateValues.location = input.location;
  if (input.workType !== undefined) updateValues.workType = input.workType;
  if (input.budgetMin !== undefined) updateValues.budgetMin = input.budgetMin;
  if (input.budgetMax !== undefined) updateValues.budgetMax = input.budgetMax;
  if (input.currency !== undefined) updateValues.currency = input.currency;
  if (input.deadline !== undefined) {
    updateValues.deadline = input.deadline ? new Date(input.deadline) : null;
  }

  const [updated] = await db
    .update(jobs)
    .set(updateValues)
    .where(eq(jobs.id, jobId))
    .returning();

  const [employer] = await db
    .select({ displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, updated!.employerProfileId))
    .limit(1);

  return toJobDto(updated!, employer?.displayName ?? null);
}

/** Publish a draft job (draft → published). */
export async function publishJob(
  db: Db,
  jobId: string,
  employerProfileId: string,
): Promise<JobDto> {
  const [existing] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!existing) throw new NotFoundError("Job");
  if (existing.employerProfileId !== employerProfileId) {
    throw new ForbiddenError("You do not own this job.");
  }
  if (existing.status !== "draft") {
    throw new BadRequestError(`Job is already ${existing.status}.`);
  }

  const [updated] = await db
    .update(jobs)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();

  const [employer] = await db
    .select({ displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, updated!.employerProfileId))
    .limit(1);

  return toJobDto(updated!, employer?.displayName ?? null);
}

/** Close a published job (published → closed). */
export async function closeJob(
  db: Db,
  jobId: string,
  employerProfileId: string,
): Promise<JobDto> {
  const [existing] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!existing) throw new NotFoundError("Job");
  if (existing.employerProfileId !== employerProfileId) {
    throw new ForbiddenError("You do not own this job.");
  }
  if (existing.status !== "published") {
    throw new BadRequestError("Only published jobs can be closed.");
  }

  const [updated] = await db
    .update(jobs)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();

  const [employer] = await db
    .select({ displayName: employerProfiles.displayName })
    .from(employerProfiles)
    .where(eq(employerProfiles.id, updated!.employerProfileId))
    .limit(1);

  return toJobDto(updated!, employer?.displayName ?? null);
}

// ─── Applications ─────────────────────────────────────────────────────────────

/** Apply to a published job (provider-only, no duplicates). */
export async function applyToJob(
  db: Db,
  jobId: string,
  providerProfileId: string,
  input: ApplyToJobInput,
): Promise<ApplicationDto> {
  // Verify job exists and is published
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) throw new NotFoundError("Job");
  if (job.status !== "published") {
    throw new BadRequestError("This job is not currently accepting applications.");
  }

  // Verify provider profile exists
  const [provider] = await db
    .select({
      id: providerProfiles.id,
      userId: providerProfiles.userId,
    })
    .from(providerProfiles)
    .where(eq(providerProfiles.id, providerProfileId))
    .limit(1);
  if (!provider) throw new NotFoundError("Provider profile");

  // Check for duplicate application
  const [existing] = await db
    .select({ id: jobApplications.id })
    .from(jobApplications)
    .where(
      and(
        eq(jobApplications.jobId, jobId),
        eq(jobApplications.providerProfileId, providerProfileId),
      ),
    )
    .limit(1);

  if (existing) {
    throw new ConflictError("You have already applied to this job.");
  }

  const appId = `app_${randomUUID().replace(/-/g, "")}`;
  const [app] = await db
    .insert(jobApplications)
    .values({
      id: appId,
      jobId,
      providerProfileId,
      coverMessage: input.coverMessage,
      proposedRate: input.proposedRate ?? null,
      currency: input.currency ?? "NGN",
    })
    .returning();

  // Fetch provider display name
  const [providerUser] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, provider.userId))
    .limit(1);

  return toApplicationDto(app!, job.title, providerUser?.displayName ?? null);
}

/** List all applications for a job (employer-only, must own job). */
export async function listApplicationsForJob(
  db: Db,
  jobId: string,
  employerProfileId: string,
): Promise<ApplicationDto[]> {
  // Verify ownership
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) throw new NotFoundError("Job");
  if (job.employerProfileId !== employerProfileId) {
    throw new ForbiddenError("You do not own this job.");
  }

  const rows = await db
    .select({
      app: jobApplications,
      providerUserId: providerProfiles.userId,
    })
    .from(jobApplications)
    .leftJoin(providerProfiles, eq(jobApplications.providerProfileId, providerProfiles.id))
    .where(eq(jobApplications.jobId, jobId))
    .orderBy(desc(jobApplications.createdAt));

  // Fetch provider display names
  const providerUserIds = rows
    .map((r) => r.providerUserId)
    .filter((id): id is string => id !== null);

  const providerUsers =
    providerUserIds.length > 0
      ? await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, providerUserIds))
      : [];

  const nameMap = new Map(providerUsers.map((u) => [u.id, u.displayName]));

  return rows.map((r) =>
    toApplicationDto(
      r.app,
      job.title,
      r.providerUserId ? (nameMap.get(r.providerUserId) ?? null) : null,
    ),
  );
}

/** List all applications submitted by a provider. */
export async function listProviderApplications(
  db: Db,
  providerProfileId: string,
): Promise<ApplicationDto[]> {
  const rows = await db
    .select({
      app: jobApplications,
      jobTitle: jobs.title,
    })
    .from(jobApplications)
    .leftJoin(jobs, eq(jobApplications.jobId, jobs.id))
    .where(eq(jobApplications.providerProfileId, providerProfileId))
    .orderBy(desc(jobApplications.createdAt));

  // Fetch provider display name once
  const [provider] = await db
    .select({ userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(eq(providerProfiles.id, providerProfileId))
    .limit(1);

  let displayName: string | null = null;
  if (provider?.userId) {
    const [u] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, provider.userId))
      .limit(1);
    displayName = u?.displayName ?? null;
  }

  return rows.map((r) =>
    toApplicationDto(r.app, r.jobTitle ?? "Deleted job", displayName),
  );
}

/** Update application status (employer-only, must own the job). */
export async function updateApplicationStatus(
  db: Db,
  applicationId: string,
  employerProfileId: string,
  input: UpdateApplicationInput,
): Promise<ApplicationDto> {
  // Fetch the application + its job
  const [row] = await db
    .select({
      app: jobApplications,
      jobTitle: jobs.title,
      jobEmployerProfileId: jobs.employerProfileId,
    })
    .from(jobApplications)
    .leftJoin(jobs, eq(jobApplications.jobId, jobs.id))
    .where(eq(jobApplications.id, applicationId))
    .limit(1);

  if (!row) throw new NotFoundError("Application");
  if (row.jobEmployerProfileId !== employerProfileId) {
    throw new ForbiddenError("You do not own the job this application belongs to.");
  }

  const [updated] = await db
    .update(jobApplications)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(jobApplications.id, applicationId))
    .returning();

  // Fetch provider display name
  const [providerRow] = await db
    .select({ userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(eq(providerProfiles.id, updated!.providerProfileId))
    .limit(1);

  let displayName: string | null = null;
  if (providerRow?.userId) {
    const [u] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, providerRow.userId))
      .limit(1);
    displayName = u?.displayName ?? null;
  }

  return toApplicationDto(updated!, row.jobTitle ?? "Job", displayName);
}

/** Check if a provider has already applied to a job. */
export async function hasApplied(
  db: Db,
  jobId: string,
  providerProfileId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: jobApplications.id })
    .from(jobApplications)
    .where(
      and(
        eq(jobApplications.jobId, jobId),
        eq(jobApplications.providerProfileId, providerProfileId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
