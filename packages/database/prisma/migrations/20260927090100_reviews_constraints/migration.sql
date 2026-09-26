-- Ratings and reviews (D-110): constraint statements of prisma/constraints.active.sql that became active with
-- the reviews tables. Hand-written migration applied after 20260927090000_reviews.

ALTER TABLE reviews ADD CONSTRAINT reviews_food_rating_range CHECK ("foodRating" BETWEEN 1 AND 5);
ALTER TABLE review_items ADD CONSTRAINT review_items_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD CONSTRAINT reviews_hidden_reason CHECK (NOT "isHidden" OR "hiddenReason" IS NOT NULL);
ALTER TABLE reviews ADD CONSTRAINT reviews_delivery_rating_range CHECK ("deliveryRating" IS NULL OR "deliveryRating" BETWEEN 1 AND 5);
