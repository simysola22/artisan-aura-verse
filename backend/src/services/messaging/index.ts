/**
 * Messaging service — Stage 7.
 *
 * Orchestrates repositories and enforces business rules.
 * No route handler touches repositories directly.
 *
 * Business rules enforced here:
 *   - Users cannot message themselves.
 *   - Blocked users (either direction) cannot initiate or send messages.
 *   - Sender ID always comes from the auth context, never from the client.
 *   - Message body max 4 000 characters.
 *   - Only message owners can edit or delete their own messages.
 *   - Reporters cannot report their own messages.
 *   - Duplicate conversations between the same two users are returned, not re-created.
 */

import { randomUUID } from "crypto";
import type { Db } from "../../db/client.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors/index.js";
import type { PubSub } from "../../lib/pubsub.js";
import {
  makeParticipantHash,
  findConversationByHash,
  createConversation,
  getConversationById,
  listConversationsForUser,
  loadParticipants,
  markConversationRead,
  insertMessage,
  getMessageById,
  listMessages as repoListMessages,
  getLastMessage,
  countUnread,
  editMessage as repoEditMessage,
  softDeleteMessage,
  insertMessageReport,
  insertBlock,
  deleteBlock,
  isParticipant,
  isBlocked,
} from "./repository.js";
import {
  toMessageDto,
  toParticipantDto,
  type ConversationDto,
  type MessageDto,
  type CreateConversationParams,
  type SendMessageParams,
  type EditMessageParams,
  type DeleteMessageParams,
  type ReportMessageParams,
  type BlockUserParams,
  type ListMessagesParams,
  type ListConversationsParams,
} from "./types.js";

// ─── Conversations ────────────────────────────────────────────────────────────

/**
 * Get or create a 1:1 conversation between two users.
 *
 * Idempotent: if a conversation already exists between the same pair,
 * the existing one is returned. The UNIQUE constraint on participant_hash
 * makes concurrent calls safe — the loser of a race gets the existing row.
 */
export async function getOrCreateConversation(
  db: Db,
  params: CreateConversationParams,
): Promise<ConversationDto> {
  const { initiatorId, recipientId } = params;

  if (initiatorId === recipientId) {
    throw new BadRequestError("You cannot start a conversation with yourself.");
  }

  const blocked = await isBlocked(db, initiatorId, recipientId);
  if (blocked) {
    throw new ForbiddenError("You cannot message this user.");
  }

  const hash = makeParticipantHash(initiatorId, recipientId);

  // Check for existing conversation first (fast path — avoids INSERT on every call)
  const existing = await findConversationByHash(db, hash);
  if (existing) {
    return buildConversationDto(db, existing.id, initiatorId);
  }

  // Create — a concurrent duplicate will hit the UNIQUE constraint and throw a
  // Postgres error; we catch it and fall back to fetching the existing row.
  try {
    const id = randomUUID();
    await createConversation(db, id, hash, initiatorId, recipientId);
    return buildConversationDto(db, id, initiatorId);
  } catch (err: unknown) {
    // Unique violation (code 23505) — race condition; return the winner's row
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      const winner = await findConversationByHash(db, hash);
      if (winner) return buildConversationDto(db, winner.id, initiatorId);
    }
    throw err;
  }
}

/** List paginated conversations for the calling user. */
export async function listConversations(
  db: Db,
  params: ListConversationsParams,
): Promise<{ items: ConversationDto[]; page: number; pageSize: number; total: number }> {
  const { rows, total } = await listConversationsForUser(db, params);

  const dtos = await Promise.all(rows.map((r) => buildConversationDto(db, r.id, params.userId)));

  return { items: dtos, page: params.page, pageSize: params.pageSize, total };
}

/** Get a single conversation — verifies caller is a participant. */
export async function getConversation(
  db: Db,
  conversationId: string,
  callerId: string,
): Promise<ConversationDto> {
  await assertParticipant(db, conversationId, callerId);
  return buildConversationDto(db, conversationId, callerId);
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** Send a message. Publishes to PubSub for SSE delivery. */
export async function sendMessage(
  db: Db,
  pubsub: PubSub,
  params: SendMessageParams,
): Promise<MessageDto> {
  const { conversationId, senderId, body } = params;

  validateMessageBody(body);

  await assertParticipant(db, conversationId, senderId);

  // Check that no participant has blocked the sender (bidirectional)
  const participants = await loadParticipants(db, [conversationId]);
  const otherIds = participants.filter((p) => p.userId !== senderId).map((p) => p.userId);

  for (const otherId of otherIds) {
    if (await isBlocked(db, senderId, otherId)) {
      throw new ForbiddenError("You cannot send messages to this conversation.");
    }
  }

  const id = randomUUID();
  const row = await insertMessage(db, id, conversationId, senderId, body);
  const dto = toMessageDto(row);

  // Publish to SSE subscribers — non-blocking; subscriber errors do not fail the request
  pubsub.publish(conversationId, {
    conversationId,
    messageId: dto.id,
    senderId: dto.senderId,
    body: dto.body,
    createdAt: dto.createdAt,
  });

  return dto;
}

/** List messages in a conversation with cursor pagination. */
export async function listMessages(
  db: Db,
  params: ListMessagesParams,
  callerId: string,
): Promise<MessageDto[]> {
  await assertParticipant(db, params.conversationId, callerId);

  const rows = await repoListMessages(db, params);
  await markConversationRead(db, params.conversationId, callerId);

  return rows.map(toMessageDto);
}

/** Edit a message body. Only the sender may edit; cannot edit deleted messages. */
export async function editMessage(db: Db, params: EditMessageParams): Promise<MessageDto> {
  validateMessageBody(params.body);

  const existing = await getMessageById(db, params.messageId);
  if (!existing) throw new NotFoundError("Message");

  if (existing.senderId !== params.editorId) {
    throw new ForbiddenError("You can only edit your own messages.");
  }
  if (existing.deletedAt !== null) {
    throw new BadRequestError("Cannot edit a deleted message.");
  }

  const updated = await repoEditMessage(db, params.messageId, params.body);
  if (!updated) throw new NotFoundError("Message");
  return toMessageDto(updated);
}

/** Soft-delete a message. Only the sender may delete. */
export async function deleteMessage(db: Db, params: DeleteMessageParams): Promise<MessageDto> {
  const existing = await getMessageById(db, params.messageId);
  if (!existing) throw new NotFoundError("Message");

  if (existing.senderId !== params.deleterId) {
    throw new ForbiddenError("You can only delete your own messages.");
  }
  if (existing.deletedAt !== null) {
    throw new BadRequestError("Message is already deleted.");
  }

  const updated = await softDeleteMessage(db, params.messageId);
  if (!updated) throw new NotFoundError("Message");
  return toMessageDto(updated);
}

// ─── Moderation ───────────────────────────────────────────────────────────────

/** Report a message. Returns the submitted report's ID. */
export async function reportMessage(
  db: Db,
  params: ReportMessageParams,
): Promise<{ reportId: string }> {
  const msg = await getMessageById(db, params.messageId);
  if (!msg) throw new NotFoundError("Message");

  if (msg.senderId === params.reporterId) {
    throw new BadRequestError("You cannot report your own message.");
  }

  // Verify the reporter is a participant in that conversation
  await assertParticipant(db, msg.conversationId, params.reporterId);

  const id = randomUUID();
  const created = await insertMessageReport(
    db,
    id,
    params.messageId,
    params.reporterId,
    params.reason,
  );
  if (!created) {
    throw new ConflictError("You have already reported this message.");
  }
  return { reportId: id };
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

/** Block a user. Idempotent — blocking an already-blocked user is a no-op. */
export async function blockUser(db: Db, params: BlockUserParams): Promise<void> {
  if (params.blockerId === params.blockedId) {
    throw new BadRequestError("You cannot block yourself.");
  }
  await insertBlock(db, params.blockerId, params.blockedId);
}

/** Unblock a user. Returns false if the block did not exist. */
export async function unblockUser(db: Db, params: BlockUserParams): Promise<void> {
  const removed = await deleteBlock(db, params.blockerId, params.blockedId);
  if (!removed) {
    throw new NotFoundError("Block");
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function assertParticipant(db: Db, conversationId: string, userId: string): Promise<void> {
  const conv = await getConversationById(db, conversationId);
  if (!conv) throw new NotFoundError("Conversation");

  const member = await isParticipant(db, conversationId, userId);
  if (!member) throw new ForbiddenError("You are not a participant in this conversation.");
}

async function buildConversationDto(
  db: Db,
  conversationId: string,
  callerId: string,
): Promise<ConversationDto> {
  const conv = await getConversationById(db, conversationId);
  if (!conv) throw new NotFoundError("Conversation");

  const [participantRows, lastMsgRow] = await Promise.all([
    loadParticipants(db, [conversationId]),
    getLastMessage(db, conversationId),
  ]);

  const callerRow = participantRows.find((p) => p.userId === callerId);
  const unreadCount = await countUnread(db, conversationId, callerRow?.lastReadAt ?? null);

  return {
    id: conv.id,
    participants: participantRows.map(toParticipantDto),
    lastMessage: lastMsgRow ? toMessageDto(lastMsgRow) : null,
    unreadCount,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
  };
}

function validateMessageBody(body: string): void {
  if (!body || body.trim().length === 0) {
    throw new BadRequestError("Message body cannot be empty.");
  }
  if (body.length > 4000) {
    throw new BadRequestError("Message body cannot exceed 4 000 characters.", {
      maxLength: 4000,
      received: body.length,
    });
  }
}
