-- Phases 3 + 4: constraint statements of prisma/constraints.active.sql that became active with the customer
-- discovery and pricing tables. Hand-written migration applied after 20260925120000_phase3_4_discovery_pricing.

CREATE UNIQUE INDEX markup_rules_open_version
  ON markup_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX commission_rules_open_version
  ON commission_rules (scope, COALESCE("scopeRefId", '00000000-0000-0000-0000-000000000000'), COALESCE("restaurantId", '00000000-0000-0000-0000-000000000000'), priority)
  WHERE "effectiveTo" IS NULL;
ALTER TABLE coupons ADD CONSTRAINT coupons_value_present CHECK (
  ("discountType" = 'PERCENTAGE' AND "valueBps" BETWEEN 1 AND 10000) OR
  ("discountType" = 'FIXED' AND "valuePaise" > 0) OR
  ("discountType" = 'FREE_DELIVERY')
);
ALTER TABLE coupons ADD CONSTRAINT coupons_shared_split CHECK (
  "fundingSource" <> 'SHARED' OR "restaurantShareBps" BETWEEN 0 AND 10000
);
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
