-- Phase 6: constraint statements of prisma/constraints.active.sql that became active with the rider, dispatch and COD tables.
-- Hand-written migration applied after 20260925180000_phase6_riders.

CREATE UNIQUE INDEX order_assignments_one_active_per_order
  ON order_assignments ("orderId")
  WHERE status IN ('ACCEPTED', 'COMPLETED');

CREATE UNIQUE INDEX order_assignments_one_offer_per_rider_order
  ON order_assignments ("orderId", "riderId")
  WHERE status = 'OFFERED';

CREATE UNIQUE INDEX payments_one_success_per_order
  ON payments ("orderId")
  WHERE status = 'SUCCEEDED';

ALTER TABLE payments ADD CONSTRAINT payments_amounts_valid
  CHECK ("amountPaise" >= 0 AND "capturedPaise" >= 0 AND "refundedPaise" >= 0 AND "refundedPaise" <= "capturedPaise");

ALTER TABLE rider_availability ADD CONSTRAINT rider_availability_active_nonneg CHECK ("activeOrderCount" >= 0);

ALTER TABLE rider_availability ADD CONSTRAINT rider_availability_position_valid CHECK (
  ("lastLat" IS NULL) = ("lastLng" IS NULL)
  AND ("lastLat" IS NULL OR ("lastLat" BETWEEN -90 AND 90 AND "lastLng" BETWEEN -180 AND 180))
);

ALTER TABLE rider_locations ADD CONSTRAINT rider_locations_position_valid CHECK (
  lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
);

ALTER TABLE rider_documents ADD CONSTRAINT rider_documents_kind_valid CHECK (
  kind IN ('DRIVING_LICENCE', 'VEHICLE_RC', 'PAN', 'ID_PROOF', 'PHOTO', 'INSURANCE')
);

ALTER TABLE rider_earnings ADD CONSTRAINT rider_earnings_valid CHECK (
  "totalPaise" >= 0 AND kind IN ('DELIVERY', 'CANCELLED_TRIP')
);

ALTER TABLE rider_shifts ADD CONSTRAINT rider_shifts_window CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");

CREATE UNIQUE INDEX rider_shifts_one_open
  ON rider_shifts ("riderId")
  WHERE "endedAt" IS NULL;

ALTER TABLE order_assignments ADD CONSTRAINT order_assignments_offer_valid CHECK (
  (status = 'OFFERED' AND "respondedAt" IS NULL) OR status <> 'OFFERED'
);

ALTER TABLE payments ADD CONSTRAINT payments_cod_collection CHECK (
  provider <> 'cod' OR status <> 'SUCCEEDED' OR ("codCollectedById" IS NOT NULL AND "codCollectedAt" IS NOT NULL)
);
