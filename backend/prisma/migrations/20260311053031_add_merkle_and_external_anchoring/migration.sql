-- AlterTable
ALTER TABLE "ledger_anchors" ADD COLUMN     "anchor_provider" TEXT,
ADD COLUMN     "anchored_at" TIMESTAMP(3),
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_proof" JSONB,
ADD COLUMN     "external_url" TEXT,
ADD COLUMN     "merkle_leaves" JSONB;
