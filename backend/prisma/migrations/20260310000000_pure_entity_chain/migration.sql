-- Pure entity-scoped chain: purge old events and remove transitional fields.

-- Truncate events and anchors (fresh start — no backward compat needed)
TRUNCATE TABLE "event_log" CASCADE;
TRUNCATE TABLE "ledger_anchors" CASCADE;

-- Drop transitional columns
ALTER TABLE "event_log" DROP COLUMN IF EXISTS "entity_previous_hash";
ALTER TABLE "event_log" DROP COLUMN IF EXISTS "chain_version";
