-- CreateEnum
CREATE TYPE "EscrowTxType" AS ENUM ('DEPOSIT', 'RELEASE_SUPPLIER', 'RELEASE_LP', 'REFUND_BUYER', 'FEE_DEDUCTION');

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" TEXT NOT NULL,
    "escrow_account_id" TEXT NOT NULL,
    "type" "EscrowTxType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "purchase_order_id" TEXT,
    "counterparty_id" TEXT,
    "reference" TEXT NOT NULL,
    "ledger_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escrow_transactions_escrow_account_id_created_at_idx" ON "escrow_transactions"("escrow_account_id", "created_at");

-- CreateIndex
CREATE INDEX "escrow_transactions_purchase_order_id_idx" ON "escrow_transactions"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_escrow_account_id_fkey" FOREIGN KEY ("escrow_account_id") REFERENCES "escrow_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
