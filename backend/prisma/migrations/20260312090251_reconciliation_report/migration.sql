-- CreateTable
CREATE TABLE "reconciliation_reports" (
    "id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "total_checked" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "mismatches" INTEGER NOT NULL,
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "ledger_balance" INTEGER,
    "bank_balance" INTEGER,
    "variance" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_reports_run_at_idx" ON "reconciliation_reports"("run_at");
