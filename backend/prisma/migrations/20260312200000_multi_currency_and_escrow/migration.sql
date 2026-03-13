-- Multi-Currency & Escrow Account Migration
-- Step 1: Add currency fields to models missing them
-- Step 11: Add EscrowAccount model + FK on PaymentInstrument + ReconciliationReport

-- ── 1. Remove stale InstrumentStatus enum values ────────────
-- These were renamed in a previous migration but the enum values weren't cleaned up
-- Only remove if no rows reference them
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_instruments WHERE status = 'RELEASE_PENDING')
     AND NOT EXISTS (SELECT 1 FROM payment_instruments WHERE status = 'RELEASED') THEN
    ALTER TYPE "InstrumentStatus" RENAME VALUE 'RELEASE_PENDING' TO '_DEPRECATED_RELEASE_PENDING';
    ALTER TYPE "InstrumentStatus" RENAME VALUE 'RELEASED' TO '_DEPRECATED_RELEASED';
  END IF;
EXCEPTION WHEN others THEN
  -- If values already removed or renamed, ignore
  NULL;
END $$;

-- ── 2. Convert String currency columns to Currency enum ─────

-- purchase_orders: String → Currency enum
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" SET DEFAULT 'GBP';

-- payment_instruments: String → Currency enum
ALTER TABLE "payment_instruments" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "payment_instruments" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
ALTER TABLE "payment_instruments" ALTER COLUMN "currency" SET DEFAULT 'GBP';

-- settlements: String → Currency enum
ALTER TABLE "settlements" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "settlements" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
ALTER TABLE "settlements" ALTER COLUMN "currency" SET DEFAULT 'GBP';

-- ── 3. Add currency column to models missing it ─────────────

-- payment_locks
ALTER TABLE "payment_locks" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

-- Back-fill from PO
UPDATE "payment_locks" pl
  SET "currency" = po."currency"
  FROM "purchase_orders" po
  WHERE pl."purchase_order_id" = po."id";

-- early_payment_requests
ALTER TABLE "early_payment_requests" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

UPDATE "early_payment_requests" epr
  SET "currency" = po."currency"
  FROM "purchase_orders" po
  WHERE epr."purchase_order_id" = po."id";

-- platform_fees
ALTER TABLE "platform_fees" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

UPDATE "platform_fees" pf
  SET "currency" = po."currency"
  FROM "purchase_orders" po
  WHERE pf."purchase_order_id" = po."id";

-- disputes
ALTER TABLE "disputes" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

UPDATE "disputes" d
  SET "currency" = po."currency"
  FROM "purchase_orders" po
  WHERE d."purchase_order_id" = po."id";

-- lp_exposure_snapshots
ALTER TABLE "lp_exposure_snapshots" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

-- reconciliation_reports
ALTER TABLE "reconciliation_reports" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'GBP';

-- ── 4. Create EscrowAccount table ───────────────────────────

CREATE TABLE "escrow_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'GBP',
    "balance_minor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrow_accounts_pkey" PRIMARY KEY ("id")
);

-- Unique: one account per country+currency
CREATE UNIQUE INDEX "escrow_accounts_country_currency_key" ON "escrow_accounts"("country", "currency");

-- ── 5. Add escrowAccountId FK to payment_instruments ────────

ALTER TABLE "payment_instruments" ADD COLUMN "escrow_account_id" TEXT;

CREATE INDEX "payment_instruments_escrow_account_id_idx" ON "payment_instruments"("escrow_account_id");

ALTER TABLE "payment_instruments" ADD CONSTRAINT "payment_instruments_escrow_account_id_fkey"
    FOREIGN KEY ("escrow_account_id") REFERENCES "escrow_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 6. Add escrowAccountId FK to reconciliation_reports ─────

ALTER TABLE "reconciliation_reports" ADD COLUMN "escrow_account_id" TEXT;

CREATE INDEX "reconciliation_reports_escrow_account_id_idx" ON "reconciliation_reports"("escrow_account_id");

ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_escrow_account_id_fkey"
    FOREIGN KEY ("escrow_account_id") REFERENCES "escrow_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
