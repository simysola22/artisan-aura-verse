/**
 * Stage 7 — Messaging
 *
 * Tables:
 *   conversations          — a thread between two or more participants
 *   conversation_participants — m2m: user ↔ conversation (with unread tracking)
 *   messages               — individual messages within a conversation
 *   message_reports        — user-submitted moderation reports on messages
 *   user_blocks            — directional user-block relationships
 *
 * Architectural decisions (documented):
 *
 *   1. participant_hash
 *      For 1:1 conversations, participant_hash = sorted_user_id_a + ':' + sorted_user_id_b.
 *      A UNIQUE constraint prevents duplicate direct conversations at the DB level,
 *      making concurrent conversation-creation race conditions safe.
 *      Future group conversations leave participant_hash null.
 *
 *   2. Soft deletes on messages
 *      deleted_at is set instead of a physical row delete. The body is
 *      replaced with a placeholder in the DTO layer; the row is preserved for
 *      audit and moderation purposes.
 *
 *   3. Moderation states
 *      Conversations and messages carry independent moderation_status columns.
 *      The moderation_team (Stage 9) will read/write these. Stage 7 exposes
 *      only the 'report' action for users; actual hide/remove is ops-only.
 *
 *   4. Blocks are directional
 *      blocker_id → blocked_id. A bidirectional block requires two rows.
 *      The service layer checks both directions before allowing message sends.
 */

import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  primaryKey,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { sql } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const conversationModerationStatusEnum = pgEnum("conversation_moderation_status", [
  "active",
  "flagged",
  "closed",
]);

export const messageModerationStatusEnum = pgEnum("message_moderation_status", [
  "visible",
  "flagged",
  "hidden",
]);

// ─── conversations ────────────────────────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),

    /**
     * Deduplication key for 1:1 conversations.
     * Value: sorted(userId_a, userId_b).join(':')
     * NULL for future group conversations.
     * UNIQUE constraint prevents duplicate DMs at the DB level.
     */
    participantHash: text("participant_hash").unique(),

    /** Updated on every new message — drives "last activity" ordering. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    moderationStatus: conversationModerationStatusEnum("moderation_status")
      .notNull()
      .default("active"),
  },
  (t) => [index("conversations_updated_at_idx").on(t.updatedAt)],
);

// ─── conversation_participants ────────────────────────────────────────────────

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Tracks when this participant last read the conversation.
     * Used to compute unread message counts.
     * NULL means they have never read it.
     */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_participants_user_idx").on(t.userId),
    index("conversation_participants_conv_idx").on(t.conversationId),
  ],
);

// ─── messages ─────────────────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),

    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),

    /** The PMP user who sent this message. Set by the server from auth context. */
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Message body. Max 4000 characters enforced in the service layer. */
    body: text("body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** Set when the sender edits the message. */
    editedAt: timestamp("edited_at", { withTimezone: true }),

    /**
     * Soft delete timestamp. When set, body is replaced with a placeholder
     * in DTOs. Row is preserved for audit/moderation.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    moderationStatus: messageModerationStatusEnum("moderation_status").notNull().default("visible"),
  },
  (t) => [
    /** Primary query path: get messages in a conversation, newest first. */
    index("messages_conv_created_idx").on(t.conversationId, t.createdAt),
    index("messages_sender_idx").on(t.senderId),
    index("messages_moderation_idx").on(t.moderationStatus),
  ],
);

// ─── message_reports ──────────────────────────────────────────────────────────

export const messageReports = pgTable(
  "message_reports",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** User-supplied reason for the report. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One report per user per message. */
    unique("message_reports_unique_reporter").on(t.messageId, t.reporterId),
    index("message_reports_message_idx").on(t.messageId),
  ],
);

// ─── user_blocks ──────────────────────────────────────────────────────────────

export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("user_blocks_blocked_idx").on(t.blockedId),
    /** Prevent self-blocks at the DB level. */
    check("user_blocks_no_self_block", sql`${t.blockerId} != ${t.blockedId}`),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageReport = typeof messageReports.$inferSelect;
export type NewMessageReport = typeof messageReports.$inferInsert;
export type UserBlock = typeof userBlocks.$inferSelect;
export type NewUserBlock = typeof userBlocks.$inferInsert;

export type ConversationModerationStatus =
  (typeof conversationModerationStatusEnum.enumValues)[number];
export type MessageModerationStatus = (typeof messageModerationStatusEnum.enumValues)[number];
