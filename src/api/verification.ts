/**
 * Verification API.
 *
 * Real mode: calls backend /v1/verification/cases/* endpoints.
 * Mock mode: delegates to in-memory mock adapter.
 *
 * Backend case lifecycle:
 *   draft → submitted → under_review → approved | rejected | info_requested
 *
 * Backend status values map to frontend VerificationStatus:
 *   draft / submitted / under_review / resubmitted → "in_review"
 *   info_requested                                  → "additional_info_requested"
 *   approved                                        → "verified"
 *   rejected                                        → "rejected"
 *   (no case exists)                                → "unverified"
 */

import { USE_MOCK_API, apiFetch } from "./client";
import { mockVerification } from "./mock/adapter";
import type { VerificationApplication, VerificationStatus } from "@/types";

// ─── Backend case types ────────────────────────────────────────────────────────

export type BackendCaseStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "info_requested"
  | "resubmitted"
  | "approved"
  | "rejected"
  | "escalated";

export type EvidenceType =
  | "cv_resume"
  | "certificate"
  | "work_sample"
  | "portfolio_evidence"
  | "employment_evidence"
  | "reference"
  | "identity_document"
  | "other";

export interface EvidenceItem {
  id: string;
  evidenceType: EvidenceType;
  label: string;
  fileUrl: string;
  storageKey?: string;
  mimeType?: string;
  createdAt: string;
}

export interface VerificationCase {
  id: string;
  providerId: string;
  profileId: string;
  verificationType: "artisan" | "professional";
  status: BackendCaseStatus;
  submittedAt: string | null;
  updatedAt: string;
  evidence: EvidenceItem[];
  requestedInfoMessage?: string | null;
}

export interface AddEvidenceInput {
  evidenceType: EvidenceType;
  label: string;
  fileUrl: string;
  storageKey?: string;
  mimeType?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function backendStatusToFrontend(status: BackendCaseStatus): VerificationStatus {
  switch (status) {
    case "approved":
      return "verified";
    case "rejected":
      return "rejected";
    case "info_requested":
      return "additional_info_requested";
    default:
      return "in_review";
  }
}

function caseToApplication(c: VerificationCase): VerificationApplication {
  return {
    id: c.id,
    providerId: c.providerId,
    status: backendStatusToFrontend(c.status),
    submittedAt: c.submittedAt ?? undefined,
    updatedAt: c.updatedAt,
    evidence: [],
    requestedInfo: c.requestedInfoMessage ? [c.requestedInfoMessage] : [],
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Get the provider's current verification cases list.
 * Real mode: GET /v1/verification/cases
 */
export function getCases(): Promise<{ cases: VerificationCase[] }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ cases: [] });
  }
  return apiFetch<{ cases: VerificationCase[] }>("/v1/verification/cases");
}

/**
 * Create a new verification case (starts in draft).
 * Real mode: POST /v1/verification/cases
 */
export function createCase(
  verificationType: "artisan" | "professional",
): Promise<{ case: VerificationCase }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      case: {
        id: `mock-case-${Date.now()}`,
        providerId: "me",
        profileId: "mock-profile",
        verificationType,
        status: "draft",
        submittedAt: null,
        updatedAt: new Date().toISOString(),
        evidence: [],
      },
    });
  }
  return apiFetch<{ case: VerificationCase }>("/v1/verification/cases", {
    method: "POST",
    body: { verificationType },
  });
}

/**
 * Submit a verification case for review (draft → submitted).
 * Real mode: POST /v1/verification/cases/:id/submit
 */
export function submitCase(caseId: string): Promise<{ case: VerificationCase }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      case: {
        id: caseId,
        providerId: "me",
        profileId: "mock-profile",
        verificationType: "artisan",
        status: "submitted",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        evidence: [],
      },
    });
  }
  return apiFetch<{ case: VerificationCase }>(`/v1/verification/cases/${caseId}/submit`, {
    method: "POST",
  });
}

/**
 * Add evidence to a verification case.
 * Real mode: POST /v1/verification/cases/:id/evidence
 */
export function addEvidence(
  caseId: string,
  input: AddEvidenceInput,
): Promise<{ evidence: EvidenceItem }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      evidence: {
        id: `ev-${Date.now()}`,
        ...input,
        createdAt: new Date().toISOString(),
      },
    });
  }
  return apiFetch<{ evidence: EvidenceItem }>(`/v1/verification/cases/${caseId}/evidence`, {
    method: "POST",
    body: input,
  });
}

/**
 * Remove evidence from a verification case.
 * Real mode: DELETE /v1/verification/cases/:id/evidence/:evidenceId
 */
export function removeEvidence(caseId: string, evidenceId: string): Promise<void> {
  if (USE_MOCK_API) return Promise.resolve();
  return apiFetch<void>(`/v1/verification/cases/${caseId}/evidence/${evidenceId}`, {
    method: "DELETE",
  });
}

/**
 * Resubmit a case after additional info was requested.
 * Real mode: POST /v1/verification/cases/:id/resubmit
 */
export function resubmitCase(
  caseId: string,
  providerResponse: string,
): Promise<{ case: VerificationCase }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      case: {
        id: caseId,
        providerId: "me",
        profileId: "mock-profile",
        verificationType: "artisan",
        status: "resubmitted",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        evidence: [],
      },
    });
  }
  return apiFetch<{ case: VerificationCase }>(`/v1/verification/cases/${caseId}/resubmit`, {
    method: "POST",
    body: { providerResponse },
  });
}

// ─── Legacy compatibility wrappers ────────────────────────────────────────────
// These preserve the interface used by the existing verification UI page.

/**
 * Get the provider's current verification status.
 * In mock mode: uses mock adapter with providerId.
 * In real mode: fetches the cases list and returns the most recent active case.
 * Returns the mock "unverified" application if no cases exist.
 */
export async function status(providerId: string): Promise<VerificationApplication> {
  if (USE_MOCK_API) return mockVerification.status(providerId);

  const { cases } = await getCases();
  if (!cases || cases.length === 0) {
    // No case yet — return unverified placeholder
    return {
      id: "",
      providerId,
      status: "unverified",
      updatedAt: new Date().toISOString(),
      evidence: [],
      requestedInfo: [],
    };
  }

  // Return the most recently updated case
  const sorted = [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return caseToApplication(sorted[0]!);
}

/**
 * Submit verification for review.
 * In mock mode: uses mock adapter.
 * In real mode: creates a new draft case (artisan type by default) and submits it.
 * If an active draft case already exists it is reused.
 */
export async function submit(
  providerId: string,
  payload: Partial<VerificationApplication>,
): Promise<VerificationApplication> {
  if (USE_MOCK_API) return mockVerification.submit(providerId, payload);

  // Find or create a draft case
  const { cases } = await getCases();
  let draft = cases.find((c) => c.status === "draft");

  if (!draft) {
    const created = await createCase("artisan");
    draft = created.case;
  }

  const submitted = await submitCase(draft.id);
  return caseToApplication(submitted.case);
}
