-- Phase 7: constraint statements of prisma/constraints.active.sql that became active with the payment and refund tables.
-- Hand-written migration applied after 20260925210000_phase7_payments.

ALTER TABLE refunds ADD CONSTRAINT refunds_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE payments ADD CONSTRAINT payments_outcome_recorded CHECK (
  (status <> 'SUCCEEDED' OR provider = 'cod' OR "succeededAt" IS NOT NULL) AND
  (status NOT IN ('FAILED', 'EXPIRED') OR "failedAt" IS NOT NULL)
);

ALTER TABLE refunds ADD CONSTRAINT refunds_manual_reference CHECK (
  "paymentId" IS NOT NULL OR status <> 'SUCCEEDED' OR "manualReference" IS NOT NULL
);

ALTER TABLE refunds ADD CONSTRAINT refunds_review_recorded CHECK (
  (status <> 'REJECTED' OR ("rejectionReason" IS NOT NULL AND "approvedById" IS NOT NULL))
);

ALTER TABLE refunds ADD CONSTRAINT refunds_attempts_nonneg CHECK (attempts >= 0);
