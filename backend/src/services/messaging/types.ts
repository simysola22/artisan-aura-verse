/**
 * Messaging domain — DTOs and internal types.
 *
 * DTOs are what routes return to clients.
 * Internal types carry extra fields used only within the service/repository layer.
 *
 * Security invariant: internal DB rows are NEVER returned directly.
 * Every route must serialize through a DTO function.
 */

// ─── DTOs (returned to clients) ───────────────────────────────────────────────

export interface ParticipantDto {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  /** Empty string when the message has been deleted. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** True when the sender (or moderator) has soft-deleted the message. */
  isDeleted: boolean;
  /** Always 'sent' from the backend's perspective. */
  status: "sent";
}

export interface ConversationDto {
  id: string;
  participants: ParticipantDto[];
  /** Most recent visible message, or null if none yet. */
  lastMessage: MessageDto | null;
  /** Count of messages created after the caller's last_read_at. */
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Internal query result types ──────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  participantHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParticipantRow {
  conversationId: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  lastReadAt: Date | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  moderationStatus: string;
}

// ─── Service input types ──────────────────────────────────────────────────────

export interface CreateConversationParams {
  initiatorId: string;
  recipientId: string;
}

export interface SendMessageParams {
  conversationId: string;
  senderId: string;
  body: string;
}

export interface EditMessageParams {
  messageId: string;
  editorId: string;
  body: string;
}

export interface DeleteMessageParams {
  messageId: string;
  deleterId: string;
}

export interface ReportMessageParams {
  messageId: string;
  reporterId: string;
  reason: string;
}

export interface BlockUserParams {
  blockerId: string;
  blockedId: string;
}

export interface ListMessagesParams {
  conversationId: string;
  /** Cursor: return messages created before this ISO timestamp. */
  before?: string;
  limit: number;
}

export interface ListConversationsParams {
  userId: string;
  page: number;
  pageSize: number;
}

// ─── DTO serializers ──────────────────────────────────────────────────────────

export function toMessageDto(row: MessageRow): MessageDto {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: isDeleted ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    isDeleted,
    status: "sent",
  };
}

export function toParticipantDto(row: ParticipantRow): ParticipantDto {
  return {
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
  };
}
