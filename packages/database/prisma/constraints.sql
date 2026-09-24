-- Constraints Prisma's schema language cannot express. Applied as a hand-written
-- migration immediately after the generated one (Phase 1). Each one backs a guarantee
-- in MASTER_SPEC §68/§69 or a money invariant; see docs/DATABASE.md.

-- ── Concurrency guarantees (spec §69) ─────────────────────────────────────────

-- Two riders can never both hold an accepted assignment for the same order.
CREATE UNIQUE INDEX order_assignments_one_active_per_order
  ON order_assignments ("orderId")
  WHERE status IN ('ACCEPTED', 'COMPLETED');

-- A rider may have only one outstanding offer for a given order.
CREATE UNIQUE INDEX order_assignments_one_offer_per_rider_order
  ON order_assignments ("orderId", "riderId")
  WHERE status = 'OFFERED';

-- At most one successful online payment per order (a second capture must be refunded, not recorded as paid).
CREATE UNIQUE INDEX payments_one_success_per_order
  ON payments ("orderId")
  WHERE status = 'SUCCEEDED';

-- One live coupon usage per order.
CREATE UNIQUE INDEX coupon_usages_live_per_order
  ON coupon_usages ("orderId")
  WHERE "reversedAt" IS NULL;

-- Only one open (non-superseded) version per rule target at a time.
CREATE UNIQUE INDEX markup_rules_open_version
  ON markup_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX commission_rules_open_version
  ON commission_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;

-- ── Money invariants ──────────────────────────────────────────────────────────

ALTER TABLE products ADD CONSTRAINT products_base_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE product_addons ADD CONSTRAINT product_addons_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_qty_pos CHECK (quantity > 0);
ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg CHECK ("totalPayablePaise" >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_cod_within_total CHECK ("codAmountPaise" >= 0 AND "codAmountPaise" <= "totalPayablePaise");
ALTER TABLE payments ADD CONSTRAINT payments_amounts_valid
  CHECK ("amountPaise" >= 0 AND "capturedPaise" >= 0 AND "refundedPaise" >= 0 AND "refundedPaise" <= "capturedPaise");
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_pos CHECK ("amountPaise" > 0);
ALTER TABLE restaurant_ledger_entries ADD CONSTRAINT rle_amount_pos CHECK ("amountPaise" > 0);
ALTER TABLE rider_ledger_entries ADD CONSTRAINT rider_le_amount_pos CHECK ("amountPaise" > 0);
ALTER TABLE platform_ledger_entries ADD CONSTRAINT platform_le_amount_pos CHECK ("amountPaise" > 0);
ALTER TABLE rider_cod_deposits ADD CONSTRAINT cod_deposit_amount_pos CHECK ("amountPaise" > 0);
ALTER TABLE coupons ADD CONSTRAINT coupons_value_present CHECK (
  ("discountType" = 'PERCENTAGE' AND "valueBps" BETWEEN 1 AND 10000) OR
  ("discountType" = 'FIXED' AND "valuePaise" > 0) OR
  ("discountType" = 'FREE_DELIVERY')
);
ALTER TABLE coupons ADD CONSTRAINT coupons_shared_split CHECK (
  "fundingSource" <> 'SHARED' OR "restaurantShareBps" BETWEEN 0 AND 10000
);

-- ── Data sanity ───────────────────────────────────────────────────────────────

ALTER TABLE reviews ADD CONSTRAINT reviews_food_rating_range CHECK ("foodRating" BETWEEN 1 AND 5);
ALTER TABLE reviews ADD CONSTRAINT reviews_delivery_rating_range CHECK ("deliveryRating" IS NULL OR "deliveryRating" BETWEEN 1 AND 5);
ALTER TABLE restaurant_business_hours ADD CONSTRAINT rbh_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE product_schedules ADD CONSTRAINT ps_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE product_addon_groups ADD CONSTRAINT pag_select_range CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect");
ALTER TABLE service_areas ADD CONSTRAINT service_area_shape CHECK (
  (kind = 'POLYGON' AND geometry IS NOT NULL) OR
  (kind = 'RADIUS' AND "centerLat" IS NOT NULL AND "centerLng" IS NOT NULL AND "radiusM" > 0)
);
