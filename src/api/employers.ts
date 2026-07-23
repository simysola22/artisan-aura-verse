/**
 * Employer profile API.
 *
 * Real mode: calls backend /v1/employers/* endpoints.
 * Mock mode: returns stub data.
 *
 * Backend routes:
 *   POST  /v1/employers/profile   Create own employer profile
 *   GET   /v1/employers/profile   Get own employer profile
 *   PATCH /v1/employers/profile   Update own employer profile
 */

import { USE_MOCK_API, apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmployerProfile {
  id: string;
  userId: string;
  employerType: "individual" | "organization" | null;
  displayName: string | null;
  organizationName: string | null;
  industry: string | null;
  description: string | null;
  location: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployerProfileInput {
  employerType?: "individual" | "organization";
  displayName?: string;
  organizationName?: string;
  industry?: string;
  description?: string;
  location?: string;
  websiteUrl?: string;
  logoUrl?: string;
  isPublic?: boolean;
}

export interface UpdateEmployerProfileInput {
  employerType?: "individual" | "organization";
  displayName?: string | null;
  organizationName?: string | null;
  industry?: string | null;
  description?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  isPublic?: boolean;
}

// ─── Mock stubs (used when USE_MOCK_API is true) ──────────────────────────────

const MOCK_PROFILE: EmployerProfile = {
  id: "mock-emp-profile",
  userId: "me",
  employerType: "individual",
  displayName: "Demo Employer",
  organizationName: null,
  industry: "Technology",
  description: "A demo employer account.",
  location: "Lagos, Nigeria",
  websiteUrl: null,
  logoUrl: null,
  isPublic: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Get the authenticated employer's own profile.
 * Returns 404 if no profile has been created yet.
 */
export function getProfile(): Promise<{ profile: EmployerProfile }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ profile: MOCK_PROFILE });
  }
  return apiFetch<{ profile: EmployerProfile }>("/v1/employers/profile");
}

/**
 * Create the authenticated employer's profile.
 * Returns 409 if a profile already exists.
 */
export function createProfile(
  input: CreateEmployerProfileInput,
): Promise<{ profile: EmployerProfile }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ profile: { ...MOCK_PROFILE, ...input } });
  }
  return apiFetch<{ profile: EmployerProfile }>("/v1/employers/profile", {
    method: "POST",
    body: input,
  });
}

/**
 * Update the authenticated employer's profile.
 * Only include fields you want to change.
 */
export function updateProfile(
  input: UpdateEmployerProfileInput,
): Promise<{ profile: EmployerProfile }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ profile: { ...MOCK_PROFILE, ...input } });
  }
  return apiFetch<{ profile: EmployerProfile }>("/v1/employers/profile", {
    method: "PATCH",
    body: input,
  });
}
