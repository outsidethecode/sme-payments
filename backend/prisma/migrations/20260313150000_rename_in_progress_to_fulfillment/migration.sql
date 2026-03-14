-- Rename POStatus enum value: IN_PROGRESS → FULFILLMENT
-- Uses RENAME VALUE (PostgreSQL 10+) for an atomic, in-place rename.
-- All existing rows with IN_PROGRESS are automatically updated.

ALTER TYPE "POStatus" RENAME VALUE 'IN_PROGRESS' TO 'FULFILLMENT';
