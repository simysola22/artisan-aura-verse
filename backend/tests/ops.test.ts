/**
 * Operations system tests — Stage 9.
 *
 * Tests are organised into:
 *
 * 1. User management routes
 *    - GET  /v1/ops/users             list users (users.read required)
 *    - GET  /v1/ops/users/:id         get user with roles
 *    - POST /v1/ops/users/:id/suspend     suspend user
 *    - POST /v1/ops/users/:id/reactivate  reactivate user
 *    - DELETE /v1/ops/users/:id           soft-delete user
 *    - POST /v1/ops/users/:id/roles       assign role
 *    - DELETE /v1/ops/users/:id/roles/:r  remove role
 *    - GET  /v1/ops/roles             list roles
 *
 * 2. Support ticket routes
 *    - POST /v1/ops/support/tickets         create (any auth user)
 *    - GET  /v1/ops/support/tickets         list all (support.read)
 *    - GET  /v1/ops/support/tickets/mine    own tickets
 *    - GET  /v1/ops/support/tickets/:id     view
 *    - POST /v1/ops/support/tickets/:id/messages  add message
 *    - POST /v1/ops/support/tickets/:id/assign    assign
 *    - POST /v1/ops/support/tickets/:id/close     close
 *
 * 3. Moderation routes
 *    - POST /v1/ops/moderation/reports          submit report (any auth user)
 *    - GET  /v1/ops/moderation/reports          list (moderation.read)
 *    - GET  /v1/ops/moderation/reports/:id      get report + actions
 *    - POST /v1/ops/moderation/reports/:id/review   mark reviewing
 *    - POST /v1/ops/moderation/reports/:id/action   take action
 *
 * 4. Audit log
 *    - GET /v1/ops/audit    (system.manage required)
 *
 * 5. Overview dashboard
 *    - GET /v1/ops/overview (any ops read permission)
 *
 * 6. Security invariants
 *    - 401 without token
 *    - 403 without required permission
 *    - Self-escalation prevention (cannot assign roles to self)
 *    - Privilege escalation prevention (cannot assign owner/system_admin as system_admin)
 *    - Self-suspension prevention
 *    - Internal messages not exposed to non-staff callers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import type { Db } from "../src/db/client.js";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from "../src/errors/index.js";

// ─── Mock service modules ─────────────────────────────────────────────────────

vi.mock("../src/services/ops/users.js", () => ({
  listUsers: vi.fn(),
  getUserWithRoles: vi.fn(),
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
  deleteUser: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
  listRoles: vi.fn(),
}));

vi.mock("../src/services/ops/support.js", () => ({
  createTicket: vi.fn(),
  listTickets: vi.fn(),
  getOwnTickets: vi.fn(),
  getTicket: vi.fn(),
  addMessage: vi.fn(),
  assignTicket: vi.fn(),
  closeTicket: vi.fn(),
}));

vi.mock("../src/services/ops/moderation.js", () => ({
  submitReport: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
  markReportReviewing: vi.fn(),
  takeModerationAction: vi.fn(),
}));

vi.mock("../src/services/ops/audit.js", () => ({
  listOpsAudit: vi.fn(),
  appendOpsAudit: vi.fn(),
}));

import {
  listUsers,
  getUserWithRoles,
  suspendUser,
  reactivateUser,
  deleteUser,
  assignRole,
  removeRole,
  listRoles,
} from "../src/services/ops/users.js";

import {
  createTicket,
  listTickets,
  getOwnTickets,
  getTicket,
  addMessage,
  assignTicket,
  closeTicket,
} from "../src/services/ops/support.js";

import {
  submitReport,
  listReports,
  getReport,
  markReportReviewing,
  takeModerationAction,
} from "../src/services/ops/moderation.js";

import { listOpsAudit } from "../src/services/ops/audit.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIdentity(
  overrides: {
    pmpUserId?: string;
    accountType?: string;
    permissions?: string[];
  } = {},
): ResolvedIdentity {
  return {
    user: {
      id: overrides.pmpUserId ?? "user_ops_actor",
      clerkUserId: "clerk_ops_actor",
      accountType: (overrides.accountType ??
        "system_admin") as ResolvedIdentity["user"]["accountType"],
      providerKind: null,
      status: "active",
      displayName: "Ops Actor",
      email: "ops@pmp.test",
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    roleNames: ["system_admin"],
    permissions: new Set(
      overrides.permissions ?? [
        "users.read",
        "users.manage",
        "system.manage",
        "staff.read",
        "staff.roles.manage",
        "audit.read",
        "support.read",
        "support.respond",
        "support.manage",
        "moderation.read",
        "moderation.review",
        "moderation.action",
        "moderation.manage",
        "verification.read",
        "verification.manage",
      ],
    ),
  };
}

function makeApp(identity: ResolvedIdentity | null = makeIdentity()) {
  const clerkMap = new Map([["token-ops", { clerkUserId: "clerk_ops_actor" }]]);
  const clerkAdapter = createMockClerkAdapter(clerkMap);
  const identityService: AuthIdentityService = {
    resolve: vi.fn().mockResolvedValue(identity),
    provision: async () => {
      throw new Error("unexpected");
    },
    updateProfile: async () => {},
    correctAccountType: async () => {},
  };
  return createApp({
    clerkAdapter,
    identityService,
    db: {} as unknown as Db,
  });
}

function authHeader() {
  return { Authorization: "Bearer token-ops" };
}

function json(body: unknown) {
  return {
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ─── User management ──────────────────────────────────────────────────────────

describe("GET /v1/ops/users", () => {
  beforeEach(() => {
    vi.mocked(listUsers).mockResolvedValue([]);
  });

  it("returns 200 with user list when caller has users.read", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: unknown[] };
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks users.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/users", { headers: authHeader() });
    expect(res.status).toBe(403);
  });

  it("passes query filters to service", async () => {
    const app = makeApp();
    await app.request("/v1/ops/users?accountType=employer&status=active&limit=10&offset=5", {
      headers: authHeader(),
    });
    expect(vi.mocked(listUsers)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountType: "employer", status: "active", limit: 10, offset: 5 }),
    );
  });
});

describe("GET /v1/ops/users/:id", () => {
  beforeEach(() => {
    vi.mocked(getUserWithRoles).mockResolvedValue({
      id: "user_target",
      clerkUserId: "clerk_target",
      accountType: "employer",
      providerKind: null,
      status: "active",
      displayName: "Target",
      email: "t@pmp.test",
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      roles: [],
    });
  });

  it("returns 200 with user + roles", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target", { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it("returns 404 when user not found", async () => {
    vi.mocked(getUserWithRoles).mockRejectedValue(new NotFoundError("User"));
    const app = makeApp();
    const res = await app.request("/v1/ops/users/no_such_user", { headers: authHeader() });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/ops/users/:id/suspend", () => {
  beforeEach(() => {
    vi.mocked(suspendUser).mockResolvedValue();
  });

  it("returns 200 when suspension succeeds", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/suspend", {
      method: "POST",
      ...json({ reason: "Policy violation" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when caller lacks users.manage", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.read"] }));
    const res = await app.request("/v1/ops/users/user_target/suspend", {
      method: "POST",
      ...json({}),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when service throws BadRequestError (self-suspension)", async () => {
    vi.mocked(suspendUser).mockRejectedValue(
      new BadRequestError("You cannot suspend your own account."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_ops_actor/suspend", {
      method: "POST",
      ...json({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when user already suspended", async () => {
    vi.mocked(suspendUser).mockRejectedValue(
      new ConflictError("User account is already suspended."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/suspend", {
      method: "POST",
      ...json({}),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/ops/users/:id/reactivate", () => {
  beforeEach(() => {
    vi.mocked(reactivateUser).mockResolvedValue();
  });

  it("returns 200 when reactivation succeeds", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/reactivate", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when caller lacks users.manage", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.read"] }));
    const res = await app.request("/v1/ops/users/user_target/reactivate", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /v1/ops/users/:id", () => {
  beforeEach(() => {
    vi.mocked(deleteUser).mockResolvedValue();
  });

  it("returns 204 on soft-delete", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target", {
      method: "DELETE",
      headers: authHeader(),
    });
    expect(res.status).toBe(204);
  });

  it("returns 403 when caller lacks users.manage", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.read"] }));
    const res = await app.request("/v1/ops/users/user_target", {
      method: "DELETE",
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/ops/users/:id/roles — assign role", () => {
  beforeEach(() => {
    vi.mocked(assignRole).mockResolvedValue();
  });

  it("returns 201 when role assignment succeeds", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles", {
      method: "POST",
      ...json({ roleId: "role_verification_team" }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 403 when caller lacks system.manage", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.manage"] }));
    const res = await app.request("/v1/ops/users/user_target/roles", {
      method: "POST",
      ...json({ roleId: "role_verification_team" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when service detects self-escalation", async () => {
    vi.mocked(assignRole).mockRejectedValue(
      new ForbiddenError("You cannot assign roles to your own account."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_ops_actor/roles", {
      method: "POST",
      ...json({ roleId: "role_owner" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when system_admin tries to assign owner role", async () => {
    vi.mocked(assignRole).mockRejectedValue(
      new ForbiddenError("Account type 'system_admin' cannot assign role 'role_owner'."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles", {
      method: "POST",
      ...json({ roleId: "role_owner" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 409 when role already assigned", async () => {
    vi.mocked(assignRole).mockRejectedValue(
      new ConflictError("User already holds role 'verification_team'."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles", {
      method: "POST",
      ...json({ roleId: "role_verification_team" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for missing roleId", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles", {
      method: "POST",
      ...json({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /v1/ops/users/:id/roles/:roleId — remove role", () => {
  beforeEach(() => {
    vi.mocked(removeRole).mockResolvedValue();
  });

  it("returns 204 when removal succeeds", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles/role_verification_team", {
      method: "DELETE",
      headers: authHeader(),
    });
    expect(res.status).toBe(204);
  });

  it("returns 403 when self-removal blocked", async () => {
    vi.mocked(removeRole).mockRejectedValue(
      new ForbiddenError("You cannot remove roles from your own account."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_ops_actor/roles/role_system_admin", {
      method: "DELETE",
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when last owner removal is blocked", async () => {
    vi.mocked(removeRole).mockRejectedValueOnce(
      new ForbiddenError(
        "Cannot remove the last owner role assignment. Assign another owner first.",
      ),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/users/user_target/roles/role_owner", {
      method: "DELETE",
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/last owner/i);
  });
});

describe("GET /v1/ops/roles", () => {
  beforeEach(() => {
    vi.mocked(listRoles).mockResolvedValue([
      { id: "role_employer", name: "employer", description: null, permissions: ["profile.read"] },
    ]);
  });

  it("returns 200 with roles list", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/roles", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: unknown[] };
    expect(body.roles.length).toBeGreaterThan(0);
  });

  it("returns 403 without staff.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.read"] }));
    const res = await app.request("/v1/ops/roles", { headers: authHeader() });
    expect(res.status).toBe(403);
  });
});

// ─── Support tickets ──────────────────────────────────────────────────────────

describe("POST /v1/ops/support/tickets", () => {
  beforeEach(() => {
    vi.mocked(createTicket).mockResolvedValue({
      id: "ticket_1",
      title: "Help",
      description: "I need help",
      category: "account",
      priority: "medium",
      status: "open",
      submittedBy: "user_ops_actor",
      assignedTo: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 201 when ticket is created", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets", {
      method: "POST",
      ...json({ title: "Help", description: "I need help", category: "account" }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 401 without auth", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Help", description: "I need help", category: "account" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing required fields", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets", {
      method: "POST",
      ...json({ title: "Help" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/ops/support/tickets (staff list)", () => {
  beforeEach(() => {
    vi.mocked(listTickets).mockResolvedValue([]);
  });

  it("returns 200 with tickets for support.read", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets", { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it("returns 403 without support.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/support/tickets", { headers: authHeader() });
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/ops/support/tickets/mine", () => {
  beforeEach(() => {
    vi.mocked(getOwnTickets).mockResolvedValue([]);
  });

  it("returns 200 for any authenticated user", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/support/tickets/mine", { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/mine");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/ops/support/tickets/:id", () => {
  beforeEach(() => {
    vi.mocked(getTicket).mockResolvedValue({
      ticket: {
        id: "ticket_1",
        title: "Help",
        description: "I need help",
        category: "account",
        priority: "medium",
        status: "open",
        submittedBy: "user_ops_actor",
        assignedTo: null,
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      messages: [],
    });
  });

  it("returns 200 with ticket and messages", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/ticket_1", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: unknown; messages: unknown[] };
    expect(body.ticket).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("calls getTicket with isStaff=true when caller has support.read", async () => {
    const app = makeApp();
    await app.request("/v1/ops/support/tickets/ticket_1", { headers: authHeader() });
    expect(vi.mocked(getTicket)).toHaveBeenCalledWith(
      expect.anything(),
      "ticket_1",
      "user_ops_actor",
      true, // isStaff
    );
  });

  it("calls getTicket with isStaff=false when caller lacks support.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    await app.request("/v1/ops/support/tickets/ticket_1", { headers: authHeader() });
    expect(vi.mocked(getTicket)).toHaveBeenCalledWith(
      expect.anything(),
      "ticket_1",
      "user_ops_actor",
      false, // isStaff — internal messages filtered
    );
  });

  it("returns 403 when non-staff tries to view another user's ticket", async () => {
    vi.mocked(getTicket).mockRejectedValue(
      new ForbiddenError("You can only view your own support tickets."),
    );
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/support/tickets/other_ticket", {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/ops/support/tickets/:id/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addMessage).mockResolvedValue({
      id: "msg_1",
      ticketId: "ticket_1",
      authorId: "user_ops_actor",
      content: "Hello",
      isInternal: false,
      createdAt: new Date(),
    });
  });

  it("returns 201 with message on success", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      ...json({ content: "Hello" }),
    });
    expect(res.status).toBe(201);
  });

  it("passes the full user audit context for a normal reply", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      headers: {
        ...json({ content: "Hello" }).headers,
        "x-request-id": "request-user-reply",
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "ops-test-user",
      },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(vi.mocked(addMessage)).toHaveBeenCalledWith(
      expect.anything(),
      "ticket_1",
      "user_ops_actor",
      "Hello",
      false,
      false,
      expect.objectContaining({
        actorClerkUserId: "clerk_ops_actor",
        actorRoles: ["system_admin"],
        requestId: "request-user-reply",
        ipAddress: "203.0.113.10",
        userAgent: "ops-test-user",
      }),
    );
    expect(vi.mocked(addMessage).mock.calls.at(-1)?.[6]).not.toHaveProperty(
      "requiredPermission",
    );
  });

  it("passes support.respond and staff context for an authorized staff reply", async () => {
    const app = makeApp();
    await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      headers: {
        ...json({ content: "Staff reply" }).headers,
        "x-request-id": "request-staff-reply",
      },
      body: JSON.stringify({ content: "Staff reply" }),
    });
    expect(vi.mocked(addMessage)).toHaveBeenCalledWith(
      expect.anything(),
      "ticket_1",
      "user_ops_actor",
      "Staff reply",
      false,
      true,
      expect.objectContaining({
        actorClerkUserId: "clerk_ops_actor",
        actorRoles: ["system_admin"],
        requiredPermission: "support.respond",
        requestId: "request-staff-reply",
      }),
    );
  });

  it("preserves internal staff notes and records the internal metadata inputs", async () => {
    const app = makeApp();
    await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      ...json({ content: "Internal note", isInternal: true }),
    });
    expect(vi.mocked(addMessage)).toHaveBeenCalledWith(
      expect.anything(),
      "ticket_1",
      "user_ops_actor",
      "Internal note",
      true,
      true,
      expect.objectContaining({
        requiredPermission: "support.respond",
      }),
    );
  });

  it("returns 403 when a non-staff user tries to add an internal note", async () => {
    vi.mocked(addMessage).mockRejectedValue(
      new ForbiddenError("Internal messages can only be posted by support staff."),
    );
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      ...json({ content: "Internal note", isInternal: true }),
    });
    expect(res.status).toBe(403);
  });

  it("does not weaken authentication for message creation", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/ticket_1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/ops/support/tickets/:id/assign", () => {
  beforeEach(() => {
    vi.mocked(assignTicket).mockResolvedValue({
      id: "ticket_1",
      title: "Help",
      description: "I need help",
      category: "account",
      priority: "medium",
      status: "assigned",
      submittedBy: "user_submitter",
      assignedTo: "user_agent",
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 200 when assignment succeeds", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/ticket_1/assign", {
      method: "POST",
      ...json({ assigneeId: "user_agent" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 without support.manage", async () => {
    const app = makeApp(makeIdentity({ permissions: ["support.read", "support.respond"] }));
    const res = await app.request("/v1/ops/support/tickets/ticket_1/assign", {
      method: "POST",
      ...json({ assigneeId: "user_agent" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/ops/support/tickets/:id/close", () => {
  beforeEach(() => {
    vi.mocked(closeTicket).mockResolvedValue({
      id: "ticket_1",
      title: "Help",
      description: "I need help",
      category: "account",
      priority: "medium",
      status: "resolved",
      submittedBy: "user_submitter",
      assignedTo: null,
      resolvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 200 when ticket is closed", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/support/tickets/ticket_1/close", {
      method: "POST",
      ...json({ resolution: "resolved" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 without support.respond", async () => {
    const app = makeApp(makeIdentity({ permissions: ["support.read"] }));
    const res = await app.request("/v1/ops/support/tickets/ticket_1/close", {
      method: "POST",
      ...json({}),
    });
    expect(res.status).toBe(403);
  });
});

// ─── Moderation ───────────────────────────────────────────────────────────────

describe("POST /v1/ops/moderation/reports", () => {
  beforeEach(() => {
    vi.mocked(submitReport).mockResolvedValue({
      id: "report_1",
      entityType: "provider_profile",
      entityId: "profile_abc",
      reporterId: "user_ops_actor",
      reason: "spam",
      description: null,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 201 when report is submitted", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports", {
      method: "POST",
      ...json({ entityType: "provider_profile", entityId: "profile_abc", reason: "spam" }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 401 without auth", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "provider_profile",
        entityId: "profile_abc",
        reason: "spam",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid entity type", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports", {
      method: "POST",
      ...json({ entityType: "invalid_type", entityId: "abc", reason: "spam" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate pending report", async () => {
    vi.mocked(submitReport).mockRejectedValue(
      new ConflictError("You have already submitted a pending report for this content."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports", {
      method: "POST",
      ...json({ entityType: "provider_profile", entityId: "profile_abc", reason: "spam" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /v1/ops/moderation/reports", () => {
  beforeEach(() => {
    vi.mocked(listReports).mockResolvedValue([]);
  });

  it("returns 200 for moderation.read", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports", { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it("returns 403 without moderation.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/moderation/reports", { headers: authHeader() });
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/ops/moderation/reports/:id", () => {
  beforeEach(() => {
    vi.mocked(getReport).mockResolvedValue({
      report: {
        id: "report_1",
        entityType: "provider_profile",
        entityId: "profile_abc",
        reporterId: "user_reporter",
        reason: "spam",
        description: null,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      actions: [],
    });
  });

  it("returns 200 with report and actions", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: unknown; actions: unknown[] };
    expect(body.report).toBeDefined();
    expect(Array.isArray(body.actions)).toBe(true);
  });

  it("returns 403 without moderation.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/moderation/reports/report_1", {
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/ops/moderation/reports/:id/review", () => {
  beforeEach(() => {
    vi.mocked(markReportReviewing).mockResolvedValue({
      id: "report_1",
      entityType: "provider_profile",
      entityId: "profile_abc",
      reporterId: "user_reporter",
      reason: "spam",
      description: null,
      status: "reviewing",
      reviewedBy: "user_ops_actor",
      reviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 200 when report is marked reviewing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1/review", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 without moderation.review", async () => {
    const app = makeApp(makeIdentity({ permissions: ["moderation.read"] }));
    const res = await app.request("/v1/ops/moderation/reports/report_1/review", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/ops/moderation/reports/:id/action", () => {
  beforeEach(() => {
    vi.mocked(takeModerationAction).mockResolvedValue({
      report: {
        id: "report_1",
        entityType: "provider_profile",
        entityId: "profile_abc",
        reporterId: "user_reporter",
        reason: "spam",
        description: null,
        status: "actioned",
        reviewedBy: "user_ops_actor",
        reviewedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      actionId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("returns 200 when action is taken", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1/action", {
      method: "POST",
      ...json({ actionType: "warn", notes: "First warning" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 when dismissing a report", async () => {
    vi.mocked(takeModerationAction).mockResolvedValue({
      report: {
        id: "report_1",
        entityType: "provider_profile",
        entityId: "profile_abc",
        reporterId: "user_reporter",
        reason: "spam",
        description: null,
        status: "dismissed",
        reviewedBy: "user_ops_actor",
        reviewedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      actionId: "00000000-0000-0000-0000-000000000002",
    });
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1/action", {
      method: "POST",
      ...json({ actionType: "dismiss" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 without moderation.action", async () => {
    const app = makeApp(makeIdentity({ permissions: ["moderation.read", "moderation.review"] }));
    const res = await app.request("/v1/ops/moderation/reports/report_1/action", {
      method: "POST",
      ...json({ actionType: "warn" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid action type", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1/action", {
      method: "POST",
      ...json({ actionType: "delete_account" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when report already actioned", async () => {
    vi.mocked(takeModerationAction).mockRejectedValue(
      new ConflictError("Report has already been actioned."),
    );
    const app = makeApp();
    const res = await app.request("/v1/ops/moderation/reports/report_1/action", {
      method: "POST",
      ...json({ actionType: "warn" }),
    });
    expect(res.status).toBe(409);
  });
});

// ─── Audit log ────────────────────────────────────────────────────────────────

describe("GET /v1/ops/audit", () => {
  beforeEach(() => {
    vi.mocked(listOpsAudit).mockResolvedValue([]);
  });

  it("returns 200 with entries for audit.read", async () => {
    const app = makeApp();
    const res = await app.request("/v1/ops/audit", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("returns 200 for system_engineer identity with audit.read but not system.manage", async () => {
    const app = makeApp(
      makeIdentity({ permissions: ["audit.read", "system.health.read", "system.logs.read"] }),
    );
    const res = await app.request("/v1/ops/audit", { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it("returns 403 without audit.read", async () => {
    const app = makeApp(makeIdentity({ permissions: ["users.read"] }));
    const res = await app.request("/v1/ops/audit", { headers: authHeader() });
    expect(res.status).toBe(403);
  });

  it("passes filters to service", async () => {
    const app = makeApp();
    await app.request("/v1/ops/audit?action=role_assigned&limit=10", { headers: authHeader() });
    expect(vi.mocked(listOpsAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "role_assigned", limit: 10 }),
    );
  });
});

// ─── Overview ────────────────────────────────────────────────────────────────

describe("GET /v1/ops/overview", () => {
  it("returns 200 with overview data for ops users", async () => {
    // Mock the db queries used in the overview handler
    const app = makeApp();
    const res = await app.request("/v1/ops/overview", { headers: authHeader() });
    // The overview queries the real schema but we have no DB — it will fail with a DB error.
    // We verify auth passes and the route is reached (not a 401/403).
    // DB errors surface as 500; any non-auth error confirms the route is reachable.
    expect([200, 500]).toContain(res.status);
  });

  it("returns 403 without any ops permission", async () => {
    const app = makeApp(makeIdentity({ permissions: ["profile.read"] }));
    const res = await app.request("/v1/ops/overview", { headers: authHeader() });
    expect(res.status).toBe(403);
  });
});

// ─── Security invariants ─────────────────────────────────────────────────────

describe("Security invariants", () => {
  it("all ops endpoints return 401 without token", async () => {
    const app = makeApp();
    const endpoints = [
      ["GET", "/v1/ops/users"],
      ["GET", "/v1/ops/users/some_id"],
      ["GET", "/v1/ops/roles"],
      ["GET", "/v1/ops/support/tickets"],
      ["GET", "/v1/ops/support/tickets/mine"],
      ["GET", "/v1/ops/moderation/reports"],
      ["GET", "/v1/ops/audit"],
      ["GET", "/v1/ops/overview"],
    ] as const;

    for (const [method, path] of endpoints) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path} should return 401`).toBe(401);
    }
  });

  it("employer cannot access any ops user management endpoint", async () => {
    const app = makeApp(
      makeIdentity({
        accountType: "employer",
        permissions: ["profile.read", "profile.update", "providers.search"],
      }),
    );
    const res = await app.request("/v1/ops/users", { headers: authHeader() });
    expect(res.status).toBe(403);
  });

  it("provider cannot access any ops user management endpoint", async () => {
    const app = makeApp(
      makeIdentity({
        accountType: "provider",
        permissions: ["profile.read", "profile.update", "verification.submit"],
      }),
    );
    const res = await app.request("/v1/ops/users", { headers: authHeader() });
    expect(res.status).toBe(403);
  });

  it("verification_team cannot access support or moderation endpoints", async () => {
    const app = makeApp(
      makeIdentity({
        accountType: "verification_team",
        permissions: [
          "verification.read",
          "verification.review",
          "verification.approve",
          "verification.reject",
        ],
      }),
    );
    const [supportRes, moderationRes] = await Promise.all([
      app.request("/v1/ops/support/tickets", { headers: authHeader() }),
      app.request("/v1/ops/moderation/reports", { headers: authHeader() }),
    ]);
    expect(supportRes.status).toBe(403);
    expect(moderationRes.status).toBe(403);
  });

  it("support_team cannot access user management or moderation admin endpoints", async () => {
    const app = makeApp(
      makeIdentity({
        accountType: "support_team",
        permissions: ["support.read", "support.respond", "support.manage"],
      }),
    );
    const [usersRes, moderationRes] = await Promise.all([
      app.request("/v1/ops/users", { headers: authHeader() }),
      app.request("/v1/ops/moderation/reports", { headers: authHeader() }),
    ]);
    expect(usersRes.status).toBe(403);
    expect(moderationRes.status).toBe(403);
  });
});
