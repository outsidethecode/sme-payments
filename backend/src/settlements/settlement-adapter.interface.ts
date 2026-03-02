/**
 * Abstract Settlement Adapter Interface
 *
 * All settlement operations flow through this interface.
 * Implementations:
 *   - SimulatedAdapter    — wraps existing balance logic (demo mode)
 *   - KSABankTransferAdapter — integration with KSA bank rails (SARIE / partner API)
 *
 * Amounts are always in the smallest currency unit:
 *   GBP → pence  (1 GBP = 100 pence)
 *   SAR → halalah (1 SAR = 100 halalah)
 */

// ── Types ────────────────────────────────────────────────────

export type SettlementCurrency = "GBP" | "SAR";

export enum TransferStatus {
  /** Request accepted, processing not yet started */
  PENDING = "PENDING",
  /** Funds successfully reserved / held in escrow */
  RESERVED = "RESERVED",
  /** Transfer completed and confirmed */
  COMPLETED = "COMPLETED",
  /** Transfer failed — reason in `failureReason` */
  FAILED = "FAILED",
  /** Previously reserved funds returned to source */
  REFUNDED = "REFUNDED",
}

export interface TransferResult {
  /** Adapter-specific reference (e.g. Open Banking ref, SARIE ref) */
  externalRef: string;
  status: TransferStatus;
  /** ISO-8601 timestamp from the payment rail */
  processedAt: Date;
  /** Human-readable failure reason when status is FAILED */
  failureReason?: string;
  /** Raw response from the underlying rail (for audit) */
  rawResponse?: Record<string, unknown>;
}

export interface ReserveFundsInput {
  /** Internal purchase order ID */
  purchaseOrderId: string;
  /** Payer identifier (user or org ID) */
  payerId: string;
  /** Payer's bank reference (IBAN / account ref) */
  payerAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
  /** Free-text description for bank statement */
  description?: string;
}

export interface ReleaseFundsInput {
  /** The external reference returned by reserveFunds */
  reservationRef: string;
  purchaseOrderId: string;
  /** Recipient identifier */
  recipientId: string;
  /** Recipient's bank reference (IBAN / account ref) */
  recipientAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
  description?: string;
}

export interface TransferFundsInput {
  /** Direct transfer without prior reservation */
  purchaseOrderId: string;
  fromId: string;
  fromAccountRef?: string;
  toId: string;
  toAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
  description?: string;
}

export interface RefundInput {
  /** The external reference of the original reservation */
  reservationRef: string;
  purchaseOrderId: string;
  recipientId: string;
  recipientAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
  reason?: string;
}

export interface ReconcileInput {
  /** External reference to query status for */
  externalRef: string;
}

export interface ReconcileResult {
  externalRef: string;
  status: TransferStatus;
  confirmedAt?: Date;
  failureReason?: string;
  rawResponse?: Record<string, unknown>;
}

// ── Abstract Adapter ─────────────────────────────────────────

export const SETTLEMENT_ADAPTER = Symbol("SETTLEMENT_ADAPTER");

export interface SettlementAdapter {
  /** Unique name of this adapter (e.g. "SIMULATED", "KSA_BANK") */
  readonly name: string;

  /** Supported currencies */
  readonly supportedCurrencies: SettlementCurrency[];

  /**
   * Reserve / lock funds from a payer's account.
   * For simulated: debit User.balance.
   * For KSA bank: initiate a hold or pre-fund the escrow account.
   */
  reserveFunds(input: ReserveFundsInput): Promise<TransferResult>;

  /**
   * Release previously reserved funds to a recipient.
   * Completes the settlement — moves money to the payee.
   */
  releaseFunds(input: ReleaseFundsInput): Promise<TransferResult>;

  /**
   * Direct fund transfer (no prior reservation).
   * Used for LP → Supplier advance payments.
   */
  transferFunds(input: TransferFundsInput): Promise<TransferResult>;

  /**
   * Refund previously reserved funds back to the original payer.
   * Used when a PO is cancelled after payment lock.
   */
  refund(input: RefundInput): Promise<TransferResult>;

  /**
   * Query the status of an external reference (for reconciliation).
   * Returns the current state from the payment rail.
   */
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
}
