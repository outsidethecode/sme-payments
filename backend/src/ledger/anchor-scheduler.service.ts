import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnchorService } from "./anchor.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Automatic Ledger Anchoring Scheduler.
 *
 * Periodically creates global integrity snapshots (Merkle tree → Rekor).
 * Controlled by ANCHOR_INTERVAL_MINUTES env variable:
 *   - 0 or unset  → disabled (manual anchoring only via POST /ledger/anchor)
 *   - N > 0       → auto-anchor every N minutes if new events exist
 *
 * The scheduler is smart: it skips anchoring if no new events have been
 * recorded since the last anchor, avoiding empty/duplicate snapshots.
 */
@Injectable()
export class AnchorSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorSchedulerService.name);
  private intervalMinutes: number;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly anchorService: AnchorService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.intervalMinutes = parseInt(
      this.config.get<string>("ANCHOR_INTERVAL_MINUTES", "0"),
      10,
    );
  }

  onModuleInit() {
    if (this.intervalMinutes > 0) {
      const ms = this.intervalMinutes * 60_000;
      this.logger.log(
        `Auto-anchoring enabled: every ${this.intervalMinutes} minute(s)`,
      );
      this.intervalTimer = setInterval(() => this.tick(), ms);
    } else {
      this.logger.log(
        "Auto-anchoring disabled (ANCHOR_INTERVAL_MINUTES=0 or unset). Use POST /ledger/anchor for manual anchoring.",
      );
    }
  }

  onModuleDestroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      this.logger.log("Auto-anchoring timer cleared");
    }
  }

  /**
   * Called on each interval tick. Checks if there are new events since
   * the last anchor, and creates a new anchor if so.
   */
  private async tick() {
    try {
      // Check if there are events worth anchoring
      const lastAnchor = await this.anchorService.getLatestAnchor();
      const totalEvents = await this.prisma.eventLog.count();

      if (totalEvents === 0) {
        this.logger.debug("No events in ledger — skipping anchor");
        return;
      }

      if (lastAnchor && lastAnchor.eventCount >= totalEvents) {
        this.logger.debug(
          `No new events since last anchor (${totalEvents} events) — skipping`,
        );
        return;
      }

      this.logger.log(
        `Auto-anchoring: ${totalEvents} events (${lastAnchor ? `prev=${lastAnchor.eventCount}` : "first anchor"})`,
      );

      const result = await this.anchorService.createAnchor();

      this.logger.log(
        `Auto-anchor complete: ${result.merkleRoot.substring(0, 16)}... ` +
          `(${result.entityCount} entities` +
          `${result.externalAnchor ? `, ${result.externalAnchor.provider}` : ""})`,
      );
    } catch (err) {
      this.logger.error(`Auto-anchor failed: ${err}`);
    }
  }
}
