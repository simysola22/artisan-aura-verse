-- PMP — Audit support ticket messages
--
-- Add the operations audit action used for support-ticket replies and
-- internal staff notes. This migration is additive and preserves all
-- existing audit actions and data.

ALTER TYPE "ops_audit_action"
  ADD VALUE IF NOT EXISTS 'support_ticket_message_added';