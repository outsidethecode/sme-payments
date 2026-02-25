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
  SENT = "SENT",
  ACCEPTED = "ACCEPTED",
  IN_PROGRESS = "IN_PROGRESS",
  DELIVERED = "DELIVERED",
  VERIFIED = "VERIFIED",
  SETTLED = "SETTLED",
  DISPUTED = "DISPUTED",
  CANCELLED = "CANCELLED",
}

/** Valid status transitions keyed by current status */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  [POStatus.DRAFT]: [POStatus.SENT, POStatus.CANCELLED],
  [POStatus.SENT]: [POStatus.ACCEPTED, POStatus.CANCELLED],
  [POStatus.ACCEPTED]: [POStatus.IN_PROGRESS],
  [POStatus.IN_PROGRESS]: [POStatus.DELIVERED],
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
  PO_CREATED = "PO_CREATED",
  PO_SENT = "PO_SENT",
  PO_ACCEPTED = "PO_ACCEPTED",
  PO_CANCELLED = "PO_CANCELLED",
  PAYMENT_LOCK_INITIATED = "PAYMENT_LOCK_INITIATED",
  PAYMENT_LOCK_CONFIRMED = "PAYMENT_LOCK_CONFIRMED",
  PAYMENT_LOCK_RELEASED = "PAYMENT_LOCK_RELEASED",
  PAYMENT_LOCK_REFUNDED = "PAYMENT_LOCK_REFUNDED",
  EARLY_PAY_REQUESTED = "EARLY_PAY_REQUESTED",
  EARLY_PAY_APPROVED = "EARLY_PAY_APPROVED",
  EARLY_PAY_REJECTED = "EARLY_PAY_REJECTED",
  DELIVERY_MARKED = "DELIVERY_MARKED",
  DELIVERY_VERIFIED = "DELIVERY_VERIFIED",
  DELIVERY_AUTO_VERIFIED = "DELIVERY_AUTO_VERIFIED",
  DELIVERY_DISPUTED = "DELIVERY_DISPUTED",
  SETTLEMENT_INITIATED = "SETTLEMENT_INITIATED",
  SETTLEMENT_COMPLETED = "SETTLEMENT_COMPLETED",
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
