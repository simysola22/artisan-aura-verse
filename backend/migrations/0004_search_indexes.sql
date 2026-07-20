-- PMP Stage 5 — Search & Ranking: Additional indexes
--
-- Audited existing indexes before adding new ones (Stage 3 migration already
-- covers the most important columns on provider_profiles):
--
-- Already indexed (no action needed):
--   provider_profiles: user_id, kind, verification_status, availability,
--                      primary_category_id, is_public, completeness_score
--   skills: category_id, kind
--   provider_experience: provider_profile_id
--   provider_certifications: provider_profile_id
--   provider_portfolio: provider_profile_id
--
-- New indexes below and why each one exists:
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. provider_skills.skill_id
--    The composite PK (provider_profile_id, skill_id) covers forward lookups
--    (given a profile, find its skills) but NOT reverse lookups (given a skill,
--    find all profiles that have it). The search filter `?skillId=` performs
--    exactly this reverse lookup via:
--      SELECT provider_profile_id FROM provider_skills WHERE skill_id = $1
--    Without this index that query is a full table scan on every search request.
CREATE INDEX "provider_skills_skill_id_idx"
  ON "provider_skills" ("skill_id");

-- 2. provider_profiles.location
--    The search endpoint supports `?location=` which generates:
--      WHERE provider_profiles.location ILIKE '%<value>%'
--    A B-tree index does not help ILIKE with leading wildcards, but a partial
--    index that restricts to non-null rows reduces the scanned set significantly
--    on databases where many providers have not set a location.
--    This is a baseline index; upgrade to pg_trgm GIN for production at scale.
CREATE INDEX "provider_profiles_location_idx"
  ON "provider_profiles" ("location")
  WHERE "location" IS NOT NULL;

-- 3. provider_profiles.years_of_experience
--    The search endpoint supports `?minExperience=N` which generates:
--      WHERE provider_profiles.years_of_experience >= N
--    A B-tree index enables efficient range scans for this filter.
CREATE INDEX "provider_profiles_years_experience_idx"
  ON "provider_profiles" ("years_of_experience")
  WHERE "years_of_experience" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Future optimisations (documented, not implemented):
--
-- Full-text / trigram search on headline + about:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX provider_profiles_headline_trgm_idx
--     ON provider_profiles USING GIN (headline gin_trgm_ops)
--     WHERE headline IS NOT NULL;
--   CREATE INDEX provider_profiles_about_trgm_idx
--     ON provider_profiles USING GIN (about gin_trgm_ops)
--     WHERE about IS NOT NULL;
--
-- These enable fast ILIKE '%term%' on text columns. Deferred because:
--   a) pg_trgm must be enabled per-database (requires superuser on Railway).
--   b) The initial dataset is small — B-tree on filtered sets is fast enough.
--   c) Stage 5 is designed for Meilisearch replacement at scale, making
--      trigram indexes a stepping stone rather than a long-term investment.
-- ─────────────────────────────────────────────────────────────────────────────
