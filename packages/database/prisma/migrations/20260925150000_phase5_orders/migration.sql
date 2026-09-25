-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PLACED', 'RESTAURANT_NOTIFIED', 'RESTAURANT_ACCEPTED', 'RESTAURANT_REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_SEARCHING', 'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'RIDER_AT_RESTAURANT', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'CUSTOMER_CANCELLED', 'RESTAURANT_CANCELLED', 'RIDER_ISSUE', 'ADMIN_CANCELLED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "RestaurantOrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_STARTED', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'AT_RESTAURANT', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'NO_RIDER_FOUND', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderFinancialStatus" AS ENUM ('NONE', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'UPI', 'CARD', 'NETBANKING', 'WALLET');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "cancellation_rules" (
    "id" UUID NOT NULL,
    "scope" "ConfigScope" NOT NULL,
    "scopeRefId" UUID,
    "restaurantId" UUID,
    "params" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "supersedesId" UUID,
    "createdById" UUID,
    "changeNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usages" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderSeq" SERIAL NOT NULL,
    "customerId" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "zoneId" UUID,
    "type" "OrderType" NOT NULL DEFAULT 'DELIVERY',
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "restaurantStatus" "RestaurantOrderStatus" NOT NULL DEFAULT 'NEW',
    "restaurantNotifiedAt" TIMESTAMPTZ(3),
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "financialStatus" "OrderFinancialStatus" NOT NULL DEFAULT 'NONE',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalPayablePaise" INTEGER NOT NULL,
    "codAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL,
    "deliveryInstructions" TEXT,
    "restaurantInstructions" TEXT,
    "contactless" BOOLEAN NOT NULL DEFAULT false,
    "deliveryOtpHash" TEXT,
    "prepTimeMinutes" INTEGER,
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "attentionReason" TEXT,
    "scheduledFor" TIMESTAMPTZ(3),
    "placedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "settlementStatus" "SettlementStatus",
    "appVersion" TEXT,
    "platform" "DevicePlatform",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "foodType" "FoodType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restaurantBasePricePaise" INTEGER NOT NULL,
    "customerDisplayPricePaise" INTEGER NOT NULL,
    "markupType" TEXT,
    "markupValue" INTEGER,
    "markupAmountPaise" INTEGER NOT NULL,
    "markupRuleId" UUID,
    "taxMode" TEXT NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "taxAmountPaise" INTEGER NOT NULL,
    "commissionBasis" TEXT NOT NULL,
    "commissionBasePaise" INTEGER NOT NULL,
    "commissionRateBps" INTEGER,
    "commissionAmountPaise" INTEGER NOT NULL,
    "packagingPaise" INTEGER NOT NULL DEFAULT 0,
    "lineTotalPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_addons" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "addonId" UUID NOT NULL,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "restaurantBasePricePaise" INTEGER NOT NULL,
    "customerDisplayPricePaise" INTEGER NOT NULL,
    "markupAmountPaise" INTEGER NOT NULL,

    CONSTRAINT "order_item_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_pricing_snapshots" (
    "orderId" UUID NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "restaurantBaseSubtotalPaise" INTEGER NOT NULL,
    "customerFoodSubtotalPaise" INTEGER NOT NULL,
    "markupTotalPaise" INTEGER NOT NULL,
    "packagingPaise" INTEGER NOT NULL,
    "taxTotalPaise" INTEGER NOT NULL,
    "taxBreakdown" JSONB NOT NULL,
    "deliveryFeePaise" INTEGER NOT NULL,
    "deliveryRule" JSONB NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "distanceSource" TEXT NOT NULL,
    "distanceProvider" TEXT,
    "platformFeePaise" INTEGER NOT NULL,
    "platformFeeRule" JSONB,
    "smallOrderFeePaise" INTEGER NOT NULL,
    "nightSurchargePaise" INTEGER NOT NULL,
    "surgePaise" INTEGER NOT NULL,
    "surgeRules" JSONB,
    "otherFees" JSONB,
    "discountTotalPaise" INTEGER NOT NULL,
    "restaurantFundedDiscountPaise" INTEGER NOT NULL,
    "platformFundedDiscountPaise" INTEGER NOT NULL,
    "couponCode" TEXT,
    "couponSnapshot" JSONB,
    "tipPaise" INTEGER NOT NULL,
    "tipAllocation" JSONB,
    "markupDisclosure" TEXT NOT NULL,
    "roundingAdjustmentPaise" INTEGER NOT NULL,
    "totalPayablePaise" INTEGER NOT NULL,
    "commissionRateBps" INTEGER,
    "commissionAmountPaise" INTEGER NOT NULL,
    "commissionTaxPaise" INTEGER NOT NULL,
    "commissionRule" JSONB NOT NULL,
    "restaurantWithholdingPaise" INTEGER NOT NULL DEFAULT 0,
    "withholdings" JSONB,
    "restaurantPayablePaise" INTEGER NOT NULL,
    "riderEarningEstimatePaise" INTEGER NOT NULL,
    "riderEarningRule" JSONB,
    "gatewayFeeEstimatePaise" INTEGER NOT NULL DEFAULT 0,
    "platformRevenue" JSONB NOT NULL,
    "appliedRuleIds" JSONB NOT NULL,
    "customerBill" JSONB NOT NULL,
    "engineOutput" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_pricing_snapshots_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "order_addresses" (
    "orderId" UUID NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "area" TEXT,
    "cityName" TEXT NOT NULL,
    "pincode" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,

    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorType" "ActorType" NOT NULL,
    "authorId" UUID,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "appId" "AppId" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "appId" "AppId" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cancellations" (
    "orderId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "cancelledByType" "ActorType" NOT NULL,
    "cancelledById" UUID,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "ruleId" UUID,
    "ruleSnapshot" JSONB NOT NULL,
    "customerFeePaise" INTEGER NOT NULL DEFAULT 0,
    "refundDuePaise" INTEGER NOT NULL DEFAULT 0,
    "restaurantCompensationPaise" INTEGER NOT NULL DEFAULT 0,
    "riderCompensationPaise" INTEGER NOT NULL DEFAULT 0,
    "platformLossPaise" INTEGER NOT NULL DEFAULT 0,
    "isAdminOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_rules_supersedesId_key" ON "cancellation_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "cancellation_rules_scope_scopeRefId_effectiveFrom_idx" ON "cancellation_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_usages_orderId_key" ON "coupon_usages"("orderId");

-- CreateIndex
CREATE INDEX "coupon_usages_couponId_customerId_idx" ON "coupon_usages"("couponId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderSeq_key" ON "orders"("orderSeq");

-- CreateIndex
CREATE INDEX "orders_restaurantId_status_createdAt_idx" ON "orders"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_cityId_zoneId_createdAt_idx" ON "orders"("cityId", "zoneId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_deliveryStatus_createdAt_idx" ON "orders"("deliveryStatus", "createdAt");

-- CreateIndex
CREATE INDEX "orders_needsAttention_createdAt_idx" ON "orders"("needsAttention", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_customerId_idempotencyKey_key" ON "orders"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "order_item_addons_orderItemId_idx" ON "order_item_addons"("orderItemId");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_notes_orderId_idx" ON "order_notes"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_channel_appId_locale_key" ON "notification_templates"("event", "channel", "appId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_pricing_snapshots" ADD CONSTRAINT "order_pricing_snapshots_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

