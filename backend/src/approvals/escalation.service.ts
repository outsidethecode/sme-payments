import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

/**
 * Cron-driven service that handles:
 * 1. Approval escalation — overdue PENDING → ESCALATED (widens required roles to include OWNER)
 * 2. Approval expiry — past-due PENDING/ESCALATED → EXPIRED
 *
 * Both are gated behind POLICY_ENGINE feature flag.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── Escalation: every 10 minutes ─────────────────────────

  @Cron(CronExpression.EVERY_10_MINUTES)
  async processEscalations() {
    const enabled = await this.featureFlags.isEnabled(
      FeatureFlag.POLICY_ENGINE,
    );
    if (!enabled) return;

    const overdue = await this.prisma.approvalRequest.findMany({
      where: {
        status: "PENDING",
        escalateAfter: { lt: new Date() },
      },
      include: {
        policyRule: {
          select: { id: true, name: true, requiredRoles: true },
        },
      },
    });

    if (overdue.length === 0) return;

    this.logger.log(
      `Processing ${overdue.length} overdue approval request(s) for escalation`,
    );

    for (const request of overdue) {
      try {
        const originalRoles =
          (request.policyRule.requiredRoles as string[]) || [];
        const escalatedRoles = [...new Set([...originalRoles, "OWNER"])];

        await this.prisma.approvalRequest.update({
          where: { id: request.id },
          data: { status: "ESCALATED" },
        });

        await this.ledger.logEvent({
          entityType: request.entityType,
          entityId: request.entityId,
          eventType: "APPROVAL_ESCALATED",
          actorId: "SYSTEM",
          actorRole: "SYSTEM",
          payload: {
            approvalRequestId: request.id,
            policyRuleName: request.policyRule.name,
            originalRoles,
            escalatedRoles,
            escalatedAt: new Date().toISOString(),
            escalateAfter: request.escalateAfter?.toISOString(),
          },
        });

        this.logger.log(
          `Escalated approval ${request.id} for ${request.entityType}:${request.entityId} — roles widened to ${escalatedRoles.join(", ")}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to escalate approval ${request.id}: ${err.message}`,
        );
      }
    }
  }

  // ── Expiry: every hour ────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async processExpiries() {
    const enabled = await this.featureFlags.isEnabled(
      FeatureFlag.POLICY_ENGINE,
    );
    if (!enabled) return;

    const expired = await this.prisma.approvalRequest.findMany({
      where: {
        status: { in: ["PENDING", "ESCALATED"] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true, entityType: true, entityId: true },
    });

    if (expired.length === 0) return;

    this.logger.log(`Expiring ${expired.length} overdue approval request(s)`);

    // Bulk update
    await this.prisma.approvalRequest.updateMany({
      where: {
        id: { in: expired.map((r) => r.id) },
      },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });

    // Log each expiry
    for (const request of expired) {
      this.ledger
        .logEvent({
          entityType: request.entityType,
          entityId: request.entityId,
          eventType: "APPROVAL_EXPIRED",
          actorId: "SYSTEM",
          actorRole: "SYSTEM",
          payload: {
            approvalRequestId: request.id,
            expiredAt: new Date().toISOString(),
          },
        })
        .catch((err) =>
          this.logger.warn(`Failed to log approval expiry: ${err.message}`),
        );
    }
  }
}
