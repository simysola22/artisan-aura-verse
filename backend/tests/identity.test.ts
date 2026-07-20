/**
 * Identity service tests.
 *
 * Tests the business logic of provisionUser and resolveIdentity using mocked
 * DB calls via vi.spyOn. No real database is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { provisionUser, resolveIdentity, isPublicAccountType, PUBLIC_ACCOUNT_TYPES } from "../src/services/identity.js";
import type { Db } from "../src/db/client.js";
import { ForbiddenError, BadRequestError } from "../src/errors/index.js";

// ─── Pure logic tests (no DB) ─────────────────────────────────────────────────

describe("isPublicAccountType()", () => {
  it("returns true for employer", () => {
    expect(isPublicAccountType("employer")).toBe(true);
  });

  it("returns true for provider", () => {
    expect(isPublicAccountType("provider")).toBe(true);
  });

  it("returns false for owner", () => {
    expect(isPublicAccountType("owner")).toBe(false);
  });

  it("returns false for system_admin", () => {
    expect(isPublicAccountType("system_admin")).toBe(false);
  });

  it("returns false for verification_team", () => {
    expect(isPublicAccountType("verification_team")).toBe(false);
  });

  it("returns false for support_team", () => {
    expect(isPublicAccountType("support_team")).toBe(false);
  });

  it("returns false for moderation_team", () => {
    expect(isPublicAccountType("moderation_team")).toBe(false);
  });

  it("PUBLIC_ACCOUNT_TYPES contains only employer and provider", () => {
    expect(PUBLIC_ACCOUNT_TYPES).toEqual(["employer", "provider"]);
  });
});

// ─── provisionUser security tests ─────────────────────────────────────────────

describe("provisionUser() — security invariants", () => {
  // We need to mock the DB. Since provisionUser takes `db: Db`,
  // we can mock the transaction and subsequent queries.
  
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockTransaction = vi.fn();

  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
    transaction: mockTransaction,
  } as unknown as Db;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: transaction calls the callback with a tx that has insert
    mockTransaction.mockImplementation(async (cb: (tx: Db) => Promise<void>) => {
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };
      await cb(mockTx as unknown as Db);
    });
    // Default select chain: returns empty arrays (will be overridden per test)
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
  });

  it("throws ForbiddenError when attempting to provision 'owner' account", async () => {
    await expect(
      provisionUser(mockDb, {
        clerkUserId: "user_abc",
        accountType: "owner" as "employer", // cast to bypass TS (test runtime enforcement)
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when attempting to provision 'system_admin' account", async () => {
    await expect(
      provisionUser(mockDb, {
        clerkUserId: "user_abc",
        accountType: "system_admin" as "employer",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when attempting to provision 'verification_team' account", async () => {
    await expect(
      provisionUser(mockDb, {
        clerkUserId: "user_abc",
        accountType: "verification_team" as "employer",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws BadRequestError when providerKind is provided for employer", async () => {
    await expect(
      provisionUser(mockDb, {
        clerkUserId: "user_abc",
        accountType: "employer",
        providerKind: "artisan",
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("accepts 'employer' account type without providerKind", async () => {
    // Mock the post-insert selects to return valid data
    let callCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // loadPermissionsForRoles query
          return [{ name: "profile.read" }, { name: "profile.update" }];
        }
        if (callCount === 2) {
          // role query
          return [{ name: "employer" }];
        }
        // user query
        return [{
          id: "pmp_new",
          clerkUserId: "user_abc",
          accountType: "employer",
          providerKind: null,
          status: "active",
          displayName: null,
          email: null,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }];
      }),
    }));

    const identity = await provisionUser(mockDb, {
      clerkUserId: "user_abc",
      accountType: "employer",
    });
    expect(identity.user.accountType).toBe("employer");
    expect(identity.roleNames).toContain("employer");
  });

  it("accepts 'provider' account type with valid providerKind", async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ name: "profile.read" }];
        if (callCount === 2) return [{ name: "provider" }];
        return [{
          id: "pmp_provider",
          clerkUserId: "user_prov",
          accountType: "provider",
          providerKind: "artisan",
          status: "active",
          displayName: null,
          email: null,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }];
      }),
    }));

    const identity = await provisionUser(mockDb, {
      clerkUserId: "user_prov",
      accountType: "provider",
      providerKind: "artisan",
    });
    expect(identity.user.accountType).toBe("provider");
  });
});

// ─── resolveIdentity tests ────────────────────────────────────────────────────

describe("resolveIdentity()", () => {
  it("returns null when no PMP user exists for the Clerk ID", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // empty = user not found
      }),
    } as unknown as Db;

    const result = await resolveIdentity(mockDb, "user_unknown");
    expect(result).toBeNull();
  });

  it("returns null for a deleted user", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{
          id: "pmp_del",
          clerkUserId: "user_del",
          accountType: "employer",
          providerKind: null,
          status: "deleted",
          displayName: null,
          email: null,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    } as unknown as Db;

    const result = await resolveIdentity(mockDb, "user_del");
    expect(result).toBeNull();
  });

  it("throws ForbiddenError for a suspended user", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{
          id: "pmp_sus",
          clerkUserId: "user_sus",
          accountType: "employer",
          providerKind: null,
          status: "suspended",
          displayName: null,
          email: null,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    } as unknown as Db;

    await expect(resolveIdentity(mockDb, "user_sus")).rejects.toThrow(ForbiddenError);
  });
});
