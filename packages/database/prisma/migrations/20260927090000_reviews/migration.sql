-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "riderId" UUID,
    "foodRating" DECIMAL(3,2) NOT NULL,
    "deliveryRating" INTEGER,
    "comment" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "hiddenById" UUID,
    "hiddenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_items" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- CreateIndex
CREATE INDEX "reviews_restaurantId_createdAt_idx" ON "reviews"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_riderId_idx" ON "reviews"("riderId");

-- CreateIndex
CREATE INDEX "reviews_createdAt_idx" ON "reviews"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_items_orderItemId_key" ON "review_items"("orderItemId");

-- CreateIndex
CREATE INDEX "review_items_reviewId_idx" ON "review_items"("reviewId");

-- CreateIndex
CREATE INDEX "review_items_productId_idx" ON "review_items"("productId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

