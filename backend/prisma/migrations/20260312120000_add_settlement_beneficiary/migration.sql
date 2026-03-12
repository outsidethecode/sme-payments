-- CreateEnum: SettlementBeneficiary
CREATE TYPE "SettlementBeneficiary" AS ENUM ('SUPPLIER', 'LIQUIDITY_PROVIDER', 'BUYER');

-- Add new values to InstrumentStatus enum
ALTER TYPE "InstrumentStatus" ADD VALUE IF NOT EXISTS 'FINANCING_REQUESTED';
ALTER TYPE "InstrumentStatus" ADD VALUE IF NOT EXISTS 'FINANCING_FUNDED';
ALTER TYPE "InstrumentStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PENDING';
ALTER TYPE "InstrumentStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

-- Add new columns to payment_instruments
ALTER TABLE "payment_instruments" ADD COLUMN "settlement_beneficiary" "SettlementBeneficiary" NOT NULL DEFAULT 'SUPPLIER';
ALTER TABLE "payment_instruments" ADD COLUMN "buyer_org_id" TEXT;
ALTER TABLE "payment_instruments" ADD COLUMN "supplier_org_id" TEXT;
ALTER TABLE "payment_instruments" ADD COLUMN "financing_partner_id" TEXT;

-- Rename released_at → settled_at
ALTER TABLE "payment_instruments" RENAME COLUMN "released_at" TO "settled_at";

-- Add index on settlement_beneficiary
CREATE INDEX "payment_instruments_settlement_beneficiary_idx" ON "payment_instruments"("settlement_beneficiary");
