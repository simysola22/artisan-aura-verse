/**
 * Reference data routes — /v1/reference/*
 *
 * Public endpoints (no auth required).
 * Safe to CDN-cache with a long TTL — reference data changes only on migrations.
 *
 * GET /v1/reference/categories          List all categories
 * GET /v1/reference/skills              List all skills (optional ?categoryId=)
 */

import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { getCategories, getSkills } from "../services/reference.js";

export function createReferenceRouter(db: Db): Hono {
  const router = new Hono();

  /**
   * GET /v1/reference/categories
   *
   * Returns all seeded categories ordered by display_order.
   * Auth: Public
   */
  router.get("/v1/reference/categories", async (c) => {
    const data = await getCategories(db);
    return c.json({ categories: data });
  });

  /**
   * GET /v1/reference/skills
   *
   * Returns skills, optionally filtered by ?categoryId=.
   * Auth: Public
   */
  router.get("/v1/reference/skills", async (c) => {
    const categoryId = c.req.query("categoryId") ?? undefined;
    const data = await getSkills(db, categoryId);
    return c.json({ skills: data });
  });

  return router;
}
