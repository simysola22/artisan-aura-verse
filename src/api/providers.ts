/**
 * Provider API — public listing, profile management, and sub-resources.
 *
 * Real mode: calls backend /v1/providers/* and /v1/search/providers endpoints.
 * Mock mode: delegates to the in-memory mock adapter.
 *
 * Backend routes used:
 *   GET    /v1/search/providers           Public provider search (used for list())
 *   GET    /v1/providers/:profileId       Public profile by ID
 *   GET    /v1/providers/profile          Own profile (authenticated)
 *   POST   /v1/providers/profile          Create own profile
 *   PATCH  /v1/providers/profile          Update own profile
 *   POST   /v1/providers/profile/experience
 *   DELETE /v1/providers/profile/experience/:id
 *   POST   /v1/providers/profile/certifications
 *   DELETE /v1/providers/profile/certifications/:id
 *   POST   /v1/providers/profile/portfolio
 *   DELETE /v1/providers/profile/portfolio/:id
 */

import { USE_MOCK_API, apiFetch } from "./client";
import { mockProviders } from "./mock/adapter";
import type { Provider, SearchResult } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  userId: string;
  kind: "artisan" | "professional";
  headline: string | null;
  about: string | null;
  primaryCategoryId: string | null;
  location: string | null;
  serviceArea: string | null;
  availability: "available" | "limited" | "unavailable" | null;
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  currency: string | null;
  isPublic: boolean;
  verificationStatus: string;
  completenessScore: number;
  createdAt: string;
  updatedAt: string;
  skills?: { id: string; name: string; category: string }[];
  experience?: ExperienceEntry[];
  certifications?: CertificationEntry[];
  portfolio?: PortfolioEntry[];
}

export interface CreateProviderProfileInput {
  kind: "artisan" | "professional";
  headline?: string;
  about?: string;
  primaryCategoryId?: string;
  location?: string;
  serviceArea?: string;
  availability?: "available" | "limited" | "unavailable";
  yearsOfExperience?: number;
  hourlyRate?: number;
  currency?: string;
  isPublic?: boolean;
}

export interface UpdateProviderProfileInput {
  headline?: string | null;
  about?: string | null;
  primaryCategoryId?: string | null;
  location?: string | null;
  serviceArea?: string | null;
  availability?: "available" | "limited" | "unavailable";
  yearsOfExperience?: number | null;
  hourlyRate?: number | null;
  currency?: string;
  isPublic?: boolean;
  skillIds?: string[];
}

export interface ExperienceEntry {
  id?: string;
  role: string;
  organization: string;
  startDate: string;
  endDate?: string | null;
  description?: string | null;
}

export interface CertificationEntry {
  id?: string;
  name: string;
  issuer: string;
  issuedAt: string;
  expiresAt?: string | null;
  evidenceUrl?: string | null;
}

export interface PortfolioEntry {
  id?: string;
  title: string;
  description?: string | null;
  mediaUrl: string;
  mediaType?: "image" | "video" | "document";
  displayOrder?: number;
}

// ─── Public listing & search ──────────────────────────────────────────────────

/**
 * List providers for discovery. In real mode uses the search endpoint.
 * In mock mode falls back to the in-memory provider list.
 */
export function list(): Promise<Provider[]> {
  if (USE_MOCK_API) return mockProviders.list();
  // Backend search returns SearchResult; unwrap to Provider[] for compatibility.
  return apiFetch<SearchResult>("/v1/search/providers", { auth: false }).then((r) => r.items);
}

/** Shape of the backend's GET /v1/providers/:profileId response profile object. */
interface BackendPublicProfile {
  id: string;
  userId: string;
  displayName: string;
  kind: string;
  headline: string | null;
  about: string | null;
  primaryCategory: { id: string; name: string; slug: string } | null;
  skills: { id: string; name: string; category: string }[];
  experience: { id: string; role: string; organization: string; startDate: string; endDate: string | null; description: string | null }[];
  certifications: { id: string; name: string; issuer: string; issuedAt: string; expiresAt: string | null; evidenceUrl: string | null }[];
  portfolio: { id: string; title: string; description: string | null; mediaUrl: string; mediaType: string; displayOrder: number; createdAt: string }[];
  serviceArea: string | null;
  availability: string | null;
  hourlyRate: number | null;
  currency: string | null;
  verificationStatus: string;
  verification: string;
  createdAt: string;
}

/**
 * Get a public provider profile by ID.
 * Maps the backend ProviderProfileDto shape to the frontend Provider type.
 */
export function get(id: string): Promise<Provider> {
  if (USE_MOCK_API) return mockProviders.get(id);
  return apiFetch<{ profile: BackendPublicProfile }>(`/v1/providers/${id}`).then((r) => {
    const p = r.profile;
    return {
      // UserBase fields
      id: p.id,
      email: "",            // not exposed on public profile endpoint
      role: "provider" as const,
      displayName: p.displayName,
      createdAt: p.createdAt,
      // Provider-specific fields
      userId: p.userId,
      kind: p.kind as "artisan" | "professional",
      headline: p.headline ?? "",
      about: p.about ?? undefined,
      category: p.primaryCategory?.name ?? "",
      skills: p.skills,
      experience: p.experience.map((e) => ({
        id: e.id,
        role: e.role,
        organization: e.organization,
        startDate: e.startDate,
        endDate: e.endDate ?? undefined,
        description: e.description ?? undefined,
      })),
      certifications: p.certifications.map((c) => ({
        id: c.id,
        name: c.name,
        issuer: c.issuer,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt ?? undefined,
        evidenceUrl: c.evidenceUrl ?? undefined,
      })),
      portfolio: p.portfolio.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? undefined,
        mediaUrl: item.mediaUrl,
        mediaType: item.mediaType as "image" | "video" | "document",
        createdAt: item.createdAt,
      })),
      verification: (p.verification ?? p.verificationStatus) as import("@/types").VerificationStatus,
      serviceArea: p.serviceArea ?? undefined,
      availability: p.availability as "available" | "limited" | "unavailable" | undefined,
      hourlyRate: p.hourlyRate ?? undefined,
      currency: p.currency ?? undefined,
    };
  });
}

// ─── Own profile management (authenticated) ───────────────────────────────────

/** Get the authenticated provider's own profile. Returns 404 if not created. */
export function getOwnProfile(): Promise<{ profile: ProviderProfile }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      profile: {
        id: "mock-prov-profile",
        userId: "me",
        kind: "artisan",
        headline: "Demo Provider",
        about: null,
        primaryCategoryId: null,
        location: null,
        serviceArea: null,
        availability: "available",
        yearsOfExperience: null,
        hourlyRate: null,
        currency: "NGN",
        isPublic: true,
        verificationStatus: "unverified",
        completenessScore: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return apiFetch<{ profile: ProviderProfile }>("/v1/providers/profile");
}

/** Create the authenticated provider's profile. */
export function createProfile(
  input: CreateProviderProfileInput,
): Promise<{ profile: ProviderProfile }> {
  if (USE_MOCK_API) {
    return Promise.resolve({
      profile: {
        id: "mock-prov-profile",
        userId: "me",
        kind: input.kind,
        headline: input.headline ?? null,
        about: input.about ?? null,
        primaryCategoryId: input.primaryCategoryId ?? null,
        location: input.location ?? null,
        serviceArea: input.serviceArea ?? null,
        availability: input.availability ?? "available",
        yearsOfExperience: input.yearsOfExperience ?? null,
        hourlyRate: input.hourlyRate ?? null,
        currency: input.currency ?? "NGN",
        isPublic: input.isPublic ?? true,
        verificationStatus: "unverified",
        completenessScore: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return apiFetch<{ profile: ProviderProfile }>("/v1/providers/profile", {
    method: "POST",
    body: input,
  });
}

/** Update the authenticated provider's profile. Only include fields to change. */
export function updateProfile(
  input: UpdateProviderProfileInput,
): Promise<{ profile: ProviderProfile }> {
  if (USE_MOCK_API) {
    return getOwnProfile().then((r) => ({ profile: { ...r.profile, ...input } as ProviderProfile }));
  }
  return apiFetch<{ profile: ProviderProfile }>("/v1/providers/profile", {
    method: "PATCH",
    body: input,
  });
}

// ─── Experience ───────────────────────────────────────────────────────────────

export function addExperience(
  entry: ExperienceEntry,
): Promise<{ experience: ExperienceEntry }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ experience: { id: `exp-${Date.now()}`, ...entry } });
  }
  return apiFetch<{ experience: ExperienceEntry }>("/v1/providers/profile/experience", {
    method: "POST",
    body: entry,
  });
}

export function deleteExperience(id: string): Promise<void> {
  if (USE_MOCK_API) return Promise.resolve();
  return apiFetch<void>(`/v1/providers/profile/experience/${id}`, { method: "DELETE" });
}

// ─── Certifications ───────────────────────────────────────────────────────────

export function addCertification(
  entry: CertificationEntry,
): Promise<{ certification: CertificationEntry }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ certification: { id: `cert-${Date.now()}`, ...entry } });
  }
  return apiFetch<{ certification: CertificationEntry }>("/v1/providers/profile/certifications", {
    method: "POST",
    body: entry,
  });
}

export function deleteCertification(id: string): Promise<void> {
  if (USE_MOCK_API) return Promise.resolve();
  return apiFetch<void>(`/v1/providers/profile/certifications/${id}`, { method: "DELETE" });
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export function addPortfolioItem(
  entry: PortfolioEntry,
): Promise<{ item: PortfolioEntry }> {
  if (USE_MOCK_API) {
    return Promise.resolve({ item: { id: `portfolio-${Date.now()}`, ...entry } });
  }
  return apiFetch<{ item: PortfolioEntry }>("/v1/providers/profile/portfolio", {
    method: "POST",
    body: entry,
  });
}

export function deletePortfolioItem(id: string): Promise<void> {
  if (USE_MOCK_API) return Promise.resolve();
  return apiFetch<void>(`/v1/providers/profile/portfolio/${id}`, { method: "DELETE" });
}
