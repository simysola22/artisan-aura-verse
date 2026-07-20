-- PMP Stage 3 — Core Domain & Profile Foundation
--
-- Adds:
--   • category_kind enum
--   • availability_status enum
--   • employer_type enum
--   • media_type enum
--   • provider_verification_status enum
--   • categories (reference data, seeded)
--   • skills (reference data, seeded)
--   • provider_profiles
--   • provider_skills (m2m)
--   • provider_experience
--   • provider_certifications
--   • provider_portfolio
--   • employer_profiles
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 2 database.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "category_kind" AS ENUM ('artisan', 'professional', 'both');

CREATE TYPE "provider_verification_status" AS ENUM (
  'unverified', 'in_review', 'additional_info_requested', 'verified', 'rejected'
);

CREATE TYPE "availability_status" AS ENUM ('available', 'limited', 'unavailable');

CREATE TYPE "employer_type" AS ENUM ('individual', 'organization');

CREATE TYPE "media_type" AS ENUM ('image', 'video', 'document');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reference data tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "categories" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL UNIQUE,
  "slug"          TEXT NOT NULL UNIQUE,
  "kind"          "category_kind" NOT NULL DEFAULT 'both',
  "description"   TEXT,
  "icon"          TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "skills" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL UNIQUE,
  "category_id" TEXT NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "kind"        "category_kind" NOT NULL DEFAULT 'both',
  "description" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "skills_category_idx" ON "skills"("category_id");
CREATE INDEX "skills_kind_idx"     ON "skills"("kind");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Provider profile tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "provider_profiles" (
  "id"                  TEXT PRIMARY KEY,
  "user_id"             TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"                TEXT NOT NULL CHECK ("kind" IN ('artisan', 'professional')),
  "headline"            TEXT,
  "about"               TEXT,
  "primary_category_id" TEXT REFERENCES "categories"("id") ON DELETE SET NULL,
  "location"            TEXT,
  "service_area"        TEXT,
  "availability"        "availability_status" NOT NULL DEFAULT 'available',
  "years_of_experience" INTEGER,
  "hourly_rate"         INTEGER,
  "currency"            TEXT DEFAULT 'NGN',
  "is_public"           BOOLEAN NOT NULL DEFAULT FALSE,
  "completeness_score"  INTEGER NOT NULL DEFAULT 0,
  "verification_status" "provider_verification_status" NOT NULL DEFAULT 'unverified',
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "provider_profiles_user_id_idx"       ON "provider_profiles"("user_id");
CREATE INDEX "provider_profiles_kind_idx"          ON "provider_profiles"("kind");
CREATE INDEX "provider_profiles_verification_idx"  ON "provider_profiles"("verification_status");
CREATE INDEX "provider_profiles_availability_idx"  ON "provider_profiles"("availability");
CREATE INDEX "provider_profiles_primary_cat_idx"   ON "provider_profiles"("primary_category_id");
CREATE INDEX "provider_profiles_is_public_idx"     ON "provider_profiles"("is_public");
CREATE INDEX "provider_profiles_completeness_idx"  ON "provider_profiles"("completeness_score");

CREATE TABLE "provider_skills" (
  "provider_profile_id" TEXT NOT NULL REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "skill_id"            TEXT NOT NULL REFERENCES "skills"("id")            ON DELETE CASCADE,
  PRIMARY KEY ("provider_profile_id", "skill_id")
);

CREATE TABLE "provider_experience" (
  "id"                  TEXT PRIMARY KEY,
  "provider_profile_id" TEXT NOT NULL REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "role"                TEXT NOT NULL,
  "organization"        TEXT NOT NULL,
  "start_date"          DATE NOT NULL,
  "end_date"            DATE,
  "description"         TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "provider_experience_profile_idx" ON "provider_experience"("provider_profile_id");

CREATE TABLE "provider_certifications" (
  "id"                  TEXT PRIMARY KEY,
  "provider_profile_id" TEXT NOT NULL REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "name"                TEXT NOT NULL,
  "issuer"              TEXT NOT NULL,
  "issued_at"           DATE NOT NULL,
  "expires_at"          DATE,
  "evidence_url"        TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "provider_certifications_profile_idx" ON "provider_certifications"("provider_profile_id");

CREATE TABLE "provider_portfolio" (
  "id"                  TEXT PRIMARY KEY,
  "provider_profile_id" TEXT NOT NULL REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "title"               TEXT NOT NULL,
  "description"         TEXT,
  "media_url"           TEXT NOT NULL,
  "media_type"          "media_type" NOT NULL DEFAULT 'image',
  "display_order"       INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "provider_portfolio_profile_idx" ON "provider_portfolio"("provider_profile_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Employer profile table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employer_profiles" (
  "id"                TEXT PRIMARY KEY,
  "user_id"           TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "employer_type"     "employer_type" NOT NULL DEFAULT 'individual',
  "display_name"      TEXT,
  "organization_name" TEXT,
  "industry"          TEXT,
  "description"       TEXT,
  "location"          TEXT,
  "website_url"       TEXT,
  "logo_url"          TEXT,
  "is_public"         BOOLEAN NOT NULL DEFAULT FALSE,
  "completeness_score" INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "employer_profiles_user_id_idx"      ON "employer_profiles"("user_id");
CREATE INDEX "employer_profiles_employer_type_idx" ON "employer_profiles"("employer_type");
CREATE INDEX "employer_profiles_is_public_idx"    ON "employer_profiles"("is_public");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed categories
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "categories" ("id", "name", "slug", "kind", "description", "display_order") VALUES
  ('cat_skilled_trades',    'Skilled Trades',         'skilled-trades',    'artisan',       'Plumbing, electrical, carpentry, welding and other trade skills', 10),
  ('cat_beauty_care',       'Beauty & Personal Care', 'beauty-care',       'artisan',       'Hair styling, makeup, skincare and personal grooming', 20),
  ('cat_home_garden',       'Home & Garden',          'home-garden',       'artisan',       'Cleaning, landscaping, interior decoration and home services', 30),
  ('cat_automotive',        'Automotive',             'automotive',        'artisan',       'Vehicle repair, maintenance, and auto-electrical services', 40),
  ('cat_technology',        'Technology',             'technology',        'professional',  'Software development, IT support, data analysis and engineering', 50),
  ('cat_creative',          'Creative Services',      'creative',          'both',          'Photography, videography, design, writing and creative production', 60),
  ('cat_business_finance',  'Business & Finance',     'business-finance',  'professional',  'Accounting, consulting, marketing and business management', 70),
  ('cat_legal',             'Legal & Compliance',     'legal',             'professional',  'Legal advisory, contract drafting, compliance and tax services', 80),
  ('cat_health_wellness',   'Health & Wellness',      'health-wellness',   'both',          'Personal training, physiotherapy, nutrition and wellness coaching', 90),
  ('cat_education',         'Education & Training',   'education',         'both',          'Tutoring, corporate training, language teaching and coaching', 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seed skills
-- ─────────────────────────────────────────────────────────────────────────────

-- Skilled Trades
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_plumbing',         'Plumbing',             'plumbing',            'cat_skilled_trades', 'artisan'),
  ('skill_electrical',       'Electrical Work',      'electrical-work',     'cat_skilled_trades', 'artisan'),
  ('skill_carpentry',        'Carpentry',            'carpentry',           'cat_skilled_trades', 'artisan'),
  ('skill_welding',          'Welding',              'welding',             'cat_skilled_trades', 'artisan'),
  ('skill_masonry',          'Masonry',              'masonry',             'cat_skilled_trades', 'artisan'),
  ('skill_painting_decor',   'Painting & Decoration','painting-decoration', 'cat_skilled_trades', 'artisan'),
  ('skill_roofing',          'Roofing',              'roofing',             'cat_skilled_trades', 'artisan'),
  ('skill_tiling',           'Tiling',               'tiling',              'cat_skilled_trades', 'artisan');

-- Beauty & Personal Care
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_hair_styling',     'Hair Styling',         'hair-styling',        'cat_beauty_care', 'artisan'),
  ('skill_makeup',           'Makeup Artistry',      'makeup-artistry',     'cat_beauty_care', 'artisan'),
  ('skill_nail_care',        'Nail Care',            'nail-care',           'cat_beauty_care', 'artisan'),
  ('skill_barbering',        'Barbering',            'barbering',           'cat_beauty_care', 'artisan'),
  ('skill_skincare',         'Skincare',             'skincare',            'cat_beauty_care', 'artisan');

-- Home & Garden
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_cleaning',         'Cleaning Services',    'cleaning',            'cat_home_garden', 'artisan'),
  ('skill_landscaping',      'Landscaping',          'landscaping',         'cat_home_garden', 'artisan'),
  ('skill_interior_design',  'Interior Design',      'interior-design',     'cat_home_garden', 'both'),
  ('skill_pest_control',     'Pest Control',         'pest-control',        'cat_home_garden', 'artisan'),
  ('skill_fumigation',       'Fumigation',           'fumigation',          'cat_home_garden', 'artisan');

-- Automotive
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_auto_mechanic',    'Auto Mechanic',        'auto-mechanic',       'cat_automotive', 'artisan'),
  ('skill_auto_electrical',  'Auto Electrician',     'auto-electrician',    'cat_automotive', 'artisan'),
  ('skill_car_detailing',    'Car Wash & Detailing', 'car-detailing',       'cat_automotive', 'artisan'),
  ('skill_panel_beating',    'Panel Beating',        'panel-beating',       'cat_automotive', 'artisan');

-- Technology
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_software_dev',     'Software Development', 'software-development','cat_technology', 'professional'),
  ('skill_ui_ux',            'UI/UX Design',         'ui-ux-design',        'cat_technology', 'professional'),
  ('skill_cybersecurity',    'Cybersecurity',        'cybersecurity',       'cat_technology', 'professional'),
  ('skill_data_analysis',    'Data Analysis',        'data-analysis',       'cat_technology', 'professional'),
  ('skill_cloud_engineering','Cloud Engineering',    'cloud-engineering',   'cat_technology', 'professional'),
  ('skill_it_support',       'IT Support',           'it-support',          'cat_technology', 'both'),
  ('skill_devops',           'DevOps',               'devops',              'cat_technology', 'professional'),
  ('skill_mobile_dev',       'Mobile Development',   'mobile-development',  'cat_technology', 'professional');

-- Creative Services
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_photography',      'Photography',          'photography',         'cat_creative', 'both'),
  ('skill_videography',      'Videography',          'videography',         'cat_creative', 'both'),
  ('skill_graphic_design',   'Graphic Design',       'graphic-design',      'cat_creative', 'professional'),
  ('skill_fashion_design',   'Fashion Design',       'fashion-design',      'cat_creative', 'artisan'),
  ('skill_content_writing',  'Content Writing',      'content-writing',     'cat_creative', 'professional'),
  ('skill_animation',        'Animation',            'animation',           'cat_creative', 'professional');

-- Business & Finance
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_accounting',       'Accounting',           'accounting',          'cat_business_finance', 'professional'),
  ('skill_financial_plan',   'Financial Planning',   'financial-planning',  'cat_business_finance', 'professional'),
  ('skill_consulting',       'Business Consulting',  'business-consulting', 'cat_business_finance', 'professional'),
  ('skill_marketing',        'Marketing',            'marketing',           'cat_business_finance', 'professional'),
  ('skill_project_mgmt',     'Project Management',   'project-management',  'cat_business_finance', 'professional'),
  ('skill_hr',               'Human Resources',      'human-resources',     'cat_business_finance', 'professional');

-- Legal & Compliance
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_legal_advisory',   'Legal Advisory',       'legal-advisory',      'cat_legal', 'professional'),
  ('skill_contract_draft',   'Contract Drafting',    'contract-drafting',   'cat_legal', 'professional'),
  ('skill_tax_consulting',   'Tax Consulting',       'tax-consulting',      'cat_legal', 'professional'),
  ('skill_compliance',       'Compliance',           'compliance',          'cat_legal', 'professional');

-- Health & Wellness
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_personal_training','Personal Training',    'personal-training',   'cat_health_wellness', 'both'),
  ('skill_physiotherapy',    'Physiotherapy',        'physiotherapy',       'cat_health_wellness', 'professional'),
  ('skill_nutrition',        'Nutrition & Dietetics','nutrition-dietetics', 'cat_health_wellness', 'professional'),
  ('skill_mental_health',    'Mental Health Counseling','mental-health',    'cat_health_wellness', 'professional');

-- Education & Training
INSERT INTO "skills" ("id", "name", "slug", "category_id", "kind") VALUES
  ('skill_tutoring',         'Tutoring',             'tutoring',            'cat_education', 'both'),
  ('skill_corp_training',    'Corporate Training',   'corporate-training',  'cat_education', 'professional'),
  ('skill_lang_teaching',    'Language Teaching',    'language-teaching',   'cat_education', 'both'),
  ('skill_coaching',         'Coaching & Mentoring', 'coaching-mentoring',  'cat_education', 'both');
