import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

/** Default TTL for idempotency records: 24 hours */
const DEFAULT_TTL_HOURS = 24;

export interface CachedResponse {
  statusCode: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ttlHours =
      parseInt(this.config.get("IDEMPOTENCY_TTL_HOURS") ?? "", 10) ||
      DEFAULT_TTL_HOURS;
  }

  /**
   * Check whether a response is already cached for the given idempotency key.
   * Returns the cached response if found and not expired, otherwise null.
   */
  async check(key: string): Promise<CachedResponse | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { key },
    });

    if (!record) return null;

    // If expired, delete and treat as miss
    if (record.expiresAt < new Date()) {
      await this.prisma.idempotencyRecord
        .delete({ where: { key } })
        .catch(() => {
          /* already deleted by cron, ignore */
        });
      return null;
    }

    return {
      statusCode: record.statusCode,
      body: record.responseBody,
    };
  }

  /**
   * Record a successful response for an idempotency key.
   * Uses upsert to handle race conditions (two requests with same key arriving simultaneously).
   */
  async record(
    key: string,
    endpoint: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

    await this.prisma.idempotencyRecord.upsert({
      where: { key },
      create: {
        key,
        endpoint,
        statusCode,
        responseBody: responseBody as any,
        expiresAt,
      },
      update: {}, // no-op if already exists (first writer wins)
    });
  }

  /**
   * Remove expired idempotency records.
   * Runs hourly; disabled when IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES=0 (tests).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanup(): Promise<number> {
    const interval = parseInt(
      this.config.get("IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES") ?? "",
      10,
    );
    // Disable in tests (set to 0)
    if (interval === 0) return 0;

    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired idempotency records`);
    }

    return result.count;
  }
}
