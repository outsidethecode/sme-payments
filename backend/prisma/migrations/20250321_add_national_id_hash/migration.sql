-- AlterTable
ALTER TABLE "users" ADD COLUMN "national_id_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_national_id_hash_key" ON "users"("national_id_hash");

-- AlterEnum (remove deprecated values)
-- Note: Only safe if no rows use these values
DELETE FROM "_prisma_migrations" WHERE id = 'placeholder';
-- Removing deprecated enum values handled by db push
