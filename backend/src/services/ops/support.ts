/**
 * Support ticket service — Stage 9.
 *
 * Any authenticated user can create a ticket.
 * Staff (support.read / support.respond) can list all tickets, respond, and
 * close them. Staff with support.manage can assign tickets to agents.
 *
 * Security invariants:
 *   - Internal messages (is_internal = true) are only visible to staff.
 *   - Ticket submitters can only see their own tickets and non-internal messages.
 *   - Closed tickets are immutable.
 */

import { eq, and, desc } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  supportTickets,
  supportTicketMessages,
  users,
  type SupportTicketStatus,
  type SupportTicketCategory,
  type SupportTicketPriority,
} from "../../db/schema/index.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors/index.js";
import { appendOpsAudit, type AuditContext } from "./audit.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadTicket(db: Db, ticketId: string) {
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!ticket) throw new NotFoundError("Support ticket");
  return ticket;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateTicketParams {
  title: string;
  description: string;
  category: SupportTicketCategory;
  priority?: SupportTicketPriority;
}

export async function createTicket(
  db: Db,
  submittedBy: string,
  params: CreateTicketParams,
  auditContext?: AuditContext,
) {
  const id = crypto.randomUUID();

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      id,
      title: params.title,
      description: params.description,
      category: params.category,
      priority: params.priority ?? "medium",
      submittedBy,
    })
    .returning();

  if (!ticket) throw new Error("Failed to create support ticket");

  await appendOpsAudit(db, {
    actorId: submittedBy,
    action: "support_ticket_created",
    entityType: "support_ticket",
    entityId: id,
    metadata: { category: params.category, priority: params.priority ?? "medium" },
    ...auditContext,
  });

  return ticket;
}

// ─── List (staff) ─────────────────────────────────────────────────────────────

export interface ListTicketsParams {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

export async function listTickets(db: Db, params: ListTicketsParams = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions = [];
  if (params.status !== undefined) {
    conditions.push(eq(supportTickets.status, params.status));
  }
  if (params.category !== undefined) {
    conditions.push(eq(supportTickets.category, params.category));
  }
  if (params.assignedTo !== undefined) {
    conditions.push(eq(supportTickets.assignedTo, params.assignedTo));
  }

  return db
    .select()
    .from(supportTickets)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supportTickets.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getOwnTickets(db: Db, userId: string) {
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.submittedBy, userId))
    .orderBy(desc(supportTickets.createdAt));
}

// ─── View ─────────────────────────────────────────────────────────────────────

/**
 * Get a ticket with its messages.
 *
 * @param isStaff  When false, internal messages are filtered out (caller is submitter).
 */
export async function getTicket(db: Db, ticketId: string, requesterId: string, isStaff: boolean) {
  const ticket = await loadTicket(db, ticketId);

  // Non-staff can only view their own tickets
  if (!isStaff && ticket.submittedBy !== requesterId) {
    throw new ForbiddenError("You can only view your own support tickets.");
  }

  const conditions: ReturnType<typeof eq>[] = [eq(supportTicketMessages.ticketId, ticketId)];
  if (!isStaff) {
    conditions.push(eq(supportTicketMessages.isInternal, false));
  }

  const messages = await db
    .select({
      id: supportTicketMessages.id,
      authorId: supportTicketMessages.authorId,
      content: supportTicketMessages.content,
      isInternal: supportTicketMessages.isInternal,
      createdAt: supportTicketMessages.createdAt,
    })
    .from(supportTicketMessages)
    .where(and(...conditions))
    .orderBy(supportTicketMessages.createdAt);

  return { ticket, messages };
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function addMessage(
  db: Db,
  ticketId: string,
  authorId: string,
  content: string,
  isInternal: boolean,
  isStaff: boolean,
) {
  const ticket = await loadTicket(db, ticketId);

  if (ticket.status === "closed") {
    throw new BadRequestError("Cannot add messages to a closed ticket.");
  }

  // Non-staff can only message on their own tickets
  if (!isStaff && ticket.submittedBy !== authorId) {
    throw new ForbiddenError("You can only reply to your own support tickets.");
  }

  // Only staff can post internal messages
  if (isInternal && !isStaff) {
    throw new ForbiddenError("Internal messages can only be posted by support staff.");
  }

  const [message] = await db
    .insert(supportTicketMessages)
    .values({
      id: crypto.randomUUID(),
      ticketId,
      authorId,
      content,
      isInternal,
    })
    .returning();

  if (!message) throw new Error("Failed to create message");

  // Reopen if resolved when user replies
  if (!isStaff && ticket.status === "resolved") {
    await db
      .update(supportTickets)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));
  }

  return message;
}

// ─── Assign ───────────────────────────────────────────────────────────────────

export async function assignTicket(
  db: Db,
  ticketId: string,
  assigneeId: string,
  actorId: string,
  auditContext?: AuditContext,
) {
  const ticket = await loadTicket(db, ticketId);

  if (ticket.status === "closed") {
    throw new BadRequestError("Cannot assign a closed ticket.");
  }

  // Verify assignee exists
  const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId)).limit(1);
  if (!assignee) throw new NotFoundError("Assignee user");

  const [updated] = await db
    .update(supportTickets)
    .set({
      assignedTo: assigneeId,
      status: "assigned",
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, ticketId))
    .returning();

  if (!updated) throw new Error("Failed to assign ticket");

  await appendOpsAudit(db, {
    actorId,
    action: "support_ticket_assigned",
    entityType: "support_ticket",
    entityId: ticketId,
    metadata: { assigneeId },
    ...auditContext,
  });

  return updated;
}

// ─── Close / resolve ──────────────────────────────────────────────────────────

export async function closeTicket(
  db: Db,
  ticketId: string,
  actorId: string,
  resolution: "resolved" | "closed" = "resolved",
  auditContext?: AuditContext,
) {
  const ticket = await loadTicket(db, ticketId);

  if (ticket.status === "closed") {
    throw new ConflictError("Ticket is already closed.");
  }

  const [updated] = await db
    .update(supportTickets)
    .set({
      status: resolution,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, ticketId))
    .returning();

  if (!updated) throw new Error("Failed to close ticket");

  await appendOpsAudit(db, {
    actorId,
    action: "support_ticket_closed",
    entityType: "support_ticket",
    entityId: ticketId,
    metadata: { resolution },
    ...auditContext,
  });

  return updated;
}
