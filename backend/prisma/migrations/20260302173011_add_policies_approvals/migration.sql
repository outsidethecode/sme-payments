-- CreateEnum
CREATE TYPE "PolicyRuleType" AS ENUM ('PO_APPROVAL', 'FUNDING_LIMIT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- AlterEnum
ALTER TYPE "POStatus" ADD VALUE 'PENDING_APPROVAL';

-- CreateTable
CREATE TABLE "policy_rules" (
    "id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "rule_type" "PolicyRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "required_roles" TEXT[],
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "policy_rule_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "required_approvals" INTEGER NOT NULL,
    "current_approvals" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "escalate_after" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_role" "OrgRole" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "signature" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_rules_organisation_id_rule_type_active_idx" ON "policy_rules"("organisation_id", "rule_type", "active");

-- CreateIndex
CREATE INDEX "approval_requests_entity_id_entity_type_idx" ON "approval_requests"("entity_id", "entity_type");

-- CreateIndex
CREATE INDEX "approval_requests_organisation_id_status_idx" ON "approval_requests"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_approval_request_id_user_id_key" ON "approvals"("approval_request_id", "user_id");

-- AddForeignKey
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_rule_id_fkey" FOREIGN KEY ("policy_rule_id") REFERENCES "policy_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
