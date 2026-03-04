-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('IMMEDIATE', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'NET_90');

-- CreateEnum
CREATE TYPE "DeliveryTerms" AS ENUM ('EX_WORKS', 'FOB', 'CIF', 'DDP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('DELIVERY_NOTE', 'SIGNED_RECEIPT', 'PHOTO_PROOF', 'INVOICE', 'INSPECTION_REPORT', 'SHIPPING_DOCUMENT', 'PO_DOCUMENT', 'OTHER');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "accepted_line_items" JSONB,
ADD COLUMN     "attachment_url" TEXT,
ADD COLUMN     "delivery_address" TEXT,
ADD COLUMN     "delivery_terms" "DeliveryTerms" NOT NULL DEFAULT 'EX_WORKS',
ADD COLUMN     "delivery_terms_note" TEXT,
ADD COLUMN     "dispute_window_hours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "external_po_number" TEXT,
ADD COLUMN     "gross_amount" INTEGER,
ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "import_source" TEXT,
ADD COLUMN     "imported_at" TIMESTAMP(3),
ADD COLUMN     "partial_acceptance_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_terms" "PaymentTerms" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN     "tax_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "evidence_attachments" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sha256_hash" TEXT NOT NULL,
    "event_log_id" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_attachments_purchase_order_id_idx" ON "evidence_attachments"("purchase_order_id");

-- CreateIndex
CREATE INDEX "evidence_attachments_sha256_hash_idx" ON "evidence_attachments"("sha256_hash");

-- CreateIndex
CREATE INDEX "purchase_orders_external_po_number_idx" ON "purchase_orders"("external_po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_import_batch_id_idx" ON "purchase_orders"("import_batch_id");

-- AddForeignKey
ALTER TABLE "evidence_attachments" ADD CONSTRAINT "evidence_attachments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_attachments" ADD CONSTRAINT "evidence_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
