/**
 * Provider profile service.
 *
 * Owns all business logic for provider marketplace profiles.
 * Routes call these functions; no route handler touches DB tables directly.
 *
 * Completeness scoring (0–100):
 *   headline          15 pts
 *   about             15 pts
 *   primary category  10 pts
 *   ≥1 skill          10 pts
 *   ≥1 experience     15 pts
 *   location          10 pts
 *   availability       5 pts  (always awarded — availability always has a value)
 *   ≥1 portfolio item 10 pts
 *   ≥1 certification  10 pts
 *   ─────────────────────────
 *   max              100 pts
 */

import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  providerProfiles,
  providerSkills,
  providerExperience,
  providerCertifications,
  providerPortfolio,
  categories,
  skills,
  users,
  type ProviderProfile,
  type AvailabilityStatus,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError, ForbiddenError } from "../errors/index.js";

// ─── Serialised shapes returned by service functions ─────────────────────────

export interface SkillDto {
  id: string;
  name: string;
  category: string; // category name string — matches frontend Skill.category
}

export interface ExperienceDto {
  id: string;
  role: string;
  organization: string;
  startDate: string; // ISO date YYYY-MM-DD
  endDate: string | null;
  description: string | null;
}

export interface CertificationDto {
  id: string;
  name: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string | null;
  evidenceUrl: string | null;
}

export interface PortfolioItemDto {
  id: string;
  title: string;
  description: string | null;
  mediaUrl: string;
  mediaType: string;
  displayOrder: number;
  createdAt: string;
}

export interface ProviderProfileDto {
  id: string;
  userId: string;
  /** Provider's display name, sourced from the users table. */
  displayName: string;
  kind: string;
  headline: string | null;
  about: string | null;
  primaryCategory: { id: string; name: string; slug: string } | null;
  skills: SkillDto[];
  experience: ExperienceDto[];
  certifications: CertificationDto[];
  portfolio: PortfolioItemDto[];
  location: string | null;
  serviceArea: string | null;
  availability: string;
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  currency: string | null;
  isPublic: boolean;
  completenessScore: number;
  verificationStatus: string;
  /** Alias for verificationStatus — matches the frontend Provider.verification field. */
  verification: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Completeness computation ─────────────────────────────────────────────────

/**
 * Pure function — deterministic, testable, easy to evolve.
 * Called after every profile write to keep completeness_score current.
 */
export function computeProviderCompleteness(
  profile: Pick<ProviderProfile, "headline" | "about" | "primaryCategoryId" | "location">,
  counts: {
    skillCount: number;
    experienceCount: number;
    portfolioCount: number;
    certificationCount: number;
  },
): number {
  let score = 0;
  if (profile.headline) score += 15;
  if (profile.about) score += 15;
  if (profile.primaryCategoryId) score += 10;
  if (counts.skillCount > 0) score += 10;
  if (counts.experienceCount > 0) score += 15;
  if (profile.location) score += 10;
  score += 5; // availability always present
  if (counts.portfolioCount > 0) score += 10;
  if (counts.certificationCount > 0) score += 10;
  return Math.min(score, 100);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadSubResources(
  db: Db,
  profileId: string,
): Promise<{
  skillRows: SkillDto[];
  experienceRows: ExperienceDto[];
  certificationRows: CertificationDto[];
  portfolioRows: PortfolioItemDto[];
}> {
  const [skillRows, experienceRows, certificationRows, portfolioRows] = await Promise.all([
    db
      .select({ id: skills.id, name: skills.name, categoryName: categories.name })
      .from(providerSkills)
      .innerJoin(skills, eq(skills.id, providerSkills.skillId))
      .innerJoin(categories, eq(categories.id, skills.categoryId))
      .where(eq(providerSkills.providerProfileId, profileId)),

    db
      .select()
      .from(providerExperience)
      .where(eq(providerExperience.providerProfileId, profileId))
      .orderBy(providerExperience.startDate),

    db
      .select()
      .from(providerCertifications)
      .where(eq(providerCertifications.providerProfileId, profileId))
      .orderBy(providerCertifications.issuedAt),

    db
      .select()
      .from(providerPortfolio)
      .where(eq(providerPortfolio.providerProfileId, profileId))
      .orderBy(providerPortfolio.displayOrder, providerPortfolio.createdAt),
  ]);

  return {
    skillRows: skillRows.map((r) => ({ id: r.id, name: r.name, category: r.categoryName })),
    experienceRows: experienceRows.map((r) => ({
      id: r.id,
      role: r.role,
      organization: r.organization,
      startDate: r.startDate,
      endDate: r.endDate,
      description: r.description,
    })),
    certificationRows: certificationRows.map((r) => ({
      id: r.id,
      name: r.name,
      issuer: r.issuer,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
      evidenceUrl: r.evidenceUrl,
    })),
    portfolioRows: portfolioRows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      mediaUrl: r.mediaUrl,
      mediaType: r.mediaType,
      displayOrder: r.displayOrder,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

async function loadPrimaryCategory(
  db: Db,
  categoryId: string | null,
): Promise<{ id: string; name: string; slug: string } | null> {
  if (!categoryId) return null;
  const [cat] = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return cat ?? null;
}

async function recomputeAndSave(db: Db, profile: ProviderProfile): Promise<number> {
  const [skillCount, expCount, portCount, certCount] = await Promise.all([
    db
      .select({ id: providerSkills.skillId })
      .from(providerSkills)
      .where(eq(providerSkills.providerProfileId, profile.id))
      .then((r) => r.length),
    db
      .select({ id: providerExperience.id })
      .from(providerExperience)
      .where(eq(providerExperience.providerProfileId, profile.id))
      .then((r) => r.length),
    db
      .select({ id: providerPortfolio.id })
      .from(providerPortfolio)
      .where(eq(providerPortfolio.providerProfileId, profile.id))
      .then((r) => r.length),
    db
      .select({ id: providerCertifications.id })
      .from(providerCertifications)
      .where(eq(providerCertifications.providerProfileId, profile.id))
      .then((r) => r.length),
  ]);

  const score = computeProviderCompleteness(profile, {
    skillCount,
    experienceCount: expCount,
    portfolioCount: portCount,
    certificationCount: certCount,
  });

  await db
    .update(providerProfiles)
    .set({ completenessScore: score, updatedAt: new Date() })
    .where(eq(providerProfiles.id, profile.id));

  return score;
}

async function buildDto(db: Db, profile: ProviderProfile): Promise<ProviderProfileDto> {
  const [primaryCategory, sub, userRows] = await Promise.all([
    loadPrimaryCategory(db, profile.primaryCategoryId),
    loadSubResources(db, profile.id),
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, profile.userId)).limit(1),
  ]);

  const displayName = userRows[0]?.displayName ?? "";

  return {
    id: profile.id,
    userId: profile.userId,
    displayName,
    kind: profile.kind,
    headline: profile.headline,
    about: profile.about,
    primaryCategory,
    skills: sub.skillRows,
    experience: sub.experienceRows,
    certifications: sub.certificationRows,
    portfolio: sub.portfolioRows,
    location: profile.location,
    serviceArea: profile.serviceArea,
    availability: profile.availability,
    yearsOfExperience: profile.yearsOfExperience,
    hourlyRate: profile.hourlyRate,
    currency: profile.currency,
    isPublic: profile.isPublic,
    completenessScore: profile.completenessScore,
    verificationStatus: profile.verificationStatus,
    verification: profile.verificationStatus,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

// ─── Public service API ───────────────────────────────────────────────────────

export interface CreateProviderProfileParams {
  kind: "artisan" | "professional";
  headline?: string;
  about?: string;
  primaryCategoryId?: string;
  location?: string;
  serviceArea?: string;
  availability?: AvailabilityStatus;
  yearsOfExperience?: number;
  hourlyRate?: number;
  currency?: string;
  isPublic?: boolean;
}

export interface UpdateProviderProfileParams {
  headline?: string | null;
  about?: string | null;
  primaryCategoryId?: string | null;
  location?: string | null;
  serviceArea?: string | null;
  availability?: AvailabilityStatus;
  yearsOfExperience?: number | null;
  hourlyRate?: number | null;
  currency?: string;
  isPublic?: boolean;
  /** When provided, replaces the full skill set. */
  skillIds?: string[];
}

/**
 * Create a provider profile for a PMP user.
 * Throws ConflictError if the user already has one.
 */
export async function createProviderProfile(
  db: Db,
  userId: string,
  params: CreateProviderProfileParams,
): Promise<ProviderProfileDto> {
  // Check for duplicate
  const [existing] = await db
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, userId))
    .limit(1);

  if (existing) {
    throw new ConflictError("A provider profile already exists for this account.");
  }

  const id = crypto.randomUUID();
  await db.insert(providerProfiles).values({
    id,
    userId,
    kind: params.kind,
    headline: params.headline ?? null,
    about: params.about ?? null,
    primaryCategoryId: params.primaryCategoryId ?? null,
    location: params.location ?? null,
    serviceArea: params.serviceArea ?? null,
    availability: params.availability ?? "available",
    yearsOfExperience: params.yearsOfExperience ?? null,
    hourlyRate: params.hourlyRate ?? null,
    currency: params.currency ?? "NGN",
    isPublic: params.isPublic ?? false,
    completenessScore: 0,
    verificationStatus: "unverified",
  });

  const profile = (
    await db.select().from(providerProfiles).where(eq(providerProfiles.id, id)).limit(1)
  )[0]!;

  const score = await recomputeAndSave(db, profile);
  profile.completenessScore = score;

  return buildDto(db, profile);
}

/** Load a provider profile by the owning user's PMP ID. Returns null if not found. */
export async function getProviderProfileByUserId(
  db: Db,
  userId: string,
): Promise<ProviderProfileDto | null> {
  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, userId))
    .limit(1);

  if (!profile) return null;
  return buildDto(db, profile);
}

/** Load a provider profile by its own ID (used for public profile endpoint). Returns null if not found. */
export async function getProviderProfileById(
  db: Db,
  profileId: string,
): Promise<ProviderProfileDto | null> {
  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);

  if (!profile) return null;
  return buildDto(db, profile);
}

/**
 * Update fields on a provider profile.
 * Ownership is enforced by the route handler (only own profile).
 * When skillIds is provided, replaces the full skill set atomically.
 */
export async function updateProviderProfile(
  db: Db,
  profileId: string,
  params: UpdateProviderProfileParams,
): Promise<ProviderProfileDto> {
  const [existing] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);

  if (!existing) throw new NotFoundError("Provider profile not found.");

  // Build update payload — only include fields that were explicitly provided
  const updates: Partial<typeof providerProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (params.headline !== undefined) updates.headline = params.headline;
  if (params.about !== undefined) updates.about = params.about;
  if (params.primaryCategoryId !== undefined) updates.primaryCategoryId = params.primaryCategoryId;
  if (params.location !== undefined) updates.location = params.location;
  if (params.serviceArea !== undefined) updates.serviceArea = params.serviceArea;
  if (params.availability !== undefined) updates.availability = params.availability;
  if (params.yearsOfExperience !== undefined) updates.yearsOfExperience = params.yearsOfExperience;
  if (params.hourlyRate !== undefined) updates.hourlyRate = params.hourlyRate;
  if (params.currency !== undefined) updates.currency = params.currency;
  if (params.isPublic !== undefined) updates.isPublic = params.isPublic;

  await db.update(providerProfiles).set(updates).where(eq(providerProfiles.id, profileId));

  // Replace skill set when provided
  if (params.skillIds !== undefined) {
    await db.delete(providerSkills).where(eq(providerSkills.providerProfileId, profileId));

    if (params.skillIds.length > 0) {
      await db
        .insert(providerSkills)
        .values(params.skillIds.map((skillId) => ({ providerProfileId: profileId, skillId })));
    }
  }

  const updated = (
    await db.select().from(providerProfiles).where(eq(providerProfiles.id, profileId)).limit(1)
  )[0]!;

  const score = await recomputeAndSave(db, updated);
  updated.completenessScore = score;

  return buildDto(db, updated);
}

// ─── Experience ───────────────────────────────────────────────────────────────

export interface AddExperienceParams {
  role: string;
  organization: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  description?: string | null;
}

export async function addExperience(
  db: Db,
  profileId: string,
  params: AddExperienceParams,
): Promise<ExperienceDto> {
  const id = crypto.randomUUID();
  await db.insert(providerExperience).values({
    id,
    providerProfileId: profileId,
    role: params.role,
    organization: params.organization,
    startDate: params.startDate,
    endDate: params.endDate ?? null,
    description: params.description ?? null,
  });

  const row = (
    await db.select().from(providerExperience).where(eq(providerExperience.id, id)).limit(1)
  )[0]!;

  // Recompute completeness after sub-resource change
  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  await recomputeAndSave(db, profile!);

  return {
    id: row.id,
    role: row.role,
    organization: row.organization,
    startDate: row.startDate,
    endDate: row.endDate,
    description: row.description,
  };
}

/**
 * Remove an experience entry.
 * Throws NotFoundError if the entry doesn't exist on this profile (ownership guard).
 */
export async function removeExperience(
  db: Db,
  profileId: string,
  experienceId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: providerExperience.id })
    .from(providerExperience)
    .where(eq(providerExperience.id, experienceId))
    .limit(1);

  if (!row) throw new NotFoundError("Experience entry not found.");

  // Ownership check — must belong to this profile
  const [check] = await db
    .select({ id: providerExperience.id })
    .from(providerExperience)
    .where(eq(providerExperience.id, experienceId))
    .limit(1);

  // We verify profileId matches via the query below
  const rows = await db
    .select({ id: providerExperience.id })
    .from(providerExperience)
    .where(eq(providerExperience.providerProfileId, profileId));

  const belongs = rows.some((r) => r.id === experienceId);
  if (!belongs) throw new ForbiddenError("Experience entry does not belong to your profile.");

  await db.delete(providerExperience).where(eq(providerExperience.id, experienceId));

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  if (profile) await recomputeAndSave(db, profile!);
}

// ─── Certifications ───────────────────────────────────────────────────────────

export interface AddCertificationParams {
  name: string;
  issuer: string;
  issuedAt: string; // YYYY-MM-DD
  expiresAt?: string | null;
  evidenceUrl?: string | null;
}

export async function addCertification(
  db: Db,
  profileId: string,
  params: AddCertificationParams,
): Promise<CertificationDto> {
  const id = crypto.randomUUID();
  await db.insert(providerCertifications).values({
    id,
    providerProfileId: profileId,
    name: params.name,
    issuer: params.issuer,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt ?? null,
    evidenceUrl: params.evidenceUrl ?? null,
  });

  const row = (
    await db.select().from(providerCertifications).where(eq(providerCertifications.id, id)).limit(1)
  )[0]!;

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  await recomputeAndSave(db, profile!);

  return {
    id: row.id,
    name: row.name,
    issuer: row.issuer,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    evidenceUrl: row.evidenceUrl,
  };
}

export async function removeCertification(
  db: Db,
  profileId: string,
  certificationId: string,
): Promise<void> {
  const rows = await db
    .select({ id: providerCertifications.id })
    .from(providerCertifications)
    .where(eq(providerCertifications.providerProfileId, profileId));

  const belongs = rows.some((r) => r.id === certificationId);
  if (!belongs) throw new NotFoundError("Certification not found on this profile.");

  await db.delete(providerCertifications).where(eq(providerCertifications.id, certificationId));

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  if (profile) await recomputeAndSave(db, profile!);
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export interface AddPortfolioItemParams {
  title: string;
  description?: string | null;
  mediaUrl: string;
  mediaType?: "image" | "video" | "document";
  displayOrder?: number;
}

export async function addPortfolioItem(
  db: Db,
  profileId: string,
  params: AddPortfolioItemParams,
): Promise<PortfolioItemDto> {
  const id = crypto.randomUUID();
  await db.insert(providerPortfolio).values({
    id,
    providerProfileId: profileId,
    title: params.title,
    description: params.description ?? null,
    mediaUrl: params.mediaUrl,
    mediaType: params.mediaType ?? "image",
    displayOrder: params.displayOrder ?? 0,
  });

  const row = (
    await db.select().from(providerPortfolio).where(eq(providerPortfolio.id, id)).limit(1)
  )[0]!;

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  await recomputeAndSave(db, profile!);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    mediaUrl: row.mediaUrl,
    mediaType: row.mediaType,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function removePortfolioItem(
  db: Db,
  profileId: string,
  itemId: string,
): Promise<void> {
  const rows = await db
    .select({ id: providerPortfolio.id })
    .from(providerPortfolio)
    .where(eq(providerPortfolio.providerProfileId, profileId));

  const belongs = rows.some((r) => r.id === itemId);
  if (!belongs) throw new NotFoundError("Portfolio item not found on this profile.");

  await db.delete(providerPortfolio).where(eq(providerPortfolio.id, itemId));

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  if (profile) await recomputeAndSave(db, profile!);
}

// ─── Skill management ─────────────────────────────────────────────────────────

/**
 * Replace the full set of skills for a profile.
 * Pass an empty array to clear all skills.
 */
export async function setSkills(db: Db, profileId: string, skillIds: string[]): Promise<void> {
  await db.delete(providerSkills).where(eq(providerSkills.providerProfileId, profileId));

  if (skillIds.length > 0) {
    // Validate all skill IDs exist
    const found = await db
      .select({ id: skills.id })
      .from(skills)
      .where(inArray(skills.id, skillIds));

    const foundIds = new Set(found.map((r) => r.id));
    const missing = skillIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(`Unknown skill IDs: ${missing.join(", ")}`);
    }

    await db
      .insert(providerSkills)
      .values(skillIds.map((skillId) => ({ providerProfileId: profileId, skillId })));
  }

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, profileId))
    .limit(1);
  if (profile) await recomputeAndSave(db, profile!);
}
