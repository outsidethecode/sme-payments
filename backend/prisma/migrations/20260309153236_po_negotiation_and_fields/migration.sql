-- AlterEnum
ALTER TYPE "POStatus" ADD VALUE 'NEGOTIATION';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "buyer_contact_email" TEXT,
ADD COLUMN     "buyer_contact_name" TEXT,
ADD COLUMN     "current_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expected_delivery_date" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "shipped_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "po_revisions" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "proposed_by" TEXT NOT NULL,
    "proposed_by_role" TEXT NOT NULL,
    "line_items" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "expected_delivery_date" TIMESTAMP(3),
    "payment_terms" "PaymentTerms",
    "delivery_terms" "DeliveryTerms",
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "po_revisions_purchase_order_id_idx" ON "po_revisions"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "po_revisions_purchase_order_id_revision_key" ON "po_revisions"("purchase_order_id", "revision");

-- AddForeignKey
ALTER TABLE "po_revisions" ADD CONSTRAINT "po_revisions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
