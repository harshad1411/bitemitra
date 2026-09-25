-- Phase 9: constraint statements of prisma/constraints.active.sql that became active with the support tables.
-- Hand-written migration applied after 20260926010000_phase9_support.

ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_resolution_recorded CHECK (
  status NOT IN ('RESOLVED', 'CLOSED') OR (resolution IS NOT NULL AND "resolvedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX support_tickets_one_open_per_order_issue
  ON support_tickets ("orderId", "issueType")
  WHERE "orderId" IS NOT NULL AND status NOT IN ('RESOLVED', 'CLOSED');

ALTER TABLE support_ticket_messages ADD CONSTRAINT support_ticket_messages_body_present CHECK (length(trim(body)) > 0);
