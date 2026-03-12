import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  SETTLEMENT_ADAPTER,
  SettlementAdapter,
  TransferStatus,
} from "./settlement-adapter.interface";

// ── Types ────────────────────────────────────────────────────

export interface ReconciliationAlert {
  /** PaymentInstrument id (if instrument mismatch) */
  instrumentId?: string;
  /** Settlement id (if settlement mismatch) */
  settlementId?: string;
  /** What our platform thinks the status is */
  expected: string;
  /** What the bank/adapter reports */
  actual: string;
  /** Bank external reference */
  externalRef: string;
  /** Human-readable reason */
  reason: string;
}

export interface ReconciliationReportResult {
  id: string;
  runAt: Date;
  totalChecked: number;
  matched: number;
  mismatches: number;
  alerts: ReconciliationAlert[];
  ledgerBalance: number | null;
  bankBalance: number | null;
  variance: number | null;
}

// ── Configurable constants ───────────────────────────────────

/** Default reconciliation interval in minutes (overridden by env) */
const DEFAULT_INTERVAL_MINUTES = 60;

/** Instruments stuck in a transitional state longer than this are flagged */
const STALE_THRESHOLD_MINUTES = 30;

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(SETTLEMENT_ADAPTER)
    private readonly adapter: SettlementAdapter,
  ) {}

  // ── Scheduled cron job ─────────────────────────────────────

  /**
   * Runs every hour by default.
   * Frequency is controlled by RECONCILIATION_INTERVAL_MINUTES env var;
   * however @Cron requires a static expression, so we use EVERY_HOUR
   * and early-return if the configured interval hasn't elapsed.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const intervalMinutes = parseInt(
      process.env.RECONCILIATION_INTERVAL_MINUTES ??
        String(DEFAULT_INTERVAL_MINUTES),
      10,
    );

    // Check last run time to respect custom interval
    const lastReport = await this.prisma.reconciliationReport.findFirst({
      orderBy: { runAt: "desc" },
      select: { runAt: true },
    });

    if (lastReport) {
      const elapsed = (Date.now() - lastReport.runAt.getTime()) / 1000 / 60;
      if (elapsed < intervalMinutes) {
        this.logger.debug(
          `Skipping reconciliation: last run ${elapsed.toFixed(1)}m ago (interval: ${intervalMinutes}m)`,
        );
        return;
      }
    }

    this.logger.log("Starting scheduled reconciliation run…");
    await this.runReconciliation();
  }

  // ── Core reconciliation logic ──────────────────────────────

  /**
   * The main reconciliation engine. Can be invoked by cron or manually.
   *
   * Steps:
   *   1. Gather all instruments in transitional states (LOCK_REQUESTED, SETTLEMENT_PENDING)
   *   2. Gather all settlements in PROCESSING state
   *   3. For each item with an externalRef, query the adapter
   *   4. Compare rail status with platform status — record matches/mismatches
   *   5. Flag stale operations (stuck > 30 minutes in transitional state)
   *   6. Compute ledger balance (sum of LOCKED instruments)
   *   7. Persist ReconciliationReport
   *   8. Log BANK_RECONCILIATION_COMPLETED ledger event
   */
  async runReconciliation(): Promise<ReconciliationReportResult> {
    const runAt = new Date();
    const alerts: ReconciliationAlert[] = [];
    let totalChecked = 0;
    let matched = 0;
    let mismatches = 0;

    // ── Step 1: transitional instruments ─────────────────────

    const transitionalInstruments =
      await this.prisma.paymentInstrument.findMany({
        where: {
          status: { in: ["LOCK_REQUESTED", "SETTLEMENT_PENDING"] },
        },
      });

    for (const instrument of transitionalInstruments) {
      totalChecked++;

      // Check for stale operations
      const ageMinutes =
        (runAt.getTime() - instrument.createdAt.getTime()) / 1000 / 60;

      if (ageMinutes > STALE_THRESHOLD_MINUTES) {
        mismatches++;
        alerts.push({
          instrumentId: instrument.id,
          expected: instrument.status,
          actual: "STALE",
          externalRef: instrument.bankReference ?? "N/A",
          reason: `Instrument stuck in ${instrument.status} for ${Math.round(ageMinutes)} minutes (threshold: ${STALE_THRESHOLD_MINUTES}m)`,
        });
        continue;
      }

      // If there's a bank reference, reconcile with the adapter
      if (instrument.bankReference) {
        try {
          const railResult = await this.adapter.reconcile({
            externalRef: instrument.bankReference,
          });

          const reconciled = this.reconcileInstrument(instrument, railResult);
          if (reconciled.match) {
            matched++;
          } else {
            mismatches++;
            alerts.push(reconciled.alert!);
          }
        } catch (err: any) {
          mismatches++;
          alerts.push({
            instrumentId: instrument.id,
            expected: instrument.status,
            actual: "ERROR",
            externalRef: instrument.bankReference,
            reason: `Adapter error: ${err.message ?? "unknown"}`,
          });
        }
      } else {
        // No bank reference yet — count as checked but no match/mismatch
        matched++;
      }
    }

    // ── Step 2: PROCESSING settlements ───────────────────────

    const processingSettlements = await this.prisma.settlement.findMany({
      where: { status: "PROCESSING" },
    });

    for (const settlement of processingSettlements) {
      totalChecked++;

      if (!settlement.externalRef) {
        matched++;
        continue;
      }

      try {
        const railResult = await this.adapter.reconcile({
          externalRef: settlement.externalRef,
        });

        const reconciled = this.reconcileSettlement(settlement, railResult);
        if (reconciled.match) {
          matched++;
        } else {
          mismatches++;
          alerts.push(reconciled.alert!);
        }
      } catch (err: any) {
        mismatches++;
        alerts.push({
          settlementId: settlement.id,
          expected: settlement.status,
          actual: "ERROR",
          externalRef: settlement.externalRef,
          reason: `Adapter error: ${err.message ?? "unknown"}`,
        });
      }
    }

    // ── Step 3: compute ledger balance ───────────────────────

    const lockedAgg = await this.prisma.paymentInstrument.aggregate({
      where: { status: "LOCKED" },
      _sum: { amount: true },
    });
    const ledgerBalance = lockedAgg._sum.amount ?? 0;

    // bankBalance is only available if the adapter supports it;
    // for now we leave it null (future adapters can expose this).
    const bankBalance: number | null = null;
    const variance = bankBalance !== null ? ledgerBalance - bankBalance : null;

    // ── Step 4: persist report ───────────────────────────────

    const report = await this.prisma.reconciliationReport.create({
      data: {
        runAt,
        totalChecked,
        matched,
        mismatches,
        alerts: alerts as any,
        ledgerBalance,
        bankBalance,
        variance,
      },
    });

    // ── Step 5: log ledger event ─────────────────────────────

    // Use the first admin user as the actor (system-initiated)
    const adminUser = await this.prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (adminUser) {
      await this.ledger.logEvent({
        entityType: "RECONCILIATION",
        entityId: report.id,
        eventType: "BANK_RECONCILIATION_COMPLETED",
        actorId: adminUser.id,
        actorRole: "SYSTEM",
        payload: {
          reportId: report.id,
          runAt: runAt.toISOString(),
          totalChecked,
          matched,
          mismatches,
          alertCount: alerts.length,
          ledgerBalance,
          variance,
          source: "RECONCILIATION_ENGINE",
        },
      });
    }

    this.logger.log(
      `Reconciliation complete: ${totalChecked} checked, ${matched} matched, ${mismatches} mismatches`,
    );

    return {
      id: report.id,
      runAt,
      totalChecked,
      matched,
      mismatches,
      alerts,
      ledgerBalance,
      bankBalance,
      variance,
    };
  }

  // ── Query helpers ──────────────────────────────────────────

  /** Get paginated reconciliation reports (most recent first) */
  async getReports(limit = 20, offset = 0) {
    return this.prisma.reconciliationReport.findMany({
      orderBy: { runAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  /** Get the most recent reconciliation report */
  async getLatest() {
    return this.prisma.reconciliationReport.findFirst({
      orderBy: { runAt: "desc" },
    });
  }

  // ── Private reconciliation helpers ─────────────────────────

  /**
   * Compare an instrument's platform status against the rail status.
   * Returns { match: true } if consistent, or { match: false, alert } if mismatch.
   */
  private reconcileInstrument(
    instrument: { id: string; status: string; bankReference: string | null },
    railResult: { status: TransferStatus; externalRef: string },
  ): { match: boolean; alert?: ReconciliationAlert } {
    // Expected rail status given our platform status
    const expectedRailStatus = this.instrumentStatusToExpectedRail(
      instrument.status,
    );

    if (expectedRailStatus.includes(railResult.status)) {
      return { match: true };
    }

    return {
      match: false,
      alert: {
        instrumentId: instrument.id,
        expected: instrument.status,
        actual: railResult.status,
        externalRef: railResult.externalRef,
        reason: `Instrument ${instrument.id} platform status "${instrument.status}" inconsistent with rail status "${railResult.status}"`,
      },
    };
  }

  /**
   * Compare a settlement's platform status against the rail status.
   */
  private reconcileSettlement(
    settlement: { id: string; status: string; externalRef: string | null },
    railResult: { status: TransferStatus; externalRef: string },
  ): { match: boolean; alert?: ReconciliationAlert } {
    const expectedRailStatus = this.settlementStatusToExpectedRail(
      settlement.status,
    );

    if (expectedRailStatus.includes(railResult.status)) {
      return { match: true };
    }

    return {
      match: false,
      alert: {
        settlementId: settlement.id,
        expected: settlement.status,
        actual: railResult.status,
        externalRef: railResult.externalRef,
        reason: `Settlement ${settlement.id} platform status "${settlement.status}" inconsistent with rail status "${railResult.status}"`,
      },
    };
  }

  /**
   * Map instrument platform status → acceptable rail statuses.
   *
   * LOCK_REQUESTED  → rail may still be PENDING or RESERVED
   * SETTLEMENT_PENDING → rail may be PENDING or COMPLETED
   */
  private instrumentStatusToExpectedRail(status: string): TransferStatus[] {
    switch (status) {
      case "LOCK_REQUESTED":
        return [TransferStatus.PENDING, TransferStatus.RESERVED];
      case "SETTLEMENT_PENDING":
        return [TransferStatus.PENDING, TransferStatus.COMPLETED];
      default:
        return [];
    }
  }

  /**
   * Map settlement platform status → acceptable rail statuses.
   *
   * PROCESSING → rail may be PENDING or COMPLETED
   */
  private settlementStatusToExpectedRail(status: string): TransferStatus[] {
    switch (status) {
      case "PROCESSING":
        return [TransferStatus.PENDING, TransferStatus.COMPLETED];
      default:
        return [];
    }
  }
}
