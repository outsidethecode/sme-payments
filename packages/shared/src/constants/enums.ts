// ── Roles ────────────────────────────────────────────────────
export enum UserRole {
  BUYER = "BUYER",
  SUPPLIER = "SUPPLIER",
  LIQUIDITY_PARTNER = "LIQUIDITY_PARTNER",
  ADMIN = "ADMIN",
}

// ── Purchase Order Statuses ──────────────────────────────────
export enum POStatus {
  DRAFT = "DRAFT",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  SENT = "SENT",
  NEGOTIATION = "NEGOTIATION",
  ACCEPTED = "ACCEPTED",
  FULFILLMENT = "FULFILLMENT",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
  VERIFIED = "VERIFIED",
  SETTLED = "SETTLED",
  DISPUTED = "DISPUTED",
  CANCELLED = "CANCELLED",
}

/** Valid status transitions keyed by current status */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  [POStatus.DRAFT]: [
    POStatus.SENT,
    POStatus.PENDING_APPROVAL,
    POStatus.CANCELLED,
  ],
  [POStatus.PENDING_APPROVAL]: [POStatus.SENT, POStatus.CANCELLED],
  [POStatus.SENT]: [
    POStatus.ACCEPTED,
    POStatus.NEGOTIATION,
    POStatus.CANCELLED,
  ],
  [POStatus.NEGOTIATION]: [POStatus.SENT, POStatus.CANCELLED],
  [POStatus.ACCEPTED]: [POStatus.SHIPPED, POStatus.FULFILLMENT],
  [POStatus.FULFILLMENT]: [POStatus.SHIPPED, POStatus.DELIVERED],
  [POStatus.SHIPPED]: [POStatus.DELIVERED],
  [POStatus.DELIVERED]: [POStatus.VERIFIED, POStatus.DISPUTED],
  [POStatus.VERIFIED]: [POStatus.SETTLED],
  [POStatus.SETTLED]: [],
  [POStatus.DISPUTED]: [],
  [POStatus.CANCELLED]: [],
};

// ── Payment Lock ─────────────────────────────────────────────
export enum PaymentLockStatus {
  PENDING = "PENDING",
  LOCKED = "LOCKED",
  RELEASED = "RELEASED",
  REFUNDED = "REFUNDED",
}

// ── Early Payment ────────────────────────────────────────────
export enum EarlyPaymentStatus {
  REQUESTED = "REQUESTED",
  APPROVED = "APPROVED",
  FUNDED = "FUNDED",
  SETTLED = "SETTLED",
  REJECTED = "REJECTED",
  DEFAULTED = "DEFAULTED",
}

// ── Settlement ───────────────────────────────────────────────
export enum SettlementType {
  STANDARD = "STANDARD",
  EARLY_PAY_ADVANCE = "EARLY_PAY_ADVANCE",
  EARLY_PAY_SETTLEMENT = "EARLY_PAY_SETTLEMENT",
}

export enum SettlementStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

// ── Platform Fee ─────────────────────────────────────────────
export enum FeeType {
  TRANSACTION = "TRANSACTION",
  EARLY_PAY_FACILITATION = "EARLY_PAY_FACILITATION",
}

// ── Event Log ────────────────────────────────────────────────
export enum EventType {
  // Commercial
  PO_CREATED = "PO_CREATED",
  PO_SENT = "PO_SENT",
  PO_ACCEPTED = "PO_ACCEPTED",
  PO_CANCELLED = "PO_CANCELLED",
  PO_APPROVAL_REQUESTED = "PO_APPROVAL_REQUESTED",
  PO_APPROVAL_VOTE = "PO_APPROVAL_VOTE",
  PO_APPROVAL_GRANTED = "PO_APPROVAL_GRANTED",
  PO_APPROVAL_REJECTED = "PO_APPROVAL_REJECTED",
  PO_AUTO_APPROVED = "PO_AUTO_APPROVED",

  // Negotiation
  PO_COUNTER_PROPOSED = "PO_COUNTER_PROPOSED",
  PO_COUNTER_ACCEPTED = "PO_COUNTER_ACCEPTED",
  PO_COUNTER_REJECTED = "PO_COUNTER_REJECTED",

  // Logistics
  GOODS_SHIPPED = "GOODS_SHIPPED",
  DELIVERY_MARKED = "DELIVERY_MARKED",
  DELIVERY_VERIFIED = "DELIVERY_VERIFIED",
  DELIVERY_DISPUTED = "DELIVERY_DISPUTED",

  // Financial verification
  OBLIGATION_ACKNOWLEDGED = "OBLIGATION_ACKNOWLEDGED",

  // Payment locks
  PAYMENT_LOCK_CONFIRMED = "PAYMENT_LOCK_CONFIRMED",
  PAYMENT_LOCK_RELEASED = "PAYMENT_LOCK_RELEASED",
  PAYMENT_LOCK_REFUNDED = "PAYMENT_LOCK_REFUNDED",

  // Liquidity / early payment
  EARLY_PAY_REQUESTED = "EARLY_PAY_REQUESTED",
  EARLY_PAY_FUNDED = "EARLY_PAY_FUNDED",
  EARLY_PAY_BLOCKED = "EARLY_PAY_BLOCKED",

  // Settlement
  SETTLEMENT_INITIATED = "SETTLEMENT_INITIATED",
  SETTLEMENT_COMPLETED = "SETTLEMENT_COMPLETED",

  // Disputes
  DISPUTE_RAISED = "DISPUTE_RAISED",
  DISPUTE_EVIDENCE_SUBMITTED = "DISPUTE_EVIDENCE_SUBMITTED",
  DISPUTE_UNDER_REVIEW = "DISPUTE_UNDER_REVIEW",
  DISPUTE_RESOLVED = "DISPUTE_RESOLVED",

  // Evidence
  EVIDENCE_UPLOADED = "EVIDENCE_UPLOADED",

  // Risk
  EXPOSURE_SNAPSHOT = "EXPOSURE_SNAPSHOT",
}

export enum EntityType {
  PURCHASE_ORDER = "PURCHASE_ORDER",
  PAYMENT_LOCK = "PAYMENT_LOCK",
  EARLY_PAYMENT = "EARLY_PAYMENT",
  SETTLEMENT = "SETTLEMENT",
}

// ── Acceptance Type ──────────────────────────────────────────
export enum AcceptanceType {
  BUYER_CONFIRMATION = "BUYER_CONFIRMATION",
  AUTO_ACCEPT = "AUTO_ACCEPT",
}
