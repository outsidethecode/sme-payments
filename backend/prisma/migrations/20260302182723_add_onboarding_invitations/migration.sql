-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'KYB_PENDING', 'KYB_VERIFIED', 'KYB_FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SupplierTier" AS ENUM ('BASIC', 'LIQUIDITY_ELIGIBLE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "authorized_signatory" TEXT,
ADD COLUMN     "bank_iban" TEXT,
ADD COLUMN     "funding_account_ref" TEXT,
ADD COLUMN     "funding_limit_total" INTEGER,
ADD COLUMN     "kyb_data" JSONB,
ADD COLUMN     "kyb_provider" TEXT,
ADD COLUMN     "kyb_verified_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "participation_agreement_accepted_at" TIMESTAMP(3),
ADD COLUMN     "risk_appetite_config" JSONB,
ADD COLUMN     "sanctions_checked_at" TIMESTAMP(3),
ADD COLUMN     "supplier_tier" "SupplierTier",
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "ubo_disclosure" JSONB;

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "inviter_org_id" TEXT NOT NULL,
    "inviter_user_id" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "invitee_role" "OrgType" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_inviter_org_id_idx" ON "invitations"("inviter_org_id");

-- CreateIndex
CREATE INDEX "invitations_invitee_email_idx" ON "invitations"("invitee_email");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_org_id_fkey" FOREIGN KEY ("inviter_org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
