/**
 * Ops API — support tickets, moderation reports, user management, audit log.
 *
 * All routes require authentication. Most require ops-specific permissions.
 *
 * Backend routes:
 *   GET    /v1/ops/support/tickets           List all tickets (support.read)
 *   GET    /v1/ops/support/tickets/mine      Own tickets (any auth user)
 *   GET    /v1/ops/support/tickets/:id       Ticket detail
 *   POST   /v1/ops/support/tickets           Create ticket
 *   POST   /v1/ops/support/tickets/:id/messages   Add message to ticket
 *   POST   /v1/ops/support/tickets/:id/assign     Assign ticket
 *   POST   /v1/ops/support/tickets/:id/close      Close ticket
 *
 *   GET    /v1/ops/moderation/reports        List reports (moderation.read)
 *   GET    /v1/ops/moderation/reports/:id    Report detail
 *   POST   /v1/ops/moderation/reports/:id/review  Mark under review
 *   POST   /v1/ops/moderation/reports/:id/action  Take action
 *
 *   GET    /v1/ops/overview                  Dashboard stats
 *   GET    /v1/ops/audit                     Audit log
 */

import { apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  category: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: TicketMessage[];
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  targetType: "user" | "message" | "job" | "profile";
  targetId: string;
  reason: string;
  details: string | null;
  status: "pending" | "under_review" | "action_taken" | "dismissed";
  createdAt: string;
  updatedAt: string;
  actions?: ModerationAction[];
}

export interface ModerationAction {
  id: string;
  reportId: string;
  operatorId: string;
  actionType: "warning" | "suspension" | "removal" | "dismissal";
  notes: string | null;
  createdAt: string;
}

export interface OpsOverview {
  verificationQueueSize: number;
  openReports: number;
  openTickets: number;
  recentSignups: number;
}

// ─── Support ──────────────────────────────────────────────────────────────────

export function listTickets(params?: {
  status?: string;
  priority?: string;
}): Promise<{ tickets: SupportTicket[] }> {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    : "";
  return apiFetch<{ tickets: SupportTicket[] }>(`/v1/ops/support/tickets${qs}`);
}

export function getTicket(id: string): Promise<{ ticket: SupportTicket }> {
  return apiFetch<{ ticket: SupportTicket }>(`/v1/ops/support/tickets/${id}`);
}

export function addTicketMessage(
  ticketId: string,
  body: string,
  isInternal = false,
): Promise<{ message: TicketMessage }> {
  return apiFetch<{ message: TicketMessage }>(
    `/v1/ops/support/tickets/${ticketId}/messages`,
    { method: "POST", body: { body, isInternal } },
  );
}

export function closeTicket(ticketId: string): Promise<{ ticket: SupportTicket }> {
  return apiFetch<{ ticket: SupportTicket }>(
    `/v1/ops/support/tickets/${ticketId}/close`,
    { method: "POST" },
  );
}

export function assignTicket(
  ticketId: string,
  assigneeId: string,
): Promise<{ ticket: SupportTicket }> {
  return apiFetch<{ ticket: SupportTicket }>(
    `/v1/ops/support/tickets/${ticketId}/assign`,
    { method: "POST", body: { assigneeId } },
  );
}

// ─── Moderation ───────────────────────────────────────────────────────────────

export function listReports(params?: {
  status?: string;
}): Promise<{ reports: ModerationReport[] }> {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    : "";
  return apiFetch<{ reports: ModerationReport[] }>(`/v1/ops/moderation/reports${qs}`);
}

export function getReport(id: string): Promise<{ report: ModerationReport }> {
  return apiFetch<{ report: ModerationReport }>(`/v1/ops/moderation/reports/${id}`);
}

export function reviewReport(reportId: string): Promise<{ report: ModerationReport }> {
  return apiFetch<{ report: ModerationReport }>(
    `/v1/ops/moderation/reports/${reportId}/review`,
    { method: "POST" },
  );
}

export function takeModerationAction(
  reportId: string,
  input: { actionType: string; notes?: string },
): Promise<{ action: ModerationAction }> {
  return apiFetch<{ action: ModerationAction }>(
    `/v1/ops/moderation/reports/${reportId}/action`,
    { method: "POST", body: input },
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface OpsUser {
  id: string;
  clerkUserId: string;
  accountType: string;
  status: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  roles?: string[];
}

export function listUsers(params?: {
  status?: string;
  accountType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ users: OpsUser[]; total: number }> {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : "";
  return apiFetch<{ users: OpsUser[]; total: number }>(`/v1/ops/users${qs}`);
}

export function getOpsUser(userId: string): Promise<{ user: OpsUser }> {
  return apiFetch<{ user: OpsUser }>(`/v1/ops/users/${userId}`);
}

export function suspendUser(userId: string, reason?: string): Promise<{ user: OpsUser }> {
  return apiFetch<{ user: OpsUser }>(`/v1/ops/users/${userId}/suspend`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

export function reactivateUser(userId: string): Promise<{ user: OpsUser }> {
  return apiFetch<{ user: OpsUser }>(`/v1/ops/users/${userId}/reactivate`, {
    method: "POST",
  });
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function getOverview(): Promise<OpsOverview> {
  return apiFetch<OpsOverview>("/v1/ops/overview");
}
