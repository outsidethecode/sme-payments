-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('BUYER', 'SUPPLIER', 'LIQUIDITY_PARTNER');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'APPROVER', 'FINANCE', 'MEMBER');

-- CreateEnum
CREATE TYPE "Jurisdiction" AS ENUM ('UK', 'KSA');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('GBP', 'SAR');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "event_log" ADD COLUMN     "client_data_json" TEXT,
ADD COLUMN     "intent_hash" TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "company_name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "registration_no" TEXT,
    "jurisdiction" "Jurisdiction" NOT NULL DEFAULT 'UK',
    "currency" "Currency" NOT NULL DEFAULT 'GBP',
    "sharia_compliant" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "org_role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_user_id_key" ON "org_memberships"("user_id");

-- CreateIndex
CREATE INDEX "org_memberships_organisation_id_idx" ON "org_memberships"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_user_id_organisation_id_key" ON "org_memberships"("user_id", "organisation_id");

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
