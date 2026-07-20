/**
 * Employer profile service.
 *
 * Completeness scoring (0–100):
 *   display_name   20 pts
 *   description    25 pts
 *   industry       15 pts
 *   location       20 pts
 *   website_url    10 pts
 *   logo_url       10 pts
 *   ──────────────────────
 *   max           100 pts
 *
 * Note: organization_name is not scored separately — it is part of the
 * display_name requirement for organizations and optional for individuals.
 */

import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { employerProfiles, type EmployerProfile, type EmployerType } from "../db/schema/index.js";
import { ConflictError, NotFoundError } from "../errors/index.js";

// ─── DTO ──────────────────────────────────────────────────────────────────────

export interface EmployerProfileDto {
  id: string;
  userId: string;
  employerType: string;
  displayName: string | null;
  organizationName: string | null;
  industry: string | null;
  description: string | null;
  location: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  isPublic: boolean;
  completenessScore: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Completeness computation ─────────────────────────────────────────────────

/**
 * Pure, deterministic completeness function.
 * Does not factor in organization_name beyond the display_name score — a
 * future stage can introduce type-specific scoring weights if needed.
 */
export function computeEmployerCompleteness(
  profile: Pick<
    EmployerProfile,
    "displayName" | "description" | "industry" | "location" | "websiteUrl" | "logoUrl"
  >,
): number {
  let score = 0;
  if (profile.displayName) score += 20;
  if (profile.description) score += 25;
  if (profile.industry) score += 15;
  if (profile.location) score += 20;
  if (profile.websiteUrl) score += 10;
  if (profile.logoUrl) score += 10;
  return Math.min(score, 100);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toDto(profile: EmployerProfile): EmployerProfileDto {
  return {
    id: profile.id,
    userId: profile.userId,
    employerType: profile.employerType,
    displayName: profile.displayName,
    organizationName: profile.organizationName,
    industry: profile.industry,
    description: profile.description,
    location: profile.location,
    websiteUrl: profile.websiteUrl,
    logoUrl: profile.logoUrl,
    isPublic: profile.isPublic,
    completenessScore: profile.completenessScore,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function recomputeAndSave(db: Db, profile: EmployerProfile): Promise<number> {
  const score = computeEmployerCompleteness(profile);
  await db
    .update(employerProfiles)
    .set({ completenessScore: score, updatedAt: new Date() })
    .where(eq(employerProfiles.id, profile.id));
  return score;
}

// ─── Public service API ───────────────────────────────────────────────────────

export interface CreateEmployerProfileParams {
  employerType?: EmployerType;
  displayName?: string;
  organizationName?: string;
  industry?: string;
  description?: string;
  location?: string;
  websiteUrl?: string;
  logoUrl?: string;
  isPublic?: boolean;
}

export interface UpdateEmployerProfileParams {
  employerType?: EmployerType;
  displayName?: string | null;
  organizationName?: string | null;
  industry?: string | null;
  description?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  isPublic?: boolean;
}

/**
 * Create an employer profile. Throws ConflictError if one already exists.
 */
export async function createEmployerProfile(
  db: Db,
  userId: string,
  params: CreateEmployerProfileParams,
): Promise<EmployerProfileDto> {
  const [existing] = await db
    .select({ id: employerProfiles.id })
    .from(employerProfiles)
    .where(eq(employerProfiles.userId, userId))
    .limit(1);

  if (existing) {
    throw new ConflictError("An employer profile already exists for this account.");
  }

  const id = crypto.randomUUID();
  await db.insert(employerProfiles).values({
    id,
    userId,
    employerType: params.employerType ?? "individual",
    displayName: params.displayName ?? null,
    organizationName: params.organizationName ?? null,
    industry: params.industry ?? null,
    description: params.description ?? null,
    location: params.location ?? null,
    websiteUrl: params.websiteUrl ?? null,
    logoUrl: params.logoUrl ?? null,
    isPublic: params.isPublic ?? false,
    completenessScore: 0,
  });

  const profile = (
    await db.select().from(employerProfiles).where(eq(employerProfiles.id, id)).limit(1)
  )[0]!;

  const score = await recomputeAndSave(db, profile);
  profile.completenessScore = score;

  return toDto(profile);
}

/** Load an employer profile by user ID. Returns null if not found. */
export async function getEmployerProfileByUserId(
  db: Db,
  userId: string,
): Promise<EmployerProfileDto | null> {
  const [profile] = await db
    .select()
    .from(employerProfiles)
    .where(eq(employerProfiles.userId, userId))
    .limit(1);

  return profile ? toDto(profile) : null;
}

/** Load an employer profile by its own ID. Returns null if not found. */
export async function getEmployerProfileById(
  db: Db,
  profileId: string,
): Promise<EmployerProfileDto | null> {
  const [profile] = await db
    .select()
    .from(employerProfiles)
    .where(eq(employerProfiles.id, profileId))
    .limit(1);

  return profile ? toDto(profile) : null;
}

/**
 * Update an employer profile.
 * Ownership is enforced by the route handler.
 */
export async function updateEmployerProfile(
  db: Db,
  profileId: string,
  params: UpdateEmployerProfileParams,
): Promise<EmployerProfileDto> {
  const [existing] = await db
    .select()
    .from(employerProfiles)
    .where(eq(employerProfiles.id, profileId))
    .limit(1);

  if (!existing) throw new NotFoundError("Employer profile not found.");

  const updates: Partial<typeof employerProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (params.employerType !== undefined) updates.employerType = params.employerType;
  if (params.displayName !== undefined) updates.displayName = params.displayName;
  if (params.organizationName !== undefined) updates.organizationName = params.organizationName;
  if (params.industry !== undefined) updates.industry = params.industry;
  if (params.description !== undefined) updates.description = params.description;
  if (params.location !== undefined) updates.location = params.location;
  if (params.websiteUrl !== undefined) updates.websiteUrl = params.websiteUrl;
  if (params.logoUrl !== undefined) updates.logoUrl = params.logoUrl;
  if (params.isPublic !== undefined) updates.isPublic = params.isPublic;

  await db.update(employerProfiles).set(updates).where(eq(employerProfiles.id, profileId));

  const updated = (
    await db.select().from(employerProfiles).where(eq(employerProfiles.id, profileId)).limit(1)
  )[0]!;

  const score = await recomputeAndSave(db, updated);
  updated.completenessScore = score;

  return toDto(updated);
}
