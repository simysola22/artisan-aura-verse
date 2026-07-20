/**
 * Messaging routes — /v1/messaging/* (Stage 7).
 *
 * Endpoints:
 *   GET    /v1/messaging/conversations                          list caller's conversations
 *   POST   /v1/messaging/conversations                          get-or-create 1:1 conversation
 *   GET    /v1/messaging/conversations/:id                      get single conversation
 *   GET    /v1/messaging/conversations/:id/messages             list messages (cursor pagination)
 *   POST   /v1/messaging/conversations/:id/messages             send message
 *   PATCH  /v1/messaging/messages/:id                           edit own message
 *   DELETE /v1/messaging/messages/:id                           soft-delete own message
 *   POST   /v1/messaging/messages/:id/report                    report a message
 *   POST   /v1/messaging/users/:id/block                        block a user
 *   DELETE /v1/messaging/users/:id/block                        unblock a user
 *   GET    /v1/messaging/conversations/:id/stream               SSE realtime stream
 *
 * Security:
 *   - All endpoints require a valid Clerk Bearer token (requireClerkAuth).
 *   - All endpoints require the 'messaging.use' permission.
 *   - Sender ID always comes from c.var.auth — never the request body.
 *   - Participant membership is enforced in the service layer before returning data.
 *   - IDOR: accessing a conversation the caller doesn't participate in returns 403.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Db } from "../db/client.js";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import { requireClerkAuth, requirePermission } from "../middleware/auth.js";
import type { PubSub } from "../lib/pubsub.js";
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
} from "../services/messaging/index.js";

// ─── Validation schemas ───────────────────────────────────────────────────────

const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createConversationSchema = z.object({
  recipientId: z.string().min(1, "recipientId is required"),
});

const listMessagesSchema = z.object({
  before: z.string().datetime({ message: "before must be an ISO-8601 datetime" }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageSchema = z.object({
  body: z.string().min(1, "body cannot be empty").max(4000, "body cannot exceed 4000 characters"),
});

const editMessageSchema = z.object({
  body: z.string().min(1, "body cannot be empty").max(4000, "body cannot exceed 4000 characters"),
});

const reportMessageSchema = z.object({
  reason: z
    .string()
    .min(1, "reason cannot be empty")
    .max(1000, "reason cannot exceed 1000 characters"),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createMessagingRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
  pubsub: PubSub,
): Hono {
  const router = new Hono();

  // All messaging routes require a valid Clerk session and messaging.use permission
  const auth = requireClerkAuth(clerkAdapter, resolveUser);
  const canMessage = requirePermission("messaging.use");

  // ── List conversations ───────────────────────────────────────────────────

  router.get(
    "/v1/messaging/conversations",
    auth,
    canMessage,
    zValidator("query", listConversationsSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const { page, pageSize } = c.req.valid("query");

      const result = await listConversations(db, { userId: pmpUserId, page, pageSize });
      return c.json(result);
    },
  );

  // ── Get or create 1:1 conversation ──────────────────────────────────────

  router.post(
    "/v1/messaging/conversations",
    auth,
    canMessage,
    zValidator("json", createConversationSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const { recipientId } = c.req.valid("json");

      const conversation = await getOrCreateConversation(db, {
        initiatorId: pmpUserId,
        recipientId,
      });
      return c.json(conversation, 200);
    },
  );

  // ── Get single conversation ──────────────────────────────────────────────

  router.get("/v1/messaging/conversations/:id", auth, canMessage, async (c) => {
    const { pmpUserId } = c.var.auth;
    const conversationId = c.req.param("id");

    const conversation = await getConversation(db, conversationId, pmpUserId);
    return c.json(conversation);
  });

  // ── List messages (cursor pagination) ────────────────────────────────────

  router.get(
    "/v1/messaging/conversations/:id/messages",
    auth,
    canMessage,
    zValidator("query", listMessagesSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const conversationId = c.req.param("id");
      const { before, limit } = c.req.valid("query");

      const msgs = await listMessages(
        db,
        { conversationId, ...(before !== undefined ? { before } : {}), limit },
        pmpUserId,
      );
      return c.json(msgs);
    },
  );

  // ── Send message ─────────────────────────────────────────────────────────

  router.post(
    "/v1/messaging/conversations/:id/messages",
    auth,
    canMessage,
    zValidator("json", sendMessageSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const conversationId = c.req.param("id");
      const { body } = c.req.valid("json");

      const msg = await sendMessage(db, pubsub, {
        conversationId,
        senderId: pmpUserId,
        body,
      });
      return c.json(msg, 200);
    },
  );

  // ── Edit message ─────────────────────────────────────────────────────────

  router.patch(
    "/v1/messaging/messages/:id",
    auth,
    canMessage,
    zValidator("json", editMessageSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const messageId = c.req.param("id");
      const { body } = c.req.valid("json");

      const msg = await editMessage(db, { messageId, editorId: pmpUserId, body });
      return c.json(msg);
    },
  );

  // ── Delete (soft) message ────────────────────────────────────────────────

  router.delete("/v1/messaging/messages/:id", auth, canMessage, async (c) => {
    const { pmpUserId } = c.var.auth;
    const messageId = c.req.param("id");

    const msg = await deleteMessage(db, { messageId, deleterId: pmpUserId });
    return c.json(msg);
  });

  // ── Report message ───────────────────────────────────────────────────────

  router.post(
    "/v1/messaging/messages/:id/report",
    auth,
    canMessage,
    zValidator("json", reportMessageSchema),
    async (c) => {
      const { pmpUserId } = c.var.auth;
      const messageId = c.req.param("id");
      const { reason } = c.req.valid("json");

      const result = await reportMessage(db, {
        messageId,
        reporterId: pmpUserId,
        reason,
      });
      return c.json(result, 200);
    },
  );

  // ── Block user ───────────────────────────────────────────────────────────

  router.post("/v1/messaging/users/:id/block", auth, canMessage, async (c) => {
    const { pmpUserId } = c.var.auth;
    const blockedId = c.req.param("id");

    await blockUser(db, { blockerId: pmpUserId, blockedId });
    return c.json({ ok: true }, 200);
  });

  // ── Unblock user ─────────────────────────────────────────────────────────

  router.delete("/v1/messaging/users/:id/block", auth, canMessage, async (c) => {
    const { pmpUserId } = c.var.auth;
    const blockedId = c.req.param("id");

    await unblockUser(db, { blockerId: pmpUserId, blockedId });
    return c.json({ ok: true }, 200);
  });

  // ── SSE realtime stream ──────────────────────────────────────────────────
  //
  // GET /v1/messaging/conversations/:id/stream
  //
  // Client connects with a valid Bearer token. The server:
  //   1. Verifies auth and participant membership.
  //   2. Subscribes to the conversation's PubSub channel.
  //   3. Streams SSE events as new messages arrive.
  //   4. On client disconnect, cleans up the subscription.
  //
  // Event shape:
  //   event: message
  //   data: { conversationId, messageId, senderId, body, createdAt }
  //
  // Keep-alive:
  //   A comment ping is sent every 30 s to prevent proxy timeouts.
  //
  // Reconnection:
  //   On disconnect, the frontend refetches listMessages() via React Query
  //   invalidation to close any gap (per contract). The client reconnects
  //   with standard SSE reconnect behaviour.

  router.get("/v1/messaging/conversations/:id/stream", auth, canMessage, async (c) => {
    const { pmpUserId } = c.var.auth;
    const conversationId = c.req.param("id");

    // Verify participant before opening stream (prevents unauthorized subscriptions)
    await getConversation(db, conversationId, pmpUserId);

    return streamSSE(c, async (stream) => {
      let unsubscribe: (() => void) | null = null;

      // Keep-alive ping every 30 s (empty data event to prevent proxy timeouts)
      const ping = setInterval(() => {
        stream.writeSSE({ data: "" }).catch(() => {
          clearInterval(ping);
        });
      }, 30_000);

      unsubscribe = pubsub.subscribe(conversationId, (event) => {
        stream
          .writeSSE({
            event: "message",
            data: JSON.stringify(event),
          })
          .catch(() => {
            // Client disconnected mid-write
          });
      });

      // Block until the client disconnects
      await stream.onAbort(async () => {
        clearInterval(ping);
        if (unsubscribe) unsubscribe();
      });

      // Hold the stream open — never resolve until aborted
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });

      clearInterval(ping);
      if (unsubscribe) unsubscribe();
    });
  });

  return router;
}
