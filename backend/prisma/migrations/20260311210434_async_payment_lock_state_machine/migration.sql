-- AlterEnum
ALTER TYPE "PaymentLockStatus" ADD VALUE 'LOCK_FAILED';

-- AlterTable
ALTER TABLE "payment_locks" ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "failure_reason" TEXT;
