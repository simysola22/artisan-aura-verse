import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client.js";
import { addMessage } from "../src/services/ops/support.js";
import { appendOpsAudit } from "../src/services/ops/audit.js";

vi.mock("../src/services/ops/audit.js", () => ({
  appendOpsAudit: vi.fn(),
}));

function makeDb() {
  const ticket = {
    id: "ticket_1",
    title: "Help",
    description: "I need help",
    category: "account",
    priority: "medium",
    status: "open",
    submittedBy: "user_submitter",
    assignedTo: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const message = {
    id: "message_1",
    ticketId: "ticket_1",
    authorId: "user_submitter",
    content: "Hello",
    isInternal: false,
    createdAt: new Date(),
  };

  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [ticket],
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        returning: async () => [message],
      }),
    })),
  };

  return { db: db as unknown as Db, message };
}

describe("addMessage audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits a normal ticket-owner reply with its actor context", async () => {
    const { db, message } = makeDb();
    const auditContext = {
      actorClerkUserId: "clerk_user",
      actorRoles: ["provider"],
      clerkSessionId: "session_1",
      requestId: "request_1",
      ipAddress: "203.0.113.10",
      userAgent: "support-test",
    };

    await expect(
      addMessage(db, "ticket_1", "user_submitter", "Hello", false, false, auditContext),
    ).resolves.toEqual(message);

    expect(vi.mocked(appendOpsAudit)).toHaveBeenCalledWith(db, {
      actorId: "user_submitter",
      action: "support_ticket_message_added",
      entityType: "support_ticket",
      entityId: "ticket_1",
      metadata: { ticketId: "ticket_1", isInternal: false, isStaff: false },
      ...auditContext,
    });
  });

  it("audits an authorized staff reply with the required permission", async () => {
    const { db, message } = makeDb();
    const auditContext = {
      actorClerkUserId: "clerk_staff",
      actorRoles: ["support_team"],
      requiredPermission: "support.respond",
    };

    await expect(
      addMessage(db, "ticket_1", "staff_user", "Staff reply", false, true, auditContext),
    ).resolves.toEqual(message);

    expect(vi.mocked(appendOpsAudit)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "support_ticket_message_added",
        metadata: { ticketId: "ticket_1", isInternal: false, isStaff: true },
        requiredPermission: "support.respond",
      }),
    );
  });

  it("audits an internal staff note as internal", async () => {
    const { db, message } = makeDb();
    message.isInternal = true;

    await expect(
      addMessage(db, "ticket_1", "staff_user", "Internal note", true, true, {
        actorClerkUserId: "clerk_staff",
        actorRoles: ["support_team"],
        requiredPermission: "support.respond",
      }),
    ).resolves.toEqual(message);

    expect(vi.mocked(appendOpsAudit)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "support_ticket_message_added",
        metadata: { ticketId: "ticket_1", isInternal: true, isStaff: true },
      }),
    );
  });
});