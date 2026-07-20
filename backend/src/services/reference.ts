/**
 * Reference data service — categories and skills.
 *
 * These are read-only lookups over seeded data. No auth required.
 * Responses are safe to CDN-cache (see routes/reference.ts).
 */

import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, skills } from "../db/schema/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  kind: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
}

export interface SkillDto {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  kind: string;
  description: string | null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Return all categories ordered by display_order. */
export async function getCategories(db: Db): Promise<CategoryDto[]> {
  const rows = await db.select().from(categories).orderBy(categories.displayOrder, categories.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    description: r.description,
    icon: r.icon,
    displayOrder: r.displayOrder,
  }));
}

/**
 * Return all skills, optionally filtered by category.
 * Each skill includes its parent category name for convenience.
 */
export async function getSkills(db: Db, categoryId?: string): Promise<SkillDto[]> {
  const query = db
    .select({
      id: skills.id,
      name: skills.name,
      slug: skills.slug,
      categoryId: skills.categoryId,
      categoryName: categories.name,
      kind: skills.kind,
      description: skills.description,
    })
    .from(skills)
    .innerJoin(categories, eq(categories.id, skills.categoryId))
    .orderBy(categories.displayOrder, skills.name);

  const rows = categoryId ? await query.where(eq(skills.categoryId, categoryId)) : await query;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    kind: r.kind,
    description: r.description,
  }));
}
