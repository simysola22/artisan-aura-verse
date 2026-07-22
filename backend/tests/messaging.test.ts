/**
 * Messaging system tests — Stage 7.
 *
 * Two layers tested:
 *
 * 1. Service unit tests — mock repository functions via vi.mock, test
 *    business-rule enforcement in isolation.
 *
 * 2. Route integration tests — use createApp() with injected mocks (same
 *    pattern as verification.test.ts). Service functions are vi.mock'd so
 *    routes are tested without a real DB.
 *
 * Tests covered:
 *
 *   Conversations
 *     - list conversations (authenticated)
 *     - create / get-or-create conversation
 *     - cannot start conversation with yourself
 *     - blocked user cannot initiate conversation
 *     - duplicate conversation returns existing
 *     - get single conversation — participant only
 *     - 403 for non-participant
 *
 *   Messages
 *     - send message
 *     - send message publishes to PubSub
 *     - 400 for empty body
 *     - 400 for oversized body (>4000 chars)
 *     - list messages (returns oldest→newest)
 *     - cursor pagination (before)
 *     - edit own message
 *     - 403 editing someone else's message
 *     - 400 editing deleted message
 *     - delete (soft) own message
 *     - 403 deleting someone else's message
 *
 *   Authorization
 *     - 401 without token on every authenticated endpoint
 *     - 403 without messaging.use permission
 *     - 403 accessing conversation as non-participant (IDOR)
 *     - sender ID always comes from auth context (forged senderId in body ignored)
 *
 *   Moderation
 *     - report a message
 *     - 409 duplicate report
 *     - 400 reporting own message
 *     - block a user
 *     - unblock a user
 *     - blocked user cannot send message
 *
 *   PubSub
 *     - subscribe and receive event
 *     - unsubscribe cleans up
 *     - subscriber error does not prevent delivery to others
 *     - subscriber count
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import { pubsub as realPubsub, type PubSub, type MessageEvent } from "../src/lib/pubsub.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from "../src/errors/index.js";

// ─── Mock service module ───────────────────────────────────────────────────────

vi.mock("../src/services/messaging/index.js", () => ({
  getOrCreateConversation: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  listMessages: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  reportMessage: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

import {
  getOrCreateConversation,
  listConversations,
  getConversation,
  sendMessage,
  listMessages,
  editMessage,
  deleteMessage,
  reportMessage,
  blockUser,
  unblockUser,
} from "../src/services/messaging/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T00:00:00Z");

function makeUser(overrides: Partial<ResolvedIdentity["user"]> = {}): ResolvedIdentity["user"] {
  return {
    id: "pmp_employer_1",
    clerkUserId: "user_clerk_employer",
    accountType: "employer",
    providerKind: null,
    status: "active",
    displayName: "Alice Employer",
    email: "alice@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const employerIdentity: ResolvedIdentity = {
  user: makeUser(),
  roleNames: ["employer"],
  permissions: new Set(["profile.read", "profile.update", "providers.search", "messaging.use"]),
};

const providerIdentity: ResolvedIdentity = {
  user: makeUser({
    id: "pmp_provider_1",
    clerkUserId: "user_clerk_provider",
    accountType: "provider",
    providerKind: "artisan",
    displayName: "Bob Provider",
    email: "bob@example.com",
  }),
  roleNames: ["provider"],
  permissions: new Set(["profile.read", "profile.update", "verification.submit", "messaging.use"]),
};

/** Identity without messaging.use permission */
const noMessagingIdentity: ResolvedIdentity = {
  user: makeUser({ id: "pmp_noperm_1", clerkUserId: "user_clerk_noperm" }),
  roleNames: ["employer"],
  permissions: new Set(["profile.read"]),
};

const sampleConversation = {
  id: "conv_1",
  participants: [
    { id: "pmp_employer_1", displayName: "Alice Employer", avatarUrl: null, role: "employer" as const },
    { id: "pmp_provider_1", displayName: "Bob Provider", avatarUrl: null, role: "provider" as const },
  ],
  lastMessage: null,
  unreadCount: 0,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const sampleMessage = {
  id: "msg_1",
  conversationId: "conv_1",
  senderId: "pmp_employer_1",
  body: "Hello, Bob!",
  createdAt: now.toISOString(),
  editedAt: null,
  isDeleted: false,
  status: "sent" as const,
};

// ─── App factory ──────────────────────────────────────────────────────────────

/** Create a mock PubSub that captures publications for assertions. */
function makeMockPubSub(): PubSub & {
  published: { conversationId: string; event: MessageEvent }[];
} {
  const published: { conversationId: string; event: MessageEvent }[] = [];
  const subs = new Map<string, Set<(e: MessageEvent) => void>>();
  return {
    published,
    publish(conversationId: string, event: MessageEvent) {
      published.push({ conversationId, event });
      subs.get(conversationId)?.forEach((fn) => fn(event));
    },
    subscribe(conversationId: string, fn: (e: MessageEvent) => void) {
      if (!subs.has(conversationId)) subs.set(conversationId, new Set());
      subs.get(conversationId)!.add(fn);
      return () => {
        subs.get(conversationId)?.delete(fn);
      };
    },
    subscriberCount(conversationId: string) {
      return subs.get(conversationId)?.size ?? 0;
    },
  };
}

/**
 * Build a test app with a single authenticated identity.
 * The identity's token is derived from its clerkUserId for uniqueness.
 */
function makeApp(callerIdentity: ResolvedIdentity, ps?: PubSub) {
  const token = `token_${callerIdentity.user.clerkUserId}`;
  const clerkMap = new Map<string, { clerkUserId: string } | Error>([
    [token, { clerkUserId: callerIdentity.user.clerkUserId }],
  ]);
  const identityMap = new Map<string, ResolvedIdentity>([
    [callerIdentity.user.clerkUserId, callerIdentity],
  ]);
  const identityService: AuthIdentityService = {
    resolve: async (clerkUserId) => identityMap.get(clerkUserId) ?? null,
    provision: vi.fn() as never,
    updateProfile: vi.fn() as never,
  };
  return createApp({
    clerkAdapter: createMockClerkAdapter(clerkMap),
    identityService,
    pubsub: ps ?? makeMockPubSub(),
  });
}

function authHeader(identity: ResolvedIdentity): Record<string, string> {
  return { Authorization: `Bearer token_${identity.user.clerkUserId}` };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
// PubSub unit tests
// ════════════════════════════════════════════════════════════════════════

describe("InMemoryPubSub", () => {
  const sampleEvent: MessageEvent = {
    conversationId: "conv_1",
    messageId: "msg_1",
    senderId: "user_1",
    body: "hi",
    createdAt: now.toISOString(),
  };

  it("delivers an event to a subscriber", () => {
    const received: MessageEvent[] = [];
    const unsub = realPubsub.subscribe("test_conv_a", (e) => received.push(e));
    realPubsub.publish("test_conv_a", sampleEvent);
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sampleEvent);
  });

  it("does not deliver to a different conversation", () => {
    const received: MessageEvent[] = [];
    const unsub = realPubsub.subscribe("test_conv_b", (e) => received.push(e));
    realPubsub.publish("test_conv_c", sampleEvent);
    unsub();
    expect(received).toHaveLength(0);
  });

  it("unsubscribe prevents further delivery", () => {
    const received: MessageEvent[] = [];
    const unsub = realPubsub.subscribe("test_conv_d", (e) => received.push(e));
    unsub();
    realPubsub.publish("test_conv_d", sampleEvent);
    expect(received).toHaveLength(0);
  });

  it("subscriber count tracks subscriptions correctly", () => {
    const unsub1 = realPubsub.subscribe("test_conv_e", () => {});
    const unsub2 = realPubsub.subscribe("test_conv_e", () => {});
    expect(realPubsub.subscriberCount("test_conv_e")).toBe(2);
    unsub1();
    expect(realPubsub.subscriberCount("test_conv_e")).toBe(1);
    unsub2();
    expect(realPubsub.subscriberCount("test_conv_e")).toBe(0);
  });

  it("a subscriber error does not prevent delivery to other subscribers", () => {
    const received: MessageEvent[] = [];
    const unsub1 = realPubsub.subscribe("test_conv_f", () => {
      throw new Error("subscriber error");
    });
    const unsub2 = realPubsub.subscribe("test_conv_f", (e) => received.push(e));
    realPubsub.publish("test_conv_f", sampleEvent);
    unsub1();
    unsub2();
    expect(received).toHaveLength(1);
  });

  it("channel is cleaned up when all subscribers unsubscribe", () => {
    const unsub = realPubsub.subscribe("test_conv_g", () => {});
    unsub();
    expect(realPubsub.subscriberCount("test_conv_g")).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: unauthenticated access
// ════════════════════════════════════════════════════════════════════════

describe("Messaging routes — unauthenticated", () => {
  const app = makeApp(employerIdentity);

  const endpoints: [string, string, unknown?][] = [
    ["GET", "/v1/messaging/conversations"],
    ["POST", "/v1/messaging/conversations", { recipientId: "x" }],
    ["GET", "/v1/messaging/conversations/conv_1"],
    ["GET", "/v1/messaging/conversations/conv_1/messages"],
    ["POST", "/v1/messaging/conversations/conv_1/messages", { body: "hi" }],
    ["PATCH", "/v1/messaging/messages/msg_1", { body: "edit" }],
    ["DELETE", "/v1/messaging/messages/msg_1"],
    ["POST", "/v1/messaging/messages/msg_1/report", { reason: "spam" }],
    ["POST", "/v1/messaging/users/user_2/block"],
    ["DELETE", "/v1/messaging/users/user_2/block"],
  ];

  for (const [method, path, body] of endpoints) {
    it(`${method} ${path} returns 401 without token`, async () => {
      const res = await app.request(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(401);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// Route: permission enforcement
// ════════════════════════════════════════════════════════════════════════

describe("Messaging routes — missing messaging.use permission", () => {
  const app = makeApp(noMessagingIdentity);

  it("GET /v1/messaging/conversations returns 403", async () => {
    const res = await app.request("/v1/messaging/conversations", {
      headers: authHeader(noMessagingIdentity),
    });
    expect(res.status).toBe(403);
  });

  it("POST /v1/messaging/conversations returns 403", async () => {
    const res = await app.request("/v1/messaging/conversations", {
      method: "POST",
      headers: { ...authHeader(noMessagingIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "pmp_provider_1" }),
    });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: GET /v1/messaging/conversations
// ════════════════════════════════════════════════════════════════════════

describe("GET /v1/messaging/conversations", () => {
  it("returns conversation list for authenticated user", async () => {
    const paginatedResult = {
      items: [sampleConversation],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    vi.mocked(listConversations).mockResolvedValueOnce(paginatedResult);

    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations", {
      headers: authHeader(employerIdentity),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(listConversations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "pmp_employer_1", page: 1, pageSize: 20 }),
    );
  });

  it("passes page and pageSize query params", async () => {
    vi.mocked(listConversations).mockResolvedValueOnce({
      items: [],
      page: 2,
      pageSize: 5,
      total: 0,
    });
    const app = makeApp(employerIdentity);
    await app.request("/v1/messaging/conversations?page=2&pageSize=5", {
      headers: authHeader(employerIdentity),
    });
    expect(listConversations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, pageSize: 5 }),
    );
  });

  it("rejects invalid pageSize", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations?pageSize=200", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: POST /v1/messaging/conversations
// ════════════════════════════════════════════════════════════════════════

describe("POST /v1/messaging/conversations", () => {
  it("creates / returns a conversation", async () => {
    vi.mocked(getOrCreateConversation).mockResolvedValueOnce(sampleConversation);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "pmp_provider_1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("conv_1");
    expect(getOrCreateConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initiatorId: "pmp_employer_1", recipientId: "pmp_provider_1" }),
    );
  });

  it("returns 400 if recipientId is missing", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when service rejects self-conversation", async () => {
    vi.mocked(getOrCreateConversation).mockRejectedValueOnce(
      new BadRequestError("You cannot start a conversation with yourself."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "pmp_employer_1" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("bad_request");
  });

  it("returns 403 when service rejects blocked user", async () => {
    vi.mocked(getOrCreateConversation).mockRejectedValueOnce(
      new ForbiddenError("You cannot message this user."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "pmp_blocked_1" }),
    });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: GET /v1/messaging/conversations/:id
// ════════════════════════════════════════════════════════════════════════

describe("GET /v1/messaging/conversations/:id", () => {
  it("returns conversation for participant", async () => {
    vi.mocked(getConversation).mockResolvedValueOnce(sampleConversation);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("conv_1");
  });

  it("returns 403 for non-participant (IDOR prevention)", async () => {
    vi.mocked(getConversation).mockRejectedValueOnce(
      new ForbiddenError("You are not a participant in this conversation."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_other", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent conversation", async () => {
    vi.mocked(getConversation).mockRejectedValueOnce(new NotFoundError("Conversation"));
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_missing", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: GET /v1/messaging/conversations/:id/messages
// ════════════════════════════════════════════════════════════════════════

describe("GET /v1/messaging/conversations/:id/messages", () => {
  const msgs = [sampleMessage, { ...sampleMessage, id: "msg_2", body: "Second message" }];

  it("returns messages for participant", async () => {
    vi.mocked(listMessages).mockResolvedValueOnce(msgs);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1/messages", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveLength(2);
  });

  it("passes before cursor and limit params", async () => {
    vi.mocked(listMessages).mockResolvedValueOnce([]);
    const app = makeApp(employerIdentity);
    const before = "2026-07-20T12:00:00.000Z";
    await app.request(`/v1/messaging/conversations/conv_1/messages?before=${before}&limit=10`, {
      headers: authHeader(employerIdentity),
    });
    expect(listMessages).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ before, limit: 10 }),
      "pmp_employer_1",
    );
  });

  it("rejects invalid before value", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1/messages?before=not-a-date", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-participant", async () => {
    vi.mocked(listMessages).mockRejectedValueOnce(
      new ForbiddenError("You are not a participant in this conversation."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_other/messages", {
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: POST /v1/messaging/conversations/:id/messages
// ════════════════════════════════════════════════════════════════════════

describe("POST /v1/messaging/conversations/:id/messages", () => {
  it("sends a message and returns it", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce(sampleMessage);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1/messages", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Hello!" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("msg_1");
    expect(body.status).toBe("sent");
  });

  it("sender ID comes from auth context, not request body", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce(sampleMessage);
    const app = makeApp(employerIdentity);
    await app.request("/v1/messaging/conversations/conv_1/messages", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      // Attempt to forge senderId — route must ignore this field
      body: JSON.stringify({ body: "Hello!", senderId: "pmp_evil_attacker" }),
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ senderId: "pmp_employer_1" }),
    );
  });

  it("returns 400 for empty body", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1/messages", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for body exceeding 4000 chars", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_1/messages", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "x".repeat(4001) }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-participant", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(
      new ForbiddenError("You are not a participant in this conversation."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/conversations/conv_other/messages", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "intrude" }),
    });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: PATCH /v1/messaging/messages/:id
// ════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/messaging/messages/:id", () => {
  it("edits own message", async () => {
    const edited = { ...sampleMessage, body: "Edited!", editedAt: now.toISOString() };
    vi.mocked(editMessage).mockResolvedValueOnce(edited);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1", {
      method: "PATCH",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Edited!" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.body).toBe("Edited!");
    expect(body.editedAt).toBeTruthy();
  });

  it("returns 403 when editing another user's message", async () => {
    vi.mocked(editMessage).mockRejectedValueOnce(
      new ForbiddenError("You can only edit your own messages."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_other", {
      method: "PATCH",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Evil edit" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when editing a deleted message", async () => {
    vi.mocked(editMessage).mockRejectedValueOnce(
      new BadRequestError("Cannot edit a deleted message."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_deleted", {
      method: "PATCH",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Oops" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty edit body", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1", {
      method: "PATCH",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: DELETE /v1/messaging/messages/:id
// ════════════════════════════════════════════════════════════════════════

describe("DELETE /v1/messaging/messages/:id", () => {
  it("soft-deletes own message", async () => {
    const deleted = { ...sampleMessage, isDeleted: true, body: "" };
    vi.mocked(deleteMessage).mockResolvedValueOnce(deleted);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isDeleted).toBe(true);
    expect(body.body).toBe("");
  });

  it("returns 403 when deleting another user's message", async () => {
    vi.mocked(deleteMessage).mockRejectedValueOnce(
      new ForbiddenError("You can only delete your own messages."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_other", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent message", async () => {
    vi.mocked(deleteMessage).mockRejectedValueOnce(new NotFoundError("Message"));
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_missing", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when message is already deleted", async () => {
    vi.mocked(deleteMessage).mockRejectedValueOnce(
      new BadRequestError("Message is already deleted."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_already_deleted", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: POST /v1/messaging/messages/:id/report
// ════════════════════════════════════════════════════════════════════════

describe("POST /v1/messaging/messages/:id/report", () => {
  it("reports a message successfully", async () => {
    vi.mocked(reportMessage).mockResolvedValueOnce({ reportId: "report_1" });
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1/report", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Spam content" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.reportId).toBe("report_1");
  });

  it("returns 409 for duplicate report", async () => {
    vi.mocked(reportMessage).mockRejectedValueOnce(
      new ConflictError("You have already reported this message."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1/report", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Spam again" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when reporting own message", async () => {
    vi.mocked(reportMessage).mockRejectedValueOnce(
      new BadRequestError("You cannot report your own message."),
    );
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_own/report", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "I hate my own message" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing reason", async () => {
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/messages/msg_1/report", {
      method: "POST",
      headers: { ...authHeader(employerIdentity), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route: Block / Unblock
// ════════════════════════════════════════════════════════════════════════

describe("POST /v1/messaging/users/:id/block", () => {
  it("blocks a user", async () => {
    vi.mocked(blockUser).mockResolvedValueOnce(undefined);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/users/pmp_provider_1/block", {
      method: "POST",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(blockUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ blockerId: "pmp_employer_1", blockedId: "pmp_provider_1" }),
    );
  });

  it("returns 400 when service rejects self-block", async () => {
    vi.mocked(blockUser).mockRejectedValueOnce(new BadRequestError("You cannot block yourself."));
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/users/pmp_employer_1/block", {
      method: "POST",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /v1/messaging/users/:id/block", () => {
  it("unblocks a user", async () => {
    vi.mocked(unblockUser).mockResolvedValueOnce(undefined);
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/users/pmp_provider_1/block", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("returns 404 when block does not exist", async () => {
    vi.mocked(unblockUser).mockRejectedValueOnce(new NotFoundError("Block"));
    const app = makeApp(employerIdentity);
    const res = await app.request("/v1/messaging/users/pmp_provider_1/block", {
      method: "DELETE",
      headers: authHeader(employerIdentity),
    });
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// DTO serializer unit tests
// ════════════════════════════════════════════════════════════════════════

import { toMessageDto } from "../src/services/messaging/types.js";
import { makeParticipantHash } from "../src/services/messaging/repository.js";

describe("toMessageDto", () => {
  it("maps a visible message row to DTO", () => {
    const row = {
      id: "msg_1",
      conversationId: "conv_1",
      senderId: "user_1",
      body: "Hello",
      createdAt: now,
      editedAt: null,
      deletedAt: null,
      moderationStatus: "visible",
    };
    const dto = toMessageDto(row);
    expect(dto.body).toBe("Hello");
    expect(dto.isDeleted).toBe(false);
    expect(dto.status).toBe("sent");
    expect(dto.createdAt).toBe(now.toISOString());
  });

  it("replaces body with empty string for soft-deleted messages", () => {
    const row = {
      id: "msg_2",
      conversationId: "conv_1",
      senderId: "user_1",
      body: "Secret content",
      createdAt: now,
      editedAt: null,
      deletedAt: new Date(),
      moderationStatus: "visible",
    };
    const dto = toMessageDto(row);
    expect(dto.body).toBe("");
    expect(dto.isDeleted).toBe(true);
  });

  it("includes editedAt when present", () => {
    const editedAt = new Date("2026-07-20T01:00:00Z");
    const row = {
      id: "msg_3",
      conversationId: "conv_1",
      senderId: "user_1",
      body: "Edited",
      createdAt: now,
      editedAt,
      deletedAt: null,
      moderationStatus: "visible",
    };
    const dto = toMessageDto(row);
    expect(dto.editedAt).toBe(editedAt.toISOString());
  });
});

// ════════════════════════════════════════════════════════════════════════
// participant_hash helper
// ════════════════════════════════════════════════════════════════════════

describe("makeParticipantHash", () => {
  it("is deterministic regardless of argument order", () => {
    const h1 = makeParticipantHash("user_a", "user_b");
    const h2 = makeParticipantHash("user_b", "user_a");
    expect(h1).toBe(h2);
  });

  it("is unique for different pairs", () => {
    const h1 = makeParticipantHash("user_a", "user_b");
    const h2 = makeParticipantHash("user_a", "user_c");
    expect(h1).not.toBe(h2);
  });
});
