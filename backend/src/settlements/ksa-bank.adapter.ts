import { Injectable, Logger } from "@nestjs/common";
import {
  SettlementAdapter,
  SettlementCurrency,
  TransferStatus,
  TransferResult,
  ReserveFundsInput,
  ReleaseFundsInput,
  TransferFundsInput,
  RefundInput,
  ReconcileInput,
  ReconcileResult,
} from "./settlement-adapter.interface";

/**
 * KSA Bank Transfer Adapter
 *
 * Simulates integration with KSA bank rails (SARIE / partner bank API).
 * In production this would call the partner bank's REST API; for the
 * pilot it uses deterministic mock logic so we can demonstrate the
 * adapter pattern without real bank credentials.
 *
 * Behaviour:
 *   - All amounts are in halalah (1 SAR = 100 halalah).
 *   - References are prefixed with SARIE-.
 *   - Transfers above a configurable threshold go through SARIE
 *     (Saudi Arabian Riyal Interbank Express), otherwise domestic ACH.
 *   - A 200ms delay simulates network latency.
 *   - Accounts whose IBAN starts with "SA00FAIL" will trigger failure
 *     (useful for testing error paths).
 */
@Injectable()
export class KSABankTransferAdapter implements SettlementAdapter {
  readonly name = "KSA_BANK";
  readonly supportedCurrencies: SettlementCurrency[] = ["SAR"];

  private readonly logger = new Logger(KSABankTransferAdapter.name);

  /** SARIE threshold: amounts ≥ 20,000 SAR (2,000,000 halalah) use RTGS */
  private readonly SARIE_THRESHOLD = 2_000_000;

  /** In-memory tracking of references (production: persisted in DB + partner API queries) */
  private refs = new Map<
    string,
    {
      status: TransferStatus;
      amount: number;
      rail: "SARIE" | "ACH";
      processedAt: Date;
      payerIban?: string;
      recipientIban?: string;
    }
  >();

  // ── helpers ──────────────────────────────────────────────

  private generateRef(prefix: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `SARIE-${prefix}-${ts}-${rand}`;
  }

  private selectRail(amount: number): "SARIE" | "ACH" {
    return amount >= this.SARIE_THRESHOLD ? "SARIE" : "ACH";
  }

  private async simulateLatency(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  private shouldFail(accountRef?: string): boolean {
    return !!accountRef && accountRef.startsWith("SA00FAIL");
  }

  // ── reserveFunds ─────────────────────────────────────────

  async reserveFunds(input: ReserveFundsInput): Promise<TransferResult> {
    await this.simulateLatency();
    const ref = this.generateRef("RSV");
    const rail = this.selectRail(input.amount);

    if (this.shouldFail(input.payerAccountRef)) {
      this.logger.warn(`Reserve failed for ${ref} — bad payer account`);
      this.refs.set(ref, {
        status: TransferStatus.FAILED,
        amount: input.amount,
        rail,
        processedAt: new Date(),
        payerIban: input.payerAccountRef,
      });
      return {
        externalRef: ref,
        status: TransferStatus.FAILED,
        processedAt: new Date(),
        failureReason: "Bank rejected hold request — invalid account",
        rawResponse: { rail, errorCode: "ACCT_INVALID" },
      };
    }

    this.logger.log(`Reserved ${input.amount} halalah via ${rail} → ${ref}`);
    this.refs.set(ref, {
      status: TransferStatus.RESERVED,
      amount: input.amount,
      rail,
      processedAt: new Date(),
      payerIban: input.payerAccountRef,
    });

    return {
      externalRef: ref,
      status: TransferStatus.RESERVED,
      processedAt: new Date(),
      rawResponse: { rail, holdId: ref },
    };
  }

  // ── releaseFunds ─────────────────────────────────────────

  async releaseFunds(input: ReleaseFundsInput): Promise<TransferResult> {
    await this.simulateLatency();
    const ref = this.generateRef("REL");
    const rail = this.selectRail(input.amount);

    if (this.shouldFail(input.recipientAccountRef)) {
      this.logger.warn(`Release failed for ${ref} — bad recipient account`);
      this.refs.set(ref, {
        status: TransferStatus.FAILED,
        amount: input.amount,
        rail,
        processedAt: new Date(),
        recipientIban: input.recipientAccountRef,
      });
      return {
        externalRef: ref,
        status: TransferStatus.FAILED,
        processedAt: new Date(),
        failureReason: "Bank rejected transfer — invalid recipient account",
        rawResponse: { rail, errorCode: "RCPT_INVALID" },
      };
    }

    // Mark original reservation as completed
    const reservation = this.refs.get(input.reservationRef);
    if (reservation) reservation.status = TransferStatus.COMPLETED;

    this.logger.log(`Released ${input.amount} halalah via ${rail} → ${ref}`);
    this.refs.set(ref, {
      status: TransferStatus.COMPLETED,
      amount: input.amount,
      rail,
      processedAt: new Date(),
      recipientIban: input.recipientAccountRef,
    });

    return {
      externalRef: ref,
      status: TransferStatus.COMPLETED,
      processedAt: new Date(),
      rawResponse: { rail, transferId: ref },
    };
  }

  // ── transferFunds ────────────────────────────────────────

  async transferFunds(input: TransferFundsInput): Promise<TransferResult> {
    await this.simulateLatency();
    const ref = this.generateRef("TRF");
    const rail = this.selectRail(input.amount);

    if (
      this.shouldFail(input.fromAccountRef) ||
      this.shouldFail(input.toAccountRef)
    ) {
      this.refs.set(ref, {
        status: TransferStatus.FAILED,
        amount: input.amount,
        rail,
        processedAt: new Date(),
      });
      return {
        externalRef: ref,
        status: TransferStatus.FAILED,
        processedAt: new Date(),
        failureReason: "Bank rejected direct transfer",
        rawResponse: { rail, errorCode: "TRF_REJECTED" },
      };
    }

    this.logger.log(
      `Direct transfer ${input.amount} halalah via ${rail} → ${ref}`,
    );
    this.refs.set(ref, {
      status: TransferStatus.COMPLETED,
      amount: input.amount,
      rail,
      processedAt: new Date(),
    });

    return {
      externalRef: ref,
      status: TransferStatus.COMPLETED,
      processedAt: new Date(),
      rawResponse: { rail, transferId: ref },
    };
  }

  // ── refund ───────────────────────────────────────────────

  async refund(input: RefundInput): Promise<TransferResult> {
    await this.simulateLatency();
    const ref = this.generateRef("RFD");
    const rail = this.selectRail(input.amount);

    // Mark original reservation as refunded
    const reservation = this.refs.get(input.reservationRef);
    if (reservation) reservation.status = TransferStatus.REFUNDED;

    this.logger.log(`Refund ${input.amount} halalah via ${rail} → ${ref}`);
    this.refs.set(ref, {
      status: TransferStatus.REFUNDED,
      amount: input.amount,
      rail,
      processedAt: new Date(),
      recipientIban: input.recipientAccountRef,
    });

    return {
      externalRef: ref,
      status: TransferStatus.REFUNDED,
      processedAt: new Date(),
      rawResponse: { rail, refundId: ref },
    };
  }

  // ── reconcile ────────────────────────────────────────────

  async reconcile(input: ReconcileInput): Promise<ReconcileResult> {
    await this.simulateLatency();

    const record = this.refs.get(input.externalRef);
    if (!record) {
      return {
        externalRef: input.externalRef,
        status: TransferStatus.FAILED,
        failureReason: "Reference not found in bank system",
      };
    }

    return {
      externalRef: input.externalRef,
      status: record.status,
      confirmedAt: record.processedAt,
      rawResponse: { rail: record.rail },
    };
  }
}
