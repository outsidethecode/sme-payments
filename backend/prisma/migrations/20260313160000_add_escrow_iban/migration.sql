-- Add IBAN column to escrow_accounts (nullable for backward compat)
ALTER TABLE "escrow_accounts" ADD COLUMN "iban" TEXT;

-- Populate existing rows with simulated IBANs
UPDATE "escrow_accounts" SET "iban" = 'GB29BARC20035394427492' WHERE "country" = 'GB';
UPDATE "escrow_accounts" SET "iban" = 'SA0380000000608010167519' WHERE "country" = 'SA';
