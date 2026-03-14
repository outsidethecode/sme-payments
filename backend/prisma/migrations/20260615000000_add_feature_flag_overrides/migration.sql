-- CreateTable
CREATE TABLE "feature_flag_overrides" (
    "id" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "organisation_id" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_flag_overrides_flag_idx" ON "feature_flag_overrides"("flag");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_overrides_flag_organisation_id_key" ON "feature_flag_overrides"("flag", "organisation_id");

-- AddForeignKey
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
