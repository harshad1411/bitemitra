-- Phase 5: constraint statements of prisma/constraints.active.sql that became active with the order tables.
-- Hand-written migration applied after 20260925150000_phase5_orders.

CREATE UNIQUE INDEX coupon_usages_live_per_order
  ON coupon_usages ("orderId")
  WHERE "reversedAt" IS NULL;

ALTER TABLE order_items ADD CONSTRAINT order_items_qty_pos CHECK (quantity > 0);

ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg CHECK ("totalPayablePaise" >= 0);

ALTER TABLE orders ADD CONSTRAINT orders_cod_within_total CHECK ("codAmountPaise" >= 0 AND "codAmountPaise" <= "totalPayablePaise");

CREATE UNIQUE INDEX cancellation_rules_open_version
  ON cancellation_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;

ALTER TABLE cancellation_rules ADD CONSTRAINT cancellation_rules_window CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE cancellation_rules ADD CONSTRAINT cancellation_rules_target CHECK ((scope = 'GLOBAL') = ("scopeRefId" IS NULL));

ALTER TABLE coupons ADD CONSTRAINT coupons_used_within_limit CHECK ("usageLimit" IS NULL OR "usedCount" <= "usageLimit");

ALTER TABLE coupon_usages ADD CONSTRAINT coupon_usages_discount_nonneg CHECK ("discountPaise" >= 0);

ALTER TABLE orders ADD CONSTRAINT orders_counts_valid CHECK ("itemCount" > 0 AND version >= 0);

ALTER TABLE orders ADD CONSTRAINT orders_prep_time_range CHECK ("prepTimeMinutes" IS NULL OR "prepTimeMinutes" BETWEEN 1 AND 240);

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
