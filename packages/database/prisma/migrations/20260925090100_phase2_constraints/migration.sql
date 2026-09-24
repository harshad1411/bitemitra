-- Phase 2: the statements of prisma/constraints.active.sql that became active with the Phase 2 tables
-- (restaurants & menus). Hand-written migration applied after 20260925090000_phase2_catalog.

ALTER TABLE products ADD CONSTRAINT products_base_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE product_addons ADD CONSTRAINT product_addons_price_nonneg CHECK ("basePricePaise" >= 0);
ALTER TABLE restaurant_business_hours ADD CONSTRAINT rbh_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE product_schedules ADD CONSTRAINT ps_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE product_addon_groups ADD CONSTRAINT pag_select_range CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect");
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
CREATE UNIQUE INDEX menu_categories_name_per_restaurant
  ON menu_categories ("restaurantId", lower(name));
ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_primary_verified CHECK (NOT "isPrimary" OR "verifiedAt" IS NOT NULL);
ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_last4_format CHECK ("accountNumberLast4" ~ '^[0-9]{4}$');
ALTER TABLE restaurant_bank_accounts ADD CONSTRAINT rba_ifsc_format CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
ALTER TABLE restaurant_branches ADD CONSTRAINT branches_prep_time_range CHECK ("prepTimeMinutes" BETWEEN 1 AND 240);
ALTER TABLE restaurant_branches ADD CONSTRAINT branches_location_range CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
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
