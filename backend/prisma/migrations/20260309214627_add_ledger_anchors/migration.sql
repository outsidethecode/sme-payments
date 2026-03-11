-- CreateTable
CREATE TABLE "ledger_anchors" (
    "id" TEXT NOT NULL,
    "anchor_sequence" SERIAL NOT NULL,
    "anchor_hash" TEXT NOT NULL,
    "previous_anchor_hash" TEXT,
    "event_count" INTEGER NOT NULL,
    "entity_count" INTEGER NOT NULL,
    "head_hashes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_anchors_anchor_hash_key" ON "ledger_anchors"("anchor_hash");

-- CreateIndex
CREATE INDEX "ledger_anchors_anchor_sequence_idx" ON "ledger_anchors"("anchor_sequence");
