/**
 * Identity service — PMP user resolution and provisioning.
 *
 * This is the single place where Clerk identity (clerkUserId) maps to a PMP
 * application user. No route handler touches the DB directly for identity
 * concerns; they call these functions instead.
 *
 * Key invariants enforced here:
 *   1. Only PUBLIC_ACCOUNT_TYPES can be requested via self-registration.
 *   2. Internal account types are never assignable through this service's
 *      public provisionUser() function.
 *   3. Permissions are always loaded from the DB — never trusted from the client.
 */

import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  PUBLIC_ACCOUNT_TYPES,
  isPublicAccountType,
  type AccountType,
  type ProviderKind,
  type User,
} from "../db/schema/index.js";
import { BadRequestError, ForbiddenError } from "../errors/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The full resolved identity attached to an authenticated request. */
export interface ResolvedIdentity {
  user: User;
  /** Role names held by this user, e.g. ["employer"]. */
  roleNames: string[];
  /** Full set of permission strings this user holds. Fast for has() checks. */
  permissions: Set<string>;
}

/** Parameters for creating a new PMP user via the public registration flow. */
export interface ProvisionUserParams {
  clerkUserId: string;
  accountType: "employer" | "provider";
  providerKind?: "artisan" | "professional";
  /** Cached from Clerk for display. Optional — updated on subsequent /me calls. */
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

// ─── Role → DB ID lookup ─────────────────────────────────────────────────────

/** Maps account_type value → seeded role ID (from 0001 migration seed). */
const ACCOUNT_TYPE_TO_ROLE_ID: Record<AccountType, string> = {
  employer: "role_employer",
  provider: "role_provider",
  owner: "role_owner",
  system_admin: "role_system_admin",
  verification_team: "role_verification_team",
  support_team: "role_support_team",
  moderation_team: "role_moderation_team",
};

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Load all permission strings held by a set of role IDs.
 * Used internally and exposed for testing.
 */
export async function loadPermissionsForRoles(
  db: Db,
  roleIds: string[],
): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set();

  const rows = await db
    .select({ name: permissions.name })
    .from(permissions)
    .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, roleIds));

  return new Set(rows.map((r) => r.name));
}

/**
 * Resolve an authenticated Clerk user ID to a full PMP identity.
 *
 * Returns null if the Clerk user has no PMP record — the caller should
 * direct the user to complete registration via POST /v1/auth/sync.
 *
 * Returns null (not an error) if the user's account is deleted.
 * Throws ForbiddenError if the account is suspended.
 */
export async function resolveIdentity(
  db: Db,
  clerkUserId: string,
): Promise<ResolvedIdentity | null> {
  // Load user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!user) return null;
  if (user.status === "deleted") return null;
  if (user.status === "suspended") {
    throw new ForbiddenError("Account is suspended. Contact support.");
  }

  // Load roles assigned to this user
  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));

  const roleIds = userRoleRows.map((r) => r.roleId);
  const roleNames = userRoleRows.map((r) => r.roleName);

  const perms = await loadPermissionsForRoles(db, roleIds);

  return { user, roleNames, permissions: perms };
}

/**
 * Create a new PMP user for a Clerk identity that has never been seen before.
 *
 * Security invariant: only PUBLIC_ACCOUNT_TYPES (employer, provider) can be
 * requested through this function. Internal types throw ForbiddenError
 * regardless of any client-supplied value.
 *
 * The corresponding seeded role is assigned automatically based on accountType.
 */
export async function provisionUser(
  db: Db,
  params: ProvisionUserParams,
): Promise<ResolvedIdentity> {
  const { clerkUserId, accountType, providerKind, displayName, email, avatarUrl } =
    params;

  // ── Security check: block internal account type self-assignment ────────────
  if (!isPublicAccountType(accountType)) {
    throw new ForbiddenError(
      "Cannot self-assign an internal account type. Contact a system administrator.",
    );
  }

  // ── Validate providerKind only when account_type = provider ───────────────
  if (accountType === "provider" && providerKind !== undefined) {
    if (providerKind !== "artisan" && providerKind !== "professional") {
      throw new BadRequestError("providerKind must be 'artisan' or 'professional'");
    }
  }
  if (accountType === "employer" && providerKind !== undefined) {
    throw new BadRequestError("providerKind is only valid for provider accounts");
  }

  const id = crypto.randomUUID();
  const roleId = ACCOUNT_TYPE_TO_ROLE_ID[accountType];

  // ── Insert user + assign role in a transaction ────────────────────────────
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      clerkUserId,
      accountType,
      providerKind: providerKind ?? null,
      status: "active",
      displayName: displayName ?? null,
      email: email ?? null,
      avatarUrl: avatarUrl ?? null,
    });

    await tx.insert(userRoles).values({
      userId: id,
      roleId,
    });
  });

  // ── Load and return the full resolved identity ────────────────────────────
  const perms = await loadPermissionsForRoles(db, [roleId]);
  const [roleRow] = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

  const [insertedUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!insertedUser || !roleRow) {
    throw new Error("Failed to load newly created user after insert");
  }

  return {
    user: insertedUser,
    roleNames: [roleRow.name],
    permissions: perms,
  };
}

/**
 * Update cached Clerk profile fields on an existing user record.
 * Called from GET /v1/auth/me to keep display data fresh without a separate sync call.
 */
export async function updateCachedProfile(
  db: Db,
  userId: string,
  profile: { displayName?: string; email?: string; avatarUrl?: string },
): Promise<void> {
  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (profile.displayName !== undefined) updates.displayName = profile.displayName;
  if (profile.email !== undefined) updates.email = profile.email;
  if (profile.avatarUrl !== undefined) updates.avatarUrl = profile.avatarUrl;

  await db.update(users).set(updates).where(eq(users.id, userId));
}

/** Serialize a ResolvedIdentity into the JSON shape returned by /v1/auth/me. */
export function serializeIdentity(identity: ResolvedIdentity) {
  const { user, roleNames, permissions: perms } = identity;
  return {
    user: {
      id: user.id,
      clerkUserId: user.clerkUserId,
      accountType: user.accountType,
      providerKind: user.providerKind,
      status: user.status,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    roles: roleNames,
    permissions: [...perms].sort(),
  };
}

// Re-export for convenience in tests and routes
export { PUBLIC_ACCOUNT_TYPES, isPublicAccountType };
export type { AccountType, ProviderKind };
