-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('ESCROW_LOCK');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('CREATED', 'LOCK_REQUESTED', 'LOCKED', 'RELEASE_PENDING', 'RELEASED', 'REFUNDED', 'FAILED');

-- CreateTable
CREATE TABLE "payment_instruments" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "type" "InstrumentType" NOT NULL DEFAULT 'ESCROW_LOCK',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "status" "InstrumentStatus" NOT NULL DEFAULT 'CREATED',
    "escrow_reference" TEXT,
    "bank_reference" TEXT,
    "payer_account_ref" TEXT,
    "recipient_account_ref" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "payment_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_instruments_purchase_order_id_key" ON "payment_instruments"("purchase_order_id");

-- CreateIndex
CREATE INDEX "payment_instruments_status_idx" ON "payment_instruments"("status");

-- CreateIndex
CREATE INDEX "payment_instruments_bank_reference_idx" ON "payment_instruments"("bank_reference");

-- AddForeignKey
ALTER TABLE "payment_instruments" ADD CONSTRAINT "payment_instruments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
