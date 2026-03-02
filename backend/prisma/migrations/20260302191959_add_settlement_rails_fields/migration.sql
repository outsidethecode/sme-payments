-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'GBP',
ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "reconciled_at" TIMESTAMP(3),
ADD COLUMN     "settlement_rail" TEXT;

-- CreateIndex
CREATE INDEX "settlements_external_ref_idx" ON "settlements"("external_ref");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");
