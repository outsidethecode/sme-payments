-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'SUPPLIER', 'LIQUIDITY_PARTNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'VERIFIED', 'SETTLED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AcceptanceType" AS ENUM ('BUYER_CONFIRMATION', 'AUTO_ACCEPT');

-- CreateEnum
CREATE TYPE "PaymentLockStatus" AS ENUM ('PENDING', 'LOCKED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "EarlyPaymentStatus" AS ENUM ('REQUESTED', 'APPROVED', 'FUNDED', 'SETTLED', 'REJECTED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('STANDARD', 'EARLY_PAY_ADVANCE', 'EARLY_PAY_SETTLEMENT');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('TRANSACTION', 'EARLY_PAY_FACILITATION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_number" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_passkeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "sign_count" INTEGER NOT NULL DEFAULT 0,
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "reference_number" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "line_items" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "acceptance_type" "AcceptanceType" NOT NULL DEFAULT 'BUYER_CONFIRMATION',
    "acceptance_window_hours" INTEGER NOT NULL DEFAULT 48,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_locks" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentLockStatus" NOT NULL DEFAULT 'PENDING',
    "open_banking_ref" TEXT,
    "locked_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "early_payment_requests" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "liquidity_partner_id" TEXT,
    "face_value" INTEGER NOT NULL,
    "service_fee" INTEGER NOT NULL,
    "net_advance" INTEGER NOT NULL,
    "status" "EarlyPaymentStatus" NOT NULL DEFAULT 'REQUESTED',
    "risk_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "funded_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "early_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "SettlementType" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "entity_sequence" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_signature" TEXT NOT NULL,
    "authenticator_data" TEXT,
    "actor_public_key" TEXT NOT NULL,
    "credential_id" TEXT,
    "previous_hash" TEXT NOT NULL,
    "event_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_fees" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "fee_type" "FeeType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_passkeys_credential_id_key" ON "user_passkeys"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_reference_number_key" ON "purchase_orders"("reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_locks_purchase_order_id_key" ON "payment_locks"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "early_payment_requests_purchase_order_id_key" ON "early_payment_requests"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_log_event_hash_key" ON "event_log"("event_hash");

-- CreateIndex
CREATE INDEX "event_log_entity_id_entity_sequence_idx" ON "event_log"("entity_id", "entity_sequence");

-- CreateIndex
CREATE INDEX "event_log_sequence_idx" ON "event_log"("sequence");

-- CreateIndex
CREATE INDEX "event_log_actor_id_idx" ON "event_log"("actor_id");

-- CreateIndex
CREATE INDEX "event_log_entity_type_event_type_idx" ON "event_log"("entity_type", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "event_log_entity_id_entity_sequence_key" ON "event_log"("entity_id", "entity_sequence");

-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_locks" ADD CONSTRAINT "payment_locks_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_locks" ADD CONSTRAINT "payment_locks_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_payment_requests" ADD CONSTRAINT "early_payment_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_payment_requests" ADD CONSTRAINT "early_payment_requests_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_payment_requests" ADD CONSTRAINT "early_payment_requests_liquidity_partner_id_fkey" FOREIGN KEY ("liquidity_partner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
