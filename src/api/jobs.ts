/**
 * Jobs API — job postings and applications.
 *
 * Real mode: calls backend /v1/jobs/* endpoints.
 * Mock mode: returns stub/empty data so the UI renders correctly.
 *
 * Backend routes:
 *   GET    /v1/jobs                         List published jobs
 *   POST   /v1/jobs                         Create a draft job (employer)
 *   GET    /v1/jobs/my                      List own jobs (employer)
 *   GET    /v1/jobs/applications/mine       List own applications (provider)
 *   PATCH  /v1/jobs/applications/:appId     Update application status (employer)
 *   GET    /v1/jobs/:id                     Get job details
 *   PATCH  /v1/jobs/:id                     Update own job (employer)
 *   POST   /v1/jobs/:id/publish             Publish a draft (employer)
 *   POST   /v1/jobs/:id/close               Close a job (employer)
 *   GET    /v1/jobs/:id/applications        List job applications (employer)
 *   POST   /v1/jobs/:id/apply              Apply to job (provider)
 *   GET    /v1/jobs/:id/has-applied         Check if already applied (provider)
 */

import { USE_MOCK_API, apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus = "draft" | "published" | "closed";
export type WorkType = "remote" | "onsite" | "hybrid";
export type ApplicationStatus =
  | "pending"
  | "reviewed"
  | "shortlisted"
  | "rejected"
  | "accepted";

export interface Job {
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

export interface JobApplication {
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

export interface ApplyInput {
  coverMessage: string;
  proposedRate?: number;
  currency?: string;
}

export interface ListJobsFilter {
  category?: string;
  workType?: WorkType;
  limit?: number;
  offset?: number;
}

// ─── API functions ────────────────────────────────────────────────────────────

/** List published jobs (public). */
export function listJobs(filter: ListJobsFilter = {}): Promise<{ jobs: Job[]; total: number }> {
  if (USE_MOCK_API) return Promise.resolve({ jobs: [], total: 0 });
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  if (filter.workType) params.set("workType", filter.workType);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset !== undefined) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return apiFetch<{ jobs: Job[]; total: number }>(`/v1/jobs${qs ? `?${qs}` : ""}`, {
    auth: false,
  });
}

/** Get a single job (published = public; draft = employer-owner only). */
export function getJob(id: string): Promise<{ job: Job }> {
  if (USE_MOCK_API)
    return Promise.reject(new Error("Mock: job not found"));
  return apiFetch<{ job: Job }>(`/v1/jobs/${id}`);
}

/** List the authenticated employer's own jobs (all statuses). */
export function listMyJobs(): Promise<{ jobs: Job[] }> {
  if (USE_MOCK_API) return Promise.resolve({ jobs: [] });
  return apiFetch<{ jobs: Job[] }>("/v1/jobs/my");
}

/** Create a draft job. */
export function createJob(input: CreateJobInput): Promise<{ job: Job }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot create job"));
  return apiFetch<{ job: Job }>("/v1/jobs", { method: "POST", body: input });
}

/** Update a job. */
export function updateJob(id: string, input: UpdateJobInput): Promise<{ job: Job }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot update job"));
  return apiFetch<{ job: Job }>(`/v1/jobs/${id}`, { method: "PATCH", body: input });
}

/** Publish a draft job. */
export function publishJob(id: string): Promise<{ job: Job }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot publish job"));
  return apiFetch<{ job: Job }>(`/v1/jobs/${id}/publish`, { method: "POST" });
}

/** Close a published job. */
export function closeJob(id: string): Promise<{ job: Job }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot close job"));
  return apiFetch<{ job: Job }>(`/v1/jobs/${id}/close`, { method: "POST" });
}

/** List applications for the employer's own job. */
export function listJobApplications(jobId: string): Promise<{ applications: JobApplication[] }> {
  if (USE_MOCK_API) return Promise.resolve({ applications: [] });
  return apiFetch<{ applications: JobApplication[] }>(`/v1/jobs/${jobId}/applications`);
}

/** Apply to a published job. */
export function applyToJob(jobId: string, input: ApplyInput): Promise<{ application: JobApplication }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot apply to job"));
  return apiFetch<{ application: JobApplication }>(`/v1/jobs/${jobId}/apply`, {
    method: "POST",
    body: input,
  });
}

/** List the authenticated provider's own applications. */
export function listMyApplications(): Promise<{ applications: JobApplication[] }> {
  if (USE_MOCK_API) return Promise.resolve({ applications: [] });
  return apiFetch<{ applications: JobApplication[] }>("/v1/jobs/applications/mine");
}

/** Update an application's status (employer). */
export function updateApplication(
  appId: string,
  status: ApplicationStatus,
): Promise<{ application: JobApplication }> {
  if (USE_MOCK_API) return Promise.reject(new Error("Mock: cannot update application"));
  return apiFetch<{ application: JobApplication }>(`/v1/jobs/applications/${appId}`, {
    method: "PATCH",
    body: { status },
  });
}

/** Check if the authenticated provider has already applied to a job. */
export function hasApplied(jobId: string): Promise<{ applied: boolean }> {
  if (USE_MOCK_API) return Promise.resolve({ applied: false });
  return apiFetch<{ applied: boolean }>(`/v1/jobs/${jobId}/has-applied`);
}
