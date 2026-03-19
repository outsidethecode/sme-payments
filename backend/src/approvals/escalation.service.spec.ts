import { Test, TestingModule } from "@nestjs/testing";
import { EscalationService } from "./escalation.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

describe("EscalationService", () => {
  let service: EscalationService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;
  let featureFlags: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      approvalRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({ id: "evt-1" }),
    };

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
        { provide: FeatureFlagService, useValue: featureFlags },
      ],
    }).compile();

    service = module.get<EscalationService>(EscalationService);
  });

  describe("processEscalations", () => {
    it("should skip when feature flag is disabled", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      await service.processEscalations();

      expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
    });

    it("should do nothing when no overdue requests exist", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);

      await service.processEscalations();

      expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
      expect(ledger.logEvent).not.toHaveBeenCalled();
    });

    it("should escalate overdue PENDING requests", async () => {
      const overdueRequest = {
        id: "req-1",
        entityType: "PURCHASE_ORDER",
        entityId: "po-1",
        escalateAfter: new Date(Date.now() - 3600_000), // 1h ago
        policyRule: {
          id: "rule-1",
          name: "High Value PO",
          requiredRoles: ["FINANCE", "APPROVER"],
        },
      };

      prisma.approvalRequest.findMany.mockResolvedValue([overdueRequest]);
      prisma.approvalRequest.update.mockResolvedValue({
        ...overdueRequest,
        status: "ESCALATED",
      });

      await service.processEscalations();

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
        where: { id: "req-1" },
        data: { status: "ESCALATED" },
      });
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "APPROVAL_ESCALATED",
          entityType: "PURCHASE_ORDER",
          entityId: "po-1",
          actorId: "SYSTEM",
          payload: expect.objectContaining({
            approvalRequestId: "req-1",
            originalRoles: ["FINANCE", "APPROVER"],
            escalatedRoles: expect.arrayContaining([
              "FINANCE",
              "APPROVER",
              "OWNER",
            ]),
          }),
        }),
      );
    });

    it("should handle errors per-request without stopping batch", async () => {
      const requests = [
        {
          id: "req-1",
          entityType: "PO",
          entityId: "po-1",
          escalateAfter: new Date(Date.now() - 1000),
          policyRule: { id: "r1", name: "P1", requiredRoles: [] },
        },
        {
          id: "req-2",
          entityType: "PO",
          entityId: "po-2",
          escalateAfter: new Date(Date.now() - 1000),
          policyRule: { id: "r2", name: "P2", requiredRoles: ["FINANCE"] },
        },
      ];

      prisma.approvalRequest.findMany.mockResolvedValue(requests);
      prisma.approvalRequest.update
        .mockRejectedValueOnce(new Error("DB failure"))
        .mockResolvedValueOnce({ status: "ESCALATED" });

      await service.processEscalations();

      // Second request should still be processed
      expect(prisma.approvalRequest.update).toHaveBeenCalledTimes(2);
    });
  });

  describe("processExpiries", () => {
    it("should skip when feature flag is disabled", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      await service.processExpiries();

      expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
    });

    it("should do nothing when no expired requests exist", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);

      await service.processExpiries();

      expect(prisma.approvalRequest.updateMany).not.toHaveBeenCalled();
    });

    it("should bulk-expire past-due requests", async () => {
      const expired = [
        { id: "req-1", entityType: "PO", entityId: "po-1" },
        { id: "req-2", entityType: "PO", entityId: "po-2" },
      ];
      prisma.approvalRequest.findMany.mockResolvedValue(expired);
      prisma.approvalRequest.updateMany.mockResolvedValue({ count: 2 });

      await service.processExpiries();

      expect(prisma.approvalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["req-1", "req-2"] } },
        data: expect.objectContaining({ status: "EXPIRED" }),
      });
      expect(ledger.logEvent).toHaveBeenCalledTimes(2);
    });
  });
});
