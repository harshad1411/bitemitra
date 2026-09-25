-- Phase 8: constraint statements of prisma/constraints.active.sql that became active with the ledger and settlement tables.
-- Hand-written migration applied after 20260925230000_phase8_ledgers.

ALTER TABLE restaurant_ledger_entries ADD CONSTRAINT rle_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE rider_ledger_entries ADD CONSTRAINT rider_le_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE platform_ledger_entries ADD CONSTRAINT platform_le_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE rider_cod_deposits ADD CONSTRAINT cod_deposit_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE restaurant_settlements ADD CONSTRAINT restaurant_settlements_paid_recorded CHECK (
  status <> 'PAID' OR ("payoutReference" IS NOT NULL AND "paidAt" IS NOT NULL AND "approvedById" IS NOT NULL)
);

ALTER TABLE rider_settlements ADD CONSTRAINT rider_settlements_paid_recorded CHECK (
  status <> 'PAID' OR ("payoutReference" IS NOT NULL AND "paidAt" IS NOT NULL AND "approvedById" IS NOT NULL)
);

ALTER TABLE rider_payouts ADD CONSTRAINT rider_payouts_amount_pos CHECK ("amountPaise" > 0);

ALTER TABLE rider_cod_deposits ADD CONSTRAINT rider_cod_deposits_valid CHECK (
  status IN ('PENDING', 'VERIFIED', 'REJECTED') AND
  method IN ('CASH_AT_HUB', 'BANK_DEPOSIT', 'UPI') AND
  "reportedBy" IN ('RIDER', 'ADMIN') AND
  (status <> 'VERIFIED' OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL)) AND
  (status <> 'REJECTED' OR note IS NOT NULL)
);

CREATE OR REPLACE FUNCTION jamzo_ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'settlementId') IS DISTINCT FROM (to_jsonb(OLD) - 'settlementId') THEN RAISE EXCEPTION 'ledger entries are append-only' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END $$;

CREATE TRIGGER restaurant_ledger_entries_append_only BEFORE UPDATE OR DELETE ON restaurant_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION jamzo_ledger_entry_guard();

CREATE TRIGGER rider_ledger_entries_append_only BEFORE UPDATE OR DELETE ON rider_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION jamzo_ledger_entry_guard();

CREATE TRIGGER platform_ledger_entries_append_only BEFORE UPDATE OR DELETE ON platform_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION jamzo_ledger_entry_guard();
