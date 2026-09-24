-- GENERATED FILE — do not edit by hand. Source: prisma/constraints.sql filtered to active tables.
-- Applied as a hand-written migration after the generated Prisma migration.


ALTER TABLE products ADD CONSTRAINT products_base_price_nonneg CHECK ("basePricePaise" >= 0);

ALTER TABLE product_variants ADD CONSTRAINT product_variants_price_nonneg CHECK ("basePricePaise" >= 0);

ALTER TABLE product_addons ADD CONSTRAINT product_addons_price_nonneg CHECK ("basePricePaise" >= 0);

ALTER TABLE restaurant_business_hours ADD CONSTRAINT rbh_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);

ALTER TABLE product_schedules ADD CONSTRAINT ps_day_range CHECK ("dayOfWeek" BETWEEN 0 AND 6);

ALTER TABLE product_addon_groups ADD CONSTRAINT pag_select_range CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect");

ALTER TABLE service_areas ADD CONSTRAINT service_area_shape CHECK (
  (kind = 'POLYGON' AND geometry IS NOT NULL) OR
  (kind = 'RADIUS' AND "centerLat" IS NOT NULL AND "centerLng" IS NOT NULL AND "radiusM" > 0)
);


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
