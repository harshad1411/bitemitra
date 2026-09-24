-- GENERATED FILE — do not edit by hand. Source: prisma/constraints.sql filtered to active tables.
-- Applied as a hand-written migration after the generated Prisma migration.

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
