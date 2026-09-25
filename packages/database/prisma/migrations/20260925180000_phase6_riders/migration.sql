-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BICYCLE', 'MOTORCYCLE', 'SCOOTER', 'EV_SCOOTER', 'CAR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "arrivedAtCustomerAt" TIMESTAMPTZ(3),
ADD COLUMN     "deliveryOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryProofMediaId" UUID,
ADD COLUMN     "riderAtRestaurantAt" TIMESTAMPTZ(3),
ADD COLUMN     "riderId" UUID;

-- CreateTable
CREATE TABLE "rider_documents" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "numberLast4" TEXT,
    "mediaId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresOn" DATE,
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_vehicles" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "type" "VehicleType" NOT NULL,
    "registrationNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_availability" (
    "riderId" UUID NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "activeOrderCount" INTEGER NOT NULL DEFAULT 0,
    "lastLat" DECIMAL(9,6),
    "lastLng" DECIMAL(9,6),
    "lastLocationAt" TIMESTAMPTZ(3),
    "zoneId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rider_availability_pkey" PRIMARY KEY ("riderId")
);

-- CreateTable
CREATE TABLE "rider_locations" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "accuracyM" INTEGER,
    "speedMps" DECIMAL(6,2),
    "headingDeg" INTEGER,
    "orderId" UUID,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_shifts" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "zoneId" UUID,

    CONSTRAINT "rider_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_earnings" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "ruleId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'DELIVERY',
    "totalPaise" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'OFFERED',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "assignedById" UUID,
    "strategy" TEXT,
    "score" DECIMAL(10,4),
    "pickupDistanceM" INTEGER,
    "offeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,

    CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amountPaise" INTEGER NOT NULL,
    "capturedPaise" INTEGER NOT NULL DEFAULT 0,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "gatewayFeePaise" INTEGER,
    "gatewayTaxPaise" INTEGER,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "codCollectedById" UUID,
    "codCollectedAt" TIMESTAMPTZ(3),
    "codReconciledAt" TIMESTAMPTZ(3),
    "codSettlementRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_documents_riderId_idx" ON "rider_documents"("riderId");

-- CreateIndex
CREATE INDEX "rider_vehicles_riderId_idx" ON "rider_vehicles"("riderId");

-- CreateIndex
CREATE INDEX "rider_availability_isOnline_zoneId_idx" ON "rider_availability"("isOnline", "zoneId");

-- CreateIndex
CREATE INDEX "rider_locations_riderId_recordedAt_idx" ON "rider_locations"("riderId", "recordedAt");

-- CreateIndex
CREATE INDEX "rider_shifts_riderId_startedAt_idx" ON "rider_shifts"("riderId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rider_earnings_orderId_key" ON "rider_earnings"("orderId");

-- CreateIndex
CREATE INDEX "rider_earnings_riderId_createdAt_idx" ON "rider_earnings"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_assignments_orderId_status_idx" ON "order_assignments"("orderId", "status");

-- CreateIndex
CREATE INDEX "order_assignments_riderId_status_idx" ON "order_assignments"("riderId", "status");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_providerOrderId_key" ON "payments"("provider", "providerOrderId");

-- CreateIndex
CREATE INDEX "orders_riderId_status_idx" ON "orders"("riderId", "status");

-- AddForeignKey
ALTER TABLE "rider_documents" ADD CONSTRAINT "rider_documents_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_vehicles" ADD CONSTRAINT "rider_vehicles_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_availability" ADD CONSTRAINT "rider_availability_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_locations" ADD CONSTRAINT "rider_locations_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_shifts" ADD CONSTRAINT "rider_shifts_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_earnings" ADD CONSTRAINT "rider_earnings_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_earnings" ADD CONSTRAINT "rider_earnings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

