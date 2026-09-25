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

-- ── Phase 1 tables ────────────────────────────────────────────────────────────

-- UNIQUE(key, scope, scopeRefId) does not stop two GLOBAL rows, because NULLs are distinct in
-- PostgreSQL unique constraints. One inherited default per key:
CREATE UNIQUE INDEX settings_one_unscoped_per_key
  ON settings (key, scope)
  WHERE "scopeRefId" IS NULL;

ALTER TABLE settings ADD CONSTRAINT settings_scope_ref_present CHECK (
  (scope = 'GLOBAL' AND "scopeRefId" IS NULL) OR (scope <> 'GLOBAL' AND "scopeRefId" IS NOT NULL)
);
ALTER TABLE cities ADD CONSTRAINT cities_center_range CHECK (
  "centerLat" BETWEEN -90 AND 90 AND "centerLng" BETWEEN -180 AND 180
);
ALTER TABLE zones ADD CONSTRAINT zones_bbox_valid CHECK ("minLat" <= "maxLat" AND "minLng" <= "maxLng");
ALTER TABLE otp_challenges ADD CONSTRAINT otp_attempts_valid CHECK (attempts >= 0 AND "maxAttempts" > 0);
ALTER TABLE media ADD CONSTRAINT media_size_nonneg CHECK ("sizeBytes" >= 0);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_attempts_nonneg CHECK (attempts >= 0);

-- ── Phase 2 tables (restaurants & menus — docs/RESTAURANTS.md) ────────────────

-- One primary branch per restaurant, one default variant per product, one primary bank account
-- (only a verified account may be primary — D-35) and one active delivery area per branch (D-41).
CREATE UNIQUE INDEX restaurant_branches_one_primary
  ON restaurant_branches ("restaurantId")
  WHERE "isPrimary";
CREATE UNIQUE INDEX product_variants_one_default
  ON product_variants ("productId")
  WHERE "isDefault";
CREATE UNIQUE INDEX restaurant_bank_accounts_one_primary
  ON restaurant_bank_accounts ("restaurantId")
  WHERE "isPrimary";
CREATE UNIQUE INDEX branch_delivery_areas_one_active
  ON branch_delivery_areas ("branchId")
  WHERE "isActive";
-- Menu section names are unique within a restaurant, ignoring case.
CREATE UNIQUE INDEX menu_categories_name_per_restaurant
  ON menu_categories ("restaurantId", lower(name));

ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_primary_verified CHECK (NOT "isPrimary" OR "verifiedAt" IS NOT NULL);
ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_last4_format CHECK ("accountNumberLast4" ~ '^[0-9]{4}$');
ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_ifsc_format CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
ALTER TABLE restaurant_branches ADD CONSTRAINT branches_prep_time_range CHECK ("prepTimeMinutes" BETWEEN 1 AND 240);
ALTER TABLE restaurant_branches ADD CONSTRAINT branches_location_range CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
-- "HH:mm" local times; a closing time may be 24:00 (end of day) and may be earlier than the opening time
-- (past midnight), but never equal to it.
ALTER TABLE restaurant_business_hours ADD CONSTRAINT rbh_time_format CHECK (
  "opensAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "closesAt" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' AND
  "opensAt" <> "closesAt"
);
ALTER TABLE product_schedules ADD CONSTRAINT ps_time_format CHECK (
  "startsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "endsAt" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' AND
  "startsAt" <> "endsAt"
);
ALTER TABLE branch_delivery_areas ADD CONSTRAINT bda_shape CHECK (
  (kind = 'RADIUS' AND "radiusM" BETWEEN 100 AND 50000) OR
  (kind = 'POLYGON' AND geometry IS NOT NULL)
);
ALTER TABLE products ADD CONSTRAINT products_packaging_nonneg CHECK ("packagingChargePaise" IS NULL OR "packagingChargePaise" >= 0);
ALTER TABLE products ADD CONSTRAINT products_stock_nonneg CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0);
ALTER TABLE products ADD CONSTRAINT products_prep_time_range CHECK ("prepTimeMinutes" IS NULL OR "prepTimeMinutes" BETWEEN 1 AND 240);
ALTER TABLE product_addon_groups ADD CONSTRAINT pag_max_positive CHECK ("maxSelect" >= 1);
ALTER TABLE product_availability ADD CONSTRAINT pa_window_valid CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- ── Phases 3 + 4 tables (customer discovery, pricing — docs/PRICING.md, DECISIONS D-50) ─────────

-- One open (non-superseded) version per rule target. Markup and commission are above; tax rules also
-- key on the charge they apply to (and the withholding kind), surge rules on their kind.
CREATE UNIQUE INDEX tax_rules_open_version
  ON tax_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority, (params->>'appliesTo'), COALESCE(params->>'kind', ''))
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX platform_fee_rules_open_version
  ON platform_fee_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX delivery_pricing_rules_open_version
  ON delivery_pricing_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX surge_rules_open_version
  ON surge_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority, kind)
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX rider_earning_rules_open_version
  ON rider_earning_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;

-- A version ends after it starts; GLOBAL rules have no target, every other scope has one.
ALTER TABLE markup_rules ADD CONSTRAINT markup_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE markup_rules ADD CONSTRAINT markup_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_applies_to CHECK (params->>'appliesTo' IS NOT NULL);
ALTER TABLE platform_fee_rules ADD CONSTRAINT platform_fee_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE platform_fee_rules ADD CONSTRAINT platform_fee_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE delivery_pricing_rules ADD CONSTRAINT delivery_pricing_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE delivery_pricing_rules ADD CONSTRAINT delivery_pricing_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE surge_rules ADD CONSTRAINT surge_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE surge_rules ADD CONSTRAINT surge_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));
ALTER TABLE surge_rules ADD CONSTRAINT surge_rules_kind CHECK (kind IN ('NIGHT', 'DEMAND', 'WEATHER', 'MANUAL'));
ALTER TABLE rider_earning_rules ADD CONSTRAINT rider_earning_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE rider_earning_rules ADD CONSTRAINT rider_earning_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));

-- Coupons and promotions: codes are upper case; values make sense for the discount type; windows are valid.
ALTER TABLE coupons ADD CONSTRAINT coupons_code_upper CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,20}$');
ALTER TABLE coupons ADD CONSTRAINT coupons_window CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE coupons ADD CONSTRAINT coupons_limits_positive CHECK (("usageLimit" IS NULL OR "usageLimit" > 0) AND ("perUserLimit" IS NULL OR "perUserLimit" > 0) AND "usedCount" >= 0);
ALTER TABLE promotions ADD CONSTRAINT promotions_value_present CHECK (
  ("discountType" = 'PERCENTAGE' AND "valueBps" BETWEEN 1 AND 10000) OR
  ("discountType" = 'FIXED' AND "valuePaise" > 0) OR
  ("discountType" = 'FREE_DELIVERY')
);
ALTER TABLE promotions ADD CONSTRAINT promotions_shared_split CHECK (
  "fundingSource" <> 'SHARED' OR "restaurantShareBps" BETWEEN 0 AND 10000
);
ALTER TABLE promotions ADD CONSTRAINT promotions_window CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_location CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
ALTER TABLE home_sections ADD CONSTRAINT home_sections_window CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE banners ADD CONSTRAINT banners_window CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");

-- ── Phase 5: orders ───────────────────────────────────────────────────────────

-- One open version per cancellation-rule target (D-50, D-66).
CREATE UNIQUE INDEX cancellation_rules_open_version
  ON cancellation_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
ALTER TABLE cancellation_rules ADD CONSTRAINT cancellation_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE cancellation_rules ADD CONSTRAINT cancellation_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));

-- The last use of a limited coupon can be taken only once (D-65).
ALTER TABLE coupons ADD CONSTRAINT coupons_used_within_limit CHECK ("usageLimit" IS NULL OR "usedCount" <= "usageLimit");
ALTER TABLE coupon_usages ADD CONSTRAINT coupon_usages_discount_nonneg CHECK ("discountPaise" >= 0);

ALTER TABLE orders ADD CONSTRAINT orders_counts_valid CHECK ("itemCount" > 0 AND version >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_prep_time_range CHECK ("prepTimeMinutes" IS NULL OR "prepTimeMinutes" BETWEEN 1 AND 240);
-- An accepted kitchen always has a preparation time; a cancelled or failed order always has its time.
ALTER TABLE orders ADD CONSTRAINT orders_accepted_has_prep_time CHECK (
  "restaurantStatus" NOT IN ('ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP') OR "prepTimeMinutes" IS NOT NULL
);
ALTER TABLE orders ADD CONSTRAINT orders_cancelled_has_time CHECK (
  status NOT IN ('CUSTOMER_CANCELLED', 'RESTAURANT_CANCELLED', 'RESTAURANT_REJECTED', 'RIDER_ISSUE', 'ADMIN_CANCELLED', 'PAYMENT_FAILED')
  OR "cancelledAt" IS NOT NULL
);
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_amounts CHECK (
  ("paymentMethod" = 'COD' AND "codAmountPaise" = "totalPayablePaise") OR ("paymentMethod" <> 'COD' AND "codAmountPaise" = 0)
);
ALTER TABLE order_items ADD CONSTRAINT order_items_money_nonneg CHECK (
  "restaurantBasePricePaise" >= 0 AND "customerDisplayPricePaise" >= 0 AND "lineTotalPaise" >= 0
  AND "taxAmountPaise" >= 0 AND "commissionAmountPaise" >= 0 AND "packagingPaise" >= 0
);
ALTER TABLE order_item_addons ADD CONSTRAINT order_item_addons_money_nonneg CHECK (
  "restaurantBasePricePaise" >= 0 AND "customerDisplayPricePaise" >= 0
);
ALTER TABLE order_pricing_snapshots ADD CONSTRAINT order_pricing_snapshots_totals_nonneg CHECK (
  "totalPayablePaise" >= 0 AND "customerFoodSubtotalPaise" >= 0 AND "restaurantBaseSubtotalPaise" >= 0
  AND "discountTotalPaise" >= 0 AND "tipPaise" >= 0
);
ALTER TABLE order_cancellations ADD CONSTRAINT order_cancellations_money_nonneg CHECK (
  "customerFeePaise" >= 0 AND "refundDuePaise" >= 0 AND "restaurantCompensationPaise" >= 0
  AND "riderCompensationPaise" >= 0 AND "platformLossPaise" >= 0
);
ALTER TABLE order_cancellations ADD CONSTRAINT order_cancellations_stage_valid CHECK (
  stage IN ('BEFORE_ACCEPT', 'AFTER_ACCEPT', 'AFTER_PREPARING', 'AFTER_PICKUP')
);
