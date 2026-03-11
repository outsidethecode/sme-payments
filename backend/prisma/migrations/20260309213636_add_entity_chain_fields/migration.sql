-- AlterTable
ALTER TABLE "event_log" ADD COLUMN     "chain_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "entity_previous_hash" TEXT;
