-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM ('PLATFORM', 'RESTAURANT', 'SHARED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "HomeSectionType" AS ENUM ('BANNER_CAROUSEL', 'CATEGORIES', 'TOP_RESTAURANTS', 'POPULAR_NEAR_YOU', 'RECOMMENDED', 'OFFERS', 'NEW_RESTAURANTS', 'FREE_DELIVERY', 'UNDER_PRICE', 'TOP_RATED', 'CUISINE_COLLECTION', 'RESTAURANT_COLLECTION', 'PRODUCT_COLLECTION', 'IMAGE_PROMO', 'TEXT');

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "area" TEXT,
    "cityName" TEXT NOT NULL,
    "pincode" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "zoneId" UUID,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_restaurants" (
    "customerId" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_restaurants_pkey" PRIMARY KEY ("customerId","restaurantId")
);

-- CreateTable
CREATE TABLE "markup_rules" (
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

    CONSTRAINT "markup_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
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

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
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

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_fee_rules" (
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

    CONSTRAINT "platform_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_pricing_rules" (
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

    CONSTRAINT "delivery_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_earning_rules" (
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

    CONSTRAINT "rider_earning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surge_rules" (
    "id" UUID NOT NULL,
    "scope" "ConfigScope" NOT NULL,
    "scopeRefId" UUID,
    "restaurantId" UUID,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "supersedesId" UUID,
    "createdById" UUID,
    "changeNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "valueBps" INTEGER,
    "valuePaise" INTEGER,
    "maxDiscountPaise" INTEGER,
    "minOrderPaise" INTEGER,
    "fundingSource" "FundingSource" NOT NULL DEFAULT 'PLATFORM',
    "restaurantShareBps" INTEGER,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "valueBps" INTEGER,
    "valuePaise" INTEGER,
    "maxDiscountPaise" INTEGER,
    "minOrderPaise" INTEGER,
    "fundingSource" "FundingSource" NOT NULL DEFAULT 'RESTAURANT',
    "restaurantShareBps" INTEGER,
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_sections" (
    "id" UUID NOT NULL,
    "type" "HomeSectionType" NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "mediaId" UUID,
    "background" TEXT,
    "ctaLabel" TEXT,
    "deepLink" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "cityIds" UUID[],
    "zoneIds" UUID[],
    "audience" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "homeSectionId" UUID,
    "mediaId" UUID NOT NULL,
    "title" TEXT,
    "deepLink" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "cityIds" UUID[],
    "zoneIds" UUID[],
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_userId_kind_idx" ON "consent_records"("userId", "kind");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "markup_rules_supersedesId_key" ON "markup_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "markup_rules_scope_scopeRefId_effectiveFrom_idx" ON "markup_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_supersedesId_key" ON "commission_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "commission_rules_scope_scopeRefId_effectiveFrom_idx" ON "commission_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rules_supersedesId_key" ON "tax_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "tax_rules_scope_scopeRefId_effectiveFrom_idx" ON "tax_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_rules_supersedesId_key" ON "platform_fee_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "platform_fee_rules_scope_scopeRefId_effectiveFrom_idx" ON "platform_fee_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pricing_rules_supersedesId_key" ON "delivery_pricing_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "delivery_pricing_rules_scope_scopeRefId_effectiveFrom_idx" ON "delivery_pricing_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "rider_earning_rules_supersedesId_key" ON "rider_earning_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "rider_earning_rules_scope_scopeRefId_effectiveFrom_idx" ON "rider_earning_rules"("scope", "scopeRefId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "surge_rules_supersedesId_key" ON "surge_rules"("supersedesId");

-- CreateIndex
CREATE INDEX "surge_rules_scope_scopeRefId_kind_effectiveFrom_idx" ON "surge_rules"("scope", "scopeRefId", "kind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_isActive_startsAt_idx" ON "coupons"("isActive", "startsAt");

-- CreateIndex
CREATE INDEX "promotions_isActive_startsAt_idx" ON "promotions"("isActive", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");

-- CreateIndex
CREATE INDEX "home_sections_isEnabled_position_idx" ON "home_sections"("isEnabled", "position");

-- CreateIndex
CREATE INDEX "banners_homeSectionId_position_idx" ON "banners"("homeSectionId", "position");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_restaurants" ADD CONSTRAINT "favorite_restaurants_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_restaurants" ADD CONSTRAINT "favorite_restaurants_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_homeSectionId_fkey" FOREIGN KEY ("homeSectionId") REFERENCES "home_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

