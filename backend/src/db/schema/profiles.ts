/**
 * Stage 3 — Core Domain & Profiles
 *
 * Tables:
 *   categories           — reference data: service categories
 *   skills               — reference data: skills within categories
 *   provider_profiles    — marketplace profile for users with account_type='provider'
 *   provider_skills      — m2m: provider ↔ skills
 *   provider_experience  — work history entries for a provider
 *   provider_certifications — credentials held by a provider
 *   provider_portfolio   — portfolio items (URL references, no binary storage)
 *   employer_profiles    — marketplace profile for users with account_type='employer'
 *
 * Architectural decision (documented):
 *   Profiles are separate entities from the `users` auth record. A user's
 *   account_type drives RBAC but does NOT prevent the schema from supporting
 *   dual profiles in a future stage. For Stage 3, authorization rules enforce
 *   that only account_type='provider' can create a provider profile and only
 *   account_type='employer' can create an employer profile; this can be relaxed
 *   later without a schema migration.
 */

import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  boolean,
  integer,
  date,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * Verification lifecycle for provider profiles.
 * Matches the frontend VerificationStatus union in src/types/index.ts.
 * Stage 4 will implement the full verification workflow; Stage 3 seeds the
 * status column so the schema is already compatible.
 */
export const providerVerificationStatusEnum = pgEnum("provider_verification_status", [
  "unverified",
  "in_review",
  "additional_info_requested",
  "verified",
  "rejected",
]);

/** Provider/employer availability for new work. */
export const availabilityStatusEnum = pgEnum("availability_status", [
  "available",
  "limited",
  "unavailable",
]);

/** Whether an employer is an individual or an organisation. */
export const employerTypeEnum = pgEnum("employer_type", ["individual", "organization"]);

/** Media type for portfolio items. */
export const mediaTypeEnum = pgEnum("media_type", ["image", "video", "document"]);

/**
 * Which provider kind(s) a category or skill applies to.
 * 'both' means it applies to artisans and professionals alike.
 */
export const categoryKindEnum = pgEnum("category_kind", ["artisan", "professional", "both"]);

// ─── Reference data ───────────────────────────────────────────────────────────

/**
 * Service categories — seeded by migration, manageable by admin (Stage 8).
 * Categories are the top-level classification for provider discovery.
 */
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  /** Which provider type(s) this category applies to. */
  kind: categoryKindEnum("kind").notNull().default("both"),
  description: text("description"),
  /** Icon identifier (e.g. lucide icon name or URL). */
  icon: text("icon"),
  /** Controls display order in UI. Lower values appear first. */
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Skills — children of categories.
 * Skills are the granular tags that providers attach to their profiles and that
 * employers use to filter search results (Stage 5).
 */
export const skills = pgTable(
  "skills",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    kind: categoryKindEnum("kind").notNull().default("both"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("skills_category_idx").on(t.categoryId), index("skills_kind_idx").on(t.kind)],
);

// ─── Provider profiles ────────────────────────────────────────────────────────

/**
 * Provider marketplace profile.
 * One provider profile per user (UNIQUE on user_id).
 * The kind column mirrors users.provider_kind and must match it — enforced
 * in the service layer rather than via a DB trigger to keep logic auditable.
 */
export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: text("id").primaryKey(),
    /** FK to users.id — the PMP identity that owns this profile. */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Artisan or professional — must match users.provider_kind. */
    kind: text("kind").notNull().$type<"artisan" | "professional">(),

    /** Short professional headline shown in search results. */
    headline: text("headline"),
    /** Longer biography / about section. */
    about: text("about"),

    /** Primary service category for discovery. */
    primaryCategoryId: text("primary_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    /** City / region the provider is based in. */
    location: text("location"),
    /** Geographic area the provider is willing to serve. */
    serviceArea: text("service_area"),

    availability: availabilityStatusEnum("availability").notNull().default("available"),

    /**
     * Self-reported years of experience.
     * Denormalized for fast search filtering (Stage 5).
     * Providers may also fill experience entries to substantiate this.
     */
    yearsOfExperience: integer("years_of_experience"),

    /**
     * Optional hourly rate in whole currency units.
     * Currency defaults to NGN (Nigerian Naira) — the primary market.
     */
    hourlyRate: integer("hourly_rate"),
    currency: text("currency").default("NGN"),

    /**
     * When true, the profile is visible to authenticated employers.
     * When false, only the owner can view it.
     */
    isPublic: boolean("is_public").notNull().default(false),

    /**
     * Computed profile completeness 0–100.
     * Recomputed and stored on every profile write so reads are O(1).
     * See computeProviderCompleteness() in services/provider-profile.ts.
     */
    completenessScore: integer("completeness_score").notNull().default(0),

    /**
     * Verification status placeholder for Stage 4.
     * Stage 3 sets this to 'unverified'; Stage 4 implements the workflow.
     */
    verificationStatus: providerVerificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("provider_profiles_user_id_idx").on(t.userId),
    index("provider_profiles_kind_idx").on(t.kind),
    index("provider_profiles_verification_idx").on(t.verificationStatus),
    index("provider_profiles_availability_idx").on(t.availability),
    index("provider_profiles_primary_category_idx").on(t.primaryCategoryId),
    index("provider_profiles_is_public_idx").on(t.isPublic),
    index("provider_profiles_completeness_idx").on(t.completenessScore),
  ],
);

/** Many-to-many: provider profile ↔ skills. */
export const providerSkills = pgTable(
  "provider_skills",
  {
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.providerProfileId, t.skillId] })],
);

/** Work history entries for a provider. */
export const providerExperience = pgTable(
  "provider_experience",
  {
    id: text("id").primaryKey(),
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    /** Job title or role held. */
    role: text("role").notNull(),
    organization: text("organization").notNull(),
    /** ISO-8601 date (YYYY-MM-DD). */
    startDate: date("start_date").notNull(),
    /** Null if current position. */
    endDate: date("end_date"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_experience_profile_idx").on(t.providerProfileId)],
);

/**
 * Credentials and certifications held by a provider.
 * evidence_url is a URL reference — no binary files stored in PostgreSQL.
 */
export const providerCertifications = pgTable(
  "provider_certifications",
  {
    id: text("id").primaryKey(),
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    issuedAt: date("issued_at").notNull(),
    expiresAt: date("expires_at"),
    /** URL reference to evidence document (e.g. S3/Cloudinary URL — Stage 4+). */
    evidenceUrl: text("evidence_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_certifications_profile_idx").on(t.providerProfileId)],
);

/**
 * Portfolio items for a provider.
 * media_url is a URL reference — no binary files stored in PostgreSQL.
 * Stage 4+ will add a presigned-URL upload endpoint; Stage 3 accepts any URL.
 */
export const providerPortfolio = pgTable(
  "provider_portfolio",
  {
    id: text("id").primaryKey(),
    providerProfileId: text("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** URL of the media asset. Must be HTTPS. */
    mediaUrl: text("media_url").notNull(),
    mediaType: mediaTypeEnum("media_type").notNull().default("image"),
    /** Controls display order. Lower values appear first. */
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_portfolio_profile_idx").on(t.providerProfileId)],
);

// ─── Employer profiles ────────────────────────────────────────────────────────

/**
 * Employer marketplace profile.
 * Supports both individual hirers and organisations.
 * One employer profile per user (UNIQUE on user_id).
 */
export const employerProfiles = pgTable(
  "employer_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),

    employerType: employerTypeEnum("employer_type").notNull().default("individual"),

    /** Display name used in the marketplace. */
    displayName: text("display_name"),
    /** Organisation name — relevant when employer_type = 'organization'. */
    organizationName: text("organization_name"),

    industry: text("industry"),
    description: text("description"),
    location: text("location"),

    /** Public website or LinkedIn URL. */
    websiteUrl: text("website_url"),
    /** Logo or profile image URL reference. */
    logoUrl: text("logo_url"),

    isPublic: boolean("is_public").notNull().default(false),

    /** Computed completeness 0–100. Updated on every profile write. */
    completenessScore: integer("completeness_score").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employer_profiles_user_id_idx").on(t.userId),
    index("employer_profiles_employer_type_idx").on(t.employerType),
    index("employer_profiles_is_public_idx").on(t.isPublic),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type NewProviderProfile = typeof providerProfiles.$inferInsert;
export type ProviderExperience = typeof providerExperience.$inferSelect;
export type NewProviderExperience = typeof providerExperience.$inferInsert;
export type ProviderCertification = typeof providerCertifications.$inferSelect;
export type NewProviderCertification = typeof providerCertifications.$inferInsert;
export type ProviderPortfolioItem = typeof providerPortfolio.$inferSelect;
export type NewProviderPortfolioItem = typeof providerPortfolio.$inferInsert;
export type EmployerProfile = typeof employerProfiles.$inferSelect;
export type NewEmployerProfile = typeof employerProfiles.$inferInsert;

export type ProviderVerificationStatus = (typeof providerVerificationStatusEnum.enumValues)[number];
export type AvailabilityStatus = (typeof availabilityStatusEnum.enumValues)[number];
export type EmployerType = (typeof employerTypeEnum.enumValues)[number];
export type MediaType = (typeof mediaTypeEnum.enumValues)[number];
export type CategoryKind = (typeof categoryKindEnum.enumValues)[number];
