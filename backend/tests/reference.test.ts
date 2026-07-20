/**
 * Reference data route tests.
 *
 * GET /v1/reference/categories — public (no auth)
 * GET /v1/reference/skills      — public (no auth), optional ?categoryId filter
 */
import { describe, it, expect, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { Db } from "../src/db/client.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const categoryRows = [
  {
    id: "cat_technology",
    name: "Technology",
    slug: "technology",
    kind: "professional",
    description: null,
    icon: null,
    displayOrder: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "cat_skilled_trades",
    name: "Skilled Trades",
    slug: "skilled-trades",
    kind: "artisan",
    description: null,
    icon: null,
    displayOrder: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const skillRows = [
  {
    id: "skill_software_dev",
    name: "Software Development",
    slug: "software-development",
    categoryId: "cat_technology",
    categoryName: "Technology",
    kind: "professional",
    description: null,
  },
  {
    id: "skill_plumbing",
    name: "Plumbing",
    slug: "plumbing",
    categoryId: "cat_skilled_trades",
    categoryName: "Skilled Trades",
    kind: "artisan",
    description: null,
  },
];

// ─── Mock DB factory ──────────────────────────────────────────────────────────

/**
 * Build a mock Db whose select() chain resolves to appropriate fixture data
 * based on which table is queried (detected by the first .from() call).
 *
 * Drizzle query pattern used by reference service:
 *   categories: db.select().from(categories).orderBy(...)        → resolved immediately
 *   skills:     db.select({...}).from(skills).innerJoin(...).orderBy(...)[.where(...)] → resolved
 *
 * We build a single chainable object that is thenable AND has all the
 * builder methods. Presence of "categoryName" in the resolved shape indicates
 * a skills query; absence indicates a categories query.
 */
function makeMockDb(catData = categoryRows, skillData = skillRows): Db {
  let queryForSkills = false;

  function makeChain(data: unknown[]): Record<string, unknown> {
    const p = () => Promise.resolve(data);
    const chain: Record<string, unknown> = {
      from: (table: { _: { name?: string } }) => {
        // detect which table is being queried
        if (table && table._ && table._.name === "skills") {
          queryForSkills = true;
        }
        return chain;
      },
      innerJoin: () => chain,
      where: () => {
        // where called after orderBy — still returns a promise-like chain
        const filtered = queryForSkills
          ? skillData // filtering already baked-in for simplicity
          : catData;
        const fp = Promise.resolve(filtered);
        return {
          then: fp.then.bind(fp),
          catch: fp.catch.bind(fp),
          finally: fp.finally.bind(fp),
        };
      },
      orderBy: () => {
        const d = queryForSkills ? skillData : catData;
        const op = Promise.resolve(d);
        // orderBy must be both awaitable and have .where()
        return {
          where: () => {
            const wData = queryForSkills ? skillData : catData;
            const wp = Promise.resolve(wData);
            return {
              then: wp.then.bind(wp),
              catch: wp.catch.bind(wp),
              finally: wp.finally.bind(wp),
            };
          },
          then: op.then.bind(op),
          catch: op.catch.bind(op),
          finally: op.finally.bind(op),
        };
      },
    };
    return chain;
  }

  return {
    select: vi.fn().mockImplementation(() => {
      queryForSkills = false;
      return makeChain(catData); // default; will be overridden by .from() detection
    }),
  } as unknown as Db;
}

function makeApp(db: Db = makeMockDb()) {
  const noopIdService: AuthIdentityService = {
    resolve: async () => null,
    provision: async () => {
      throw new Error("unexpected");
    },
    updateProfile: async () => {},
  };

  return createApp({
    clerkAdapter: createMockClerkAdapter(new Map()),
    identityService: noopIdService,
    db,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /v1/reference/categories", () => {
  it("returns 200 with category list (no auth required)", async () => {
    // Fresh DB per test
    const db = makeMockDb();
    // Make select return categories when called
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const p = Promise.resolve(categoryRows);
      return {
        from: () => ({
          orderBy: () => ({
            then: p.then.bind(p),
            catch: p.catch.bind(p),
            finally: p.finally.bind(p),
          }),
        }),
      };
    });

    const app = makeApp(db);
    const res = await app.request("/v1/reference/categories");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: unknown[] };
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories).toHaveLength(2);
  });
});

describe("GET /v1/reference/skills", () => {
  it("returns 200 with skill list (no auth required)", async () => {
    const db = makeMockDb();
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const p = Promise.resolve(skillRows);
      return {
        from: () => ({
          innerJoin: () => ({
            orderBy: () => ({
              then: p.then.bind(p),
              catch: p.catch.bind(p),
              finally: p.finally.bind(p),
            }),
          }),
        }),
      };
    });

    const app = makeApp(db);
    const res = await app.request("/v1/reference/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it("passes categoryId query param to service (filtered call succeeds)", async () => {
    const filtered = skillRows.filter((s) => s.categoryId === "cat_technology");
    const db = makeMockDb();
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const base = Promise.resolve(filtered);
      return {
        from: () => ({
          innerJoin: () => ({
            orderBy: () => ({
              where: () => {
                return {
                  then: base.then.bind(base),
                  catch: base.catch.bind(base),
                  finally: base.finally.bind(base),
                };
              },
              then: base.then.bind(base),
              catch: base.catch.bind(base),
              finally: base.finally.bind(base),
            }),
          }),
        }),
      };
    });

    const app = makeApp(db);
    const res = await app.request("/v1/reference/skills?categoryId=cat_technology");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(body.skills).toHaveLength(1);
  });
});
