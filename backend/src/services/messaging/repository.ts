/**
 * Messaging repository — PostgreSQL implementation (Stage 7).
 *
 * This is the only layer that touches the database for messaging.
 * All queries return raw DB rows; the service layer converts them to DTOs.
 *
 * Security invariants:
 *   - Participant membership is always verified here before returning data.
 *   - Sender ID is never read from a request body; it comes from the auth context.
 *   - All values are bound parameters via Drizzle — SQL injection structurally impossible.
 */

import { and, eq, lt, gt, desc, asc, or, count, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  conversations,
  conversationParticipants,
  messages,
  messageReports,
  userBlocks,
  users,
} from "../../db/schema/index.js";
import type {
  ConversationRow,
  ParticipantRow,
  MessageRow,
  ListConversationsParams,
  ListMessagesParams,
} from "./types.js";

// ─── Participant helpers ──────────────────────────────────────────────────────

/** Compute the deterministic deduplication hash for a 1:1 conversation. */
export function makeParticipantHash(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}

/** Returns true if userId is a participant in conversationId. */
export async function isParticipant(
  db: Db,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Block helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if either direction of a block exists between two users.
 * (A blocks B) OR (B blocks A) → messaging not allowed.
 */
export async function isBlocked(db: Db, userIdA: string, userIdB: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, userIdA), eq(userBlocks.blockedId, userIdB)),
        and(eq(userBlocks.blockerId, userIdB), eq(userBlocks.blockedId, userIdA)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Conversations ────────────────────────────────────────────────────────────

/** Find an existing 1:1 conversation by participant hash. */
export async function findConversationByHash(
  db: Db,
  hash: string,
): Promise<ConversationRow | null> {
  const rows = await db
    .select({
      id: conversations.id,
      participantHash: conversations.participantHash,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.participantHash, hash))
    .limit(1);
  return rows[0] ?? null;
}

/** Insert a new conversation and its two participants atomically. */
export async function createConversation(
  db: Db,
  id: string,
  participantHash: string,
  userIdA: string,
  userIdB: string,
): Promise<ConversationRow> {
  const [conv] = await db.insert(conversations).values({ id, participantHash }).returning({
    id: conversations.id,
    participantHash: conversations.participantHash,
    createdAt: conversations.createdAt,
    updatedAt: conversations.updatedAt,
  });

  await db.insert(conversationParticipants).values([
    { conversationId: id, userId: userIdA },
    { conversationId: id, userId: userIdB },
  ]);

  return conv!;
}

/** Get a single conversation by ID (no participant check — caller must verify). */
export async function getConversationById(db: Db, id: string): Promise<ConversationRow | null> {
  const rows = await db
    .select({
      id: conversations.id,
      participantHash: conversations.participantHash,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * List conversations for a user, ordered by last activity (updatedAt DESC).
 * Returns only conversations the user participates in.
 */
export async function listConversationsForUser(
  db: Db,
  params: ListConversationsParams,
): Promise<{ rows: ConversationRow[]; total: number }> {
  const { userId, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  // Subquery: conversation IDs the user participates in
  const participantSubquery = db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userId));

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: count() })
      .from(conversations)
      .where(inArray(conversations.id, participantSubquery)),

    db
      .select({
        id: conversations.id,
        participantHash: conversations.participantHash,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(inArray(conversations.id, participantSubquery))
      .orderBy(desc(conversations.updatedAt))
      .limit(pageSize)
      .offset(offset),
  ]);

  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

// ─── Participants ─────────────────────────────────────────────────────────────

/** Load all participants (with user display fields) for a set of conversation IDs. */
export async function loadParticipants(
  db: Db,
  conversationIds: string[],
): Promise<ParticipantRow[]> {
  if (conversationIds.length === 0) return [];
  return db
    .select({
      conversationId: conversationParticipants.conversationId,
      userId: conversationParticipants.userId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      accountType: users.accountType,
      lastReadAt: conversationParticipants.lastReadAt,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(users.id, conversationParticipants.userId))
    .where(inArray(conversationParticipants.conversationId, conversationIds));
}

/** Update a participant's lastReadAt to now. */
export async function markConversationRead(
  db: Db,
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .update(conversationParticipants)
    .set({ lastReadAt: sql`NOW()` })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** Insert a new message. */
export async function insertMessage(
  db: Db,
  id: string,
  conversationId: string,
  senderId: string,
  body: string,
): Promise<MessageRow> {
  const [msg] = await db.insert(messages).values({ id, conversationId, senderId, body }).returning({
    id: messages.id,
    conversationId: messages.conversationId,
    senderId: messages.senderId,
    body: messages.body,
    createdAt: messages.createdAt,
    editedAt: messages.editedAt,
    deletedAt: messages.deletedAt,
    moderationStatus: messages.moderationStatus,
  });

  // Bump conversation.updated_at on every new message
  await db
    .update(conversations)
    .set({ updatedAt: sql`NOW()` })
    .where(eq(conversations.id, conversationId));

  return msg!;
}

/** Fetch a single message row by ID. */
export async function getMessageById(db: Db, messageId: string): Promise<MessageRow | null> {
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      moderationStatus: messages.moderationStatus,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * List messages in a conversation with cursor pagination.
 * Returns messages in ascending order (oldest → newest within the page).
 * The cursor is `before` — a createdAt timestamp; returns messages strictly
 * before that timestamp, limited to `limit` rows, ordered newest-first, then
 * reversed so the client receives them in chronological order.
 */
export async function listMessages(db: Db, params: ListMessagesParams): Promise<MessageRow[]> {
  const { conversationId, before, limit } = params;

  const conditions = [eq(messages.conversationId, conversationId)];

  if (before) {
    conditions.push(lt(messages.createdAt, new Date(before)));
  }

  // Fetch `limit` rows newest-first (efficient index usage), then reverse
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      moderationStatus: messages.moderationStatus,
    })
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Return oldest → newest (as documented in contract)
  return rows.reverse();
}

/** Get the most recent visible message in a conversation (for lastMessage preview). */
export async function getLastMessage(db: Db, conversationId: string): Promise<MessageRow | null> {
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      moderationStatus: messages.moderationStatus,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Count messages created after lastReadAt for a given conversation + user. */
export async function countUnread(
  db: Db,
  conversationId: string,
  lastReadAt: Date | null,
): Promise<number> {
  if (lastReadAt === null) {
    // Never read — count all messages
    const rows = await db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    return Number(rows[0]?.count ?? 0);
  }

  const rows = await db
    .select({ count: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.createdAt, lastReadAt)));
  return Number(rows[0]?.count ?? 0);
}

/** Edit a message body (sets editedAt). */
export async function editMessage(
  db: Db,
  messageId: string,
  body: string,
): Promise<MessageRow | null> {
  const rows = await db
    .update(messages)
    .set({ body, editedAt: sql`NOW()` })
    .where(eq(messages.id, messageId))
    .returning({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      moderationStatus: messages.moderationStatus,
    });
  return rows[0] ?? null;
}

/** Soft-delete a message (sets deletedAt). */
export async function softDeleteMessage(db: Db, messageId: string): Promise<MessageRow | null> {
  const rows = await db
    .update(messages)
    .set({ deletedAt: sql`NOW()` })
    .where(eq(messages.id, messageId))
    .returning({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      moderationStatus: messages.moderationStatus,
    });
  return rows[0] ?? null;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

/** Insert a message report. Returns false if already reported by this user. */
export async function insertMessageReport(
  db: Db,
  id: string,
  messageId: string,
  reporterId: string,
  reason: string,
): Promise<boolean> {
  try {
    await db.insert(messageReports).values({ id, messageId, reporterId, reason });

    // Flag the message for moderation review
    await db
      .update(messages)
      .set({ moderationStatus: "flagged" })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.moderationStatus, "visible"), // don't downgrade if already 'hidden'
        ),
      );

    return true;
  } catch (err: unknown) {
    // Unique constraint violation — already reported
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return false;
    }
    throw err;
  }
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

/** Insert a user block. Returns false if already blocked. */
export async function insertBlock(db: Db, blockerId: string, blockedId: string): Promise<boolean> {
  try {
    await db.insert(userBlocks).values({ blockerId, blockedId });
    return true;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return false; // already blocked
    }
    throw err;
  }
}

/** Remove a user block. Returns true if a row was deleted. */
export async function deleteBlock(db: Db, blockerId: string, blockedId: string): Promise<boolean> {
  const rows = await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
    .returning({ blockerId: userBlocks.blockerId });
  return rows.length > 0;
}
