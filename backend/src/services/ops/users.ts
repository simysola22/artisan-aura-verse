/**
 * Ops user management service — Stage 9.
 *
 * Handles listing, viewing, suspending, reactivating, soft-deleting users,
 * and assigning / removing internal roles.
 *
 * Security invariants:
 *   1. Users cannot be targeted by actors of equal or lower privilege.
 *   2. Users cannot assign roles to themselves (self-escalation prevention).
 *   3. Only an 'owner' actor can assign the 'owner' or 'system_admin' roles.
 *   4. 'system_admin' actors can assign team-level roles only.
 *   5. The employer and provider roles are provisioned at registration and
 *      are not assignable via this API.
 *   6. Every role change and every status change is recorded in ops_audit_log.
 */

import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  users,
  roles,
  userRoles,
  permissions,
  rolePermissions,
  type AccountType,
  type UserStatus,
} from "../../db/schema/index.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors/index.js";
import { appendOpsAudit } from "./audit.js";

// ─── Privilege hierarchy ──────────────────────────────────────────────────────

/**
 * Numeric privilege level per account type — higher = more privileged.
 * Used to prevent actors from managing peers or superiors.
 */
const PRIVILEGE: Record<AccountType, number> = {
  owner: 100,
  system_admin: 80,
  verification_team: 40,
  support_team: 40,
  moderation_team: 40,
  employer: 10,
  provider: 10,
};

/**
 * Internal roles assignable via the ops API, keyed by minimum actor account type.
 * Public roles (employer, provider) are assigned at registration and excluded here.
 */
const ASSIGNABLE_ROLES_BY_ACTOR: Record<string, string[]> = {
  owner: [
    "role_owner",
    "role_system_admin",
    "role_verification_team",
    "role_support_team",
    "role_moderation_team",
  ],
  system_admin: ["role_verification_team", "role_support_team", "role_moderation_team"],
};

function assertActorCanAssignRole(actorAccountType: AccountType, roleId: string): void {
  const allowed = ASSIGNABLE_ROLES_BY_ACTOR[actorAccountType] ?? [];
  if (!allowed.includes(roleId)) {
    throw new ForbiddenError(
      `Account type '${actorAccountType}' cannot assign role '${roleId}'. ` +
        "Only owners can assign owner and system_admin roles.",
    );
  }
}

function assertActorOutranksTarget(
  actorAccountType: AccountType,
  targetAccountType: AccountType,
): void {
  if (PRIVILEGE[actorAccountType] <= PRIVILEGE[targetAccountType]) {
    throw new ForbiddenError(
      "Cannot manage a user account with equal or higher privilege than your own.",
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadUser(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError("User");
  return user;
}

// ─── List / view ──────────────────────────────────────────────────────────────

export interface ListUsersParams {
  accountType?: AccountType;
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export async function listUsers(db: Db, params: ListUsersParams = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions = [];
  if (params.accountType !== undefined) {
    conditions.push(eq(users.accountType, params.accountType));
  }
  if (params.status !== undefined) {
    conditions.push(eq(users.status, params.status));
  }

  const { and: drizzleAnd, desc } = await import("drizzle-orm");

  const rows = await db
    .select({
      id: users.id,
      clerkUserId: users.clerkUserId,
      accountType: users.accountType,
      providerKind: users.providerKind,
      status: users.status,
      displayName: users.displayName,
      email: users.email,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(conditions.length > 0 ? drizzleAnd(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getUserWithRoles(db: Db, userId: string) {
  const user = await loadUser(db, userId);

  const roleRows = await db
    .select({ roleId: userRoles.roleId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  return {
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
    roles: roleRows.map((r) => ({ id: r.roleId, name: r.roleName })),
  };
}

// ─── Status management ────────────────────────────────────────────────────────

export async function suspendUser(
  db: Db,
  targetUserId: string,
  actorId: string,
  actorAccountType: AccountType,
  reason?: string,
): Promise<void> {
  if (actorId === targetUserId) {
    throw new BadRequestError("You cannot suspend your own account.");
  }

  const target = await loadUser(db, targetUserId);
  assertActorOutranksTarget(actorAccountType, target.accountType);

  if (target.status === "suspended") {
    throw new ConflictError("User account is already suspended.");
  }
  if (target.status === "deleted") {
    throw new BadRequestError("Cannot suspend a deleted account.");
  }

  await db
    .update(users)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(eq(users.id, targetUserId));

  await appendOpsAudit(db, {
    actorId,
    action: "user_suspended",
    targetUserId,
    entityType: "user",
    entityId: targetUserId,
    metadata: reason !== undefined ? { reason } : undefined,
  });
}

export async function reactivateUser(
  db: Db,
  targetUserId: string,
  actorId: string,
  actorAccountType: AccountType,
): Promise<void> {
  if (actorId === targetUserId) {
    throw new BadRequestError("You cannot reactivate your own account via this endpoint.");
  }

  const target = await loadUser(db, targetUserId);
  assertActorOutranksTarget(actorAccountType, target.accountType);

  if (target.status === "active") {
    throw new ConflictError("User account is already active.");
  }
  if (target.status === "deleted") {
    throw new BadRequestError("Cannot reactivate a deleted account.");
  }

  await db
    .update(users)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(users.id, targetUserId));

  await appendOpsAudit(db, {
    actorId,
    action: "user_reactivated",
    targetUserId,
    entityType: "user",
    entityId: targetUserId,
  });
}

export async function deleteUser(
  db: Db,
  targetUserId: string,
  actorId: string,
  actorAccountType: AccountType,
): Promise<void> {
  if (actorId === targetUserId) {
    throw new BadRequestError("You cannot delete your own account via this endpoint.");
  }

  const target = await loadUser(db, targetUserId);
  assertActorOutranksTarget(actorAccountType, target.accountType);

  if (target.status === "deleted") {
    throw new ConflictError("User account is already deleted.");
  }

  await db
    .update(users)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(users.id, targetUserId));

  await appendOpsAudit(db, {
    actorId,
    action: "user_deleted",
    targetUserId,
    entityType: "user",
    entityId: targetUserId,
  });
}

// ─── Role management ──────────────────────────────────────────────────────────

export async function assignRole(
  db: Db,
  targetUserId: string,
  roleId: string,
  actorId: string,
  actorAccountType: AccountType,
): Promise<void> {
  // Security: no self-assignment
  if (actorId === targetUserId) {
    throw new ForbiddenError("You cannot assign roles to your own account.");
  }

  // Security: actor must have privilege to assign this specific role
  assertActorCanAssignRole(actorAccountType, roleId);

  // Verify role exists
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw new NotFoundError("Role");

  // Verify target user exists
  const target = await loadUser(db, targetUserId);
  assertActorOutranksTarget(actorAccountType, target.accountType);

  // Check not already assigned
  const [existing] = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)))
    .limit(1);
  if (existing) {
    throw new ConflictError(`User already holds role '${role.name}'.`);
  }

  await db.insert(userRoles).values({ userId: targetUserId, roleId });

  await appendOpsAudit(db, {
    actorId,
    action: "role_assigned",
    targetUserId,
    entityType: "role",
    entityId: roleId,
    metadata: { roleName: role.name },
  });
}

export async function removeRole(
  db: Db,
  targetUserId: string,
  roleId: string,
  actorId: string,
  actorAccountType: AccountType,
): Promise<void> {
  if (actorId === targetUserId) {
    throw new ForbiddenError("You cannot remove roles from your own account.");
  }

  assertActorCanAssignRole(actorAccountType, roleId);

  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw new NotFoundError("Role");

  const target = await loadUser(db, targetUserId);
  assertActorOutranksTarget(actorAccountType, target.accountType);

  const deleted = await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)));

  // Drizzle returns rowCount; if nothing deleted the role wasn't assigned
  if (!deleted) {
    throw new NotFoundError("Role assignment");
  }

  await appendOpsAudit(db, {
    actorId,
    action: "role_removed",
    targetUserId,
    entityType: "role",
    entityId: roleId,
    metadata: { roleName: role.name },
  });
}

export async function listRoles(db: Db) {
  const allRoles = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
    })
    .from(roles);

  // Enrich with permissions
  const enriched = await Promise.all(
    allRoles.map(async (role) => {
      const perms = await db
        .select({ name: permissions.name })
        .from(permissions)
        .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, role.id));
      return { ...role, permissions: perms.map((p) => p.name) };
    }),
  );

  return enriched;
}
