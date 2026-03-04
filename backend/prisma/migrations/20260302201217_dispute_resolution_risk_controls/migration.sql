-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'EVIDENCE_SUBMITTED', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE_TO_SUPPLIER', 'REWORK');

-- CreateEnum
CREATE TYPE "FraudFlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "raised_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "resolved_by_id" TEXT,
    "refund_amount" INTEGER,
    "resolution_notes" TEXT,
    "buyer_evidence" JSONB,
    "supplier_evidence" JSONB,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "severity" "FraudFlagSeverity" NOT NULL,
    "details" JSONB NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lp_exposure_snapshots" (
    "id" TEXT NOT NULL,
    "liquidity_partner_id" TEXT NOT NULL,
    "total_exposure" INTEGER NOT NULL,
    "buyer_concentration" JSONB NOT NULL,
    "supplier_concentration" JSONB NOT NULL,
    "funding_suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspension_reason" TEXT,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lp_exposure_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_purchase_order_id_idx" ON "disputes"("purchase_order_id");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "fraud_flags_user_id_rule_code_idx" ON "fraud_flags"("user_id", "rule_code");

-- CreateIndex
CREATE INDEX "fraud_flags_severity_acknowledged_idx" ON "fraud_flags"("severity", "acknowledged");

-- CreateIndex
CREATE INDEX "lp_exposure_snapshots_liquidity_partner_id_snapshot_at_idx" ON "lp_exposure_snapshots"("liquidity_partner_id", "snapshot_at");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lp_exposure_snapshots" ADD CONSTRAINT "lp_exposure_snapshots_liquidity_partner_id_fkey" FOREIGN KEY ("liquidity_partner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
