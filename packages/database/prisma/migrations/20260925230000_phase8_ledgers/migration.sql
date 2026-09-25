-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "RestaurantLedgerEntryType" AS ENUM ('FOOD_SALE', 'COMMISSION', 'COMMISSION_TAX', 'RESTAURANT_FUNDED_DISCOUNT', 'TAX_ADJUSTMENT', 'REFUND', 'CANCELLATION', 'PENALTY', 'WITHHOLDING', 'RESTAURANT_FEE', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'REVERSAL', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "RiderLedgerEntryType" AS ENUM ('DELIVERY_EARNING', 'DISTANCE_EARNING', 'WAITING_CHARGE', 'INCENTIVE', 'BONUS', 'TIP', 'ADJUSTMENT', 'COD_COLLECTED', 'COD_SUBMITTED', 'COD_SHORTAGE', 'COD_EXCESS', 'PENALTY', 'REVERSAL', 'PAYOUT');

-- CreateEnum
CREATE TYPE "PlatformLedgerEntryType" AS ENUM ('MARKUP_REVENUE', 'COMMISSION_REVENUE', 'PLATFORM_FEE', 'DELIVERY_FEE', 'SMALL_ORDER_FEE', 'SURCHARGE', 'PLATFORM_FUNDED_DISCOUNT', 'RIDER_COST', 'GATEWAY_FEE', 'REFUND_LOSS', 'TAX_COLLECTED', 'WITHHOLDING_TAX', 'TIP_PASS_THROUGH', 'ROUNDING_ADJUSTMENT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "SettlementSchedule" AS ENUM ('DAILY', 'T_PLUS_1', 'T_PLUS_2', 'WEEKLY', 'MANUAL');

-- CreateTable
CREATE TABLE "rider_payouts" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "settlementId" UUID,
    "amountPaise" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_ledgers" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "balancePaise" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurant_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_ledger_entries" (
    "id" UUID NOT NULL,
    "ledgerId" UUID NOT NULL,
    "type" "RestaurantLedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "balanceAfterPaise" BIGINT NOT NULL,
    "orderId" UUID,
    "refundId" UUID,
    "settlementId" UUID,
    "description" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_settlements" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "schedule" "SettlementSchedule" NOT NULL,
    "openingPaise" BIGINT NOT NULL,
    "grossSalesPaise" BIGINT NOT NULL DEFAULT 0,
    "commissionPaise" BIGINT NOT NULL DEFAULT 0,
    "taxesPaise" BIGINT NOT NULL DEFAULT 0,
    "withholdingPaise" BIGINT NOT NULL DEFAULT 0,
    "feesPaise" BIGINT NOT NULL DEFAULT 0,
    "discountsPaise" BIGINT NOT NULL DEFAULT 0,
    "refundsPaise" BIGINT NOT NULL DEFAULT 0,
    "adjustmentsPaise" BIGINT NOT NULL DEFAULT 0,
    "codInfoPaise" BIGINT NOT NULL DEFAULT 0,
    "creditsPaise" BIGINT NOT NULL,
    "debitsPaise" BIGINT NOT NULL,
    "netPayablePaise" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "payoutReference" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "statementMediaId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurant_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_ledgers" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "earningsBalancePaise" BIGINT NOT NULL DEFAULT 0,
    "codHeldPaise" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rider_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_ledger_entries" (
    "id" UUID NOT NULL,
    "ledgerId" UUID NOT NULL,
    "type" "RiderLedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "orderId" UUID,
    "settlementId" UUID,
    "description" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_settlements" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "earningsPaise" BIGINT NOT NULL,
    "codOwedPaise" BIGINT NOT NULL,
    "netPayablePaise" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "payoutReference" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rider_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ledger_entries" (
    "id" UUID NOT NULL,
    "type" "PlatformLedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "orderId" UUID,
    "cityId" UUID,
    "description" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_cod_deposits" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "expectedPaise" INTEGER,
    "variancePaise" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reportedBy" TEXT NOT NULL DEFAULT 'RIDER',
    "receivedById" UUID,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cod_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_payouts_riderId_createdAt_idx" ON "rider_payouts"("riderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_ledgers_restaurantId_key" ON "restaurant_ledgers"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_ledger_entries_idempotencyKey_key" ON "restaurant_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "restaurant_ledger_entries_ledgerId_createdAt_idx" ON "restaurant_ledger_entries"("ledgerId", "createdAt");

-- CreateIndex
CREATE INDEX "restaurant_ledger_entries_orderId_idx" ON "restaurant_ledger_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_settlements_restaurantId_periodStart_periodEnd_key" ON "restaurant_settlements"("restaurantId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "rider_ledgers_riderId_key" ON "rider_ledgers"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "rider_ledger_entries_idempotencyKey_key" ON "rider_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "rider_ledger_entries_ledgerId_createdAt_idx" ON "rider_ledger_entries"("ledgerId", "createdAt");

-- CreateIndex
CREATE INDEX "rider_ledger_entries_orderId_idx" ON "rider_ledger_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "rider_settlements_riderId_periodStart_periodEnd_key" ON "rider_settlements"("riderId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_entries_idempotencyKey_key" ON "platform_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "platform_ledger_entries_orderId_idx" ON "platform_ledger_entries"("orderId");

-- CreateIndex
CREATE INDEX "platform_ledger_entries_type_createdAt_idx" ON "platform_ledger_entries"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rider_cod_deposits_idempotencyKey_key" ON "rider_cod_deposits"("idempotencyKey");

-- CreateIndex
CREATE INDEX "rider_cod_deposits_riderId_createdAt_idx" ON "rider_cod_deposits"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "rider_cod_deposits_status_idx" ON "rider_cod_deposits"("status");

-- AddForeignKey
ALTER TABLE "rider_payouts" ADD CONSTRAINT "rider_payouts_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_ledgers" ADD CONSTRAINT "restaurant_ledgers_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_ledger_entries" ADD CONSTRAINT "restaurant_ledger_entries_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "restaurant_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_ledger_entries" ADD CONSTRAINT "restaurant_ledger_entries_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "restaurant_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_settlements" ADD CONSTRAINT "restaurant_settlements_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_ledgers" ADD CONSTRAINT "rider_ledgers_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_ledger_entries" ADD CONSTRAINT "rider_ledger_entries_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "rider_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_ledger_entries" ADD CONSTRAINT "rider_ledger_entries_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "rider_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_settlements" ADD CONSTRAINT "rider_settlements_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cod_deposits" ADD CONSTRAINT "rider_cod_deposits_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

