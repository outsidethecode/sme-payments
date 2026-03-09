import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

describe("ApprovalsService", () => {
  let service: ApprovalsService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      approvalRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      approval: {
        create: jest.fn(),
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(ApprovalsService);
  });

  describe("createRequest", () => {
    it("should create an approval request with expiry", async () => {
      const input = {
        entityType: "PURCHASE_ORDER",
        entityId: "po-1",
        organisationId: "org-1",
        policyRuleId: "rule-1",
        requiredApprovals: 2,
        expiresInHours: 48,
      };
      prisma.approvalRequest.create.mockResolvedValue({
        id: "ar-1",
        ...input,
        status: "PENDING",
        currentApprovals: 0,
        approvals: [],
        policyRule: { id: "rule-1", name: "Test", requiredRoles: ["APPROVER"] },
      });

      const result = await service.createRequest(input);
      expect(result.id).toBe("ar-1");
      expect(result.status).toBe("PENDING");
    });
  });

  describe("submitDecision", () => {
    const basePendingRequest = {
      id: "ar-1",
      entityType: "PURCHASE_ORDER",
      entityId: "po-1",
      organisationId: "org-1",
      status: "PENDING",
      requiredApprovals: 2,
      currentApprovals: 0,
      expiresAt: null,
      policyRule: {
        id: "rule-1",
        name: "Large PO",
        requiredRoles: ["APPROVER", "FINANCE"],
      },
      approvals: [],
    };

    it("should record APPROVE and keep PENDING if not enough approvals", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(basePendingRequest);
      prisma.approval.create.mockResolvedValue({});
      prisma.approvalRequest.update.mockResolvedValue({
        ...basePendingRequest,
        currentApprovals: 1,
        status: "PENDING",
        approvals: [{ userId: "user-1", decision: "APPROVE" }],
      });

      const result = await service.submitDecision({
        approvalRequestId: "ar-1",
        userId: "user-1",
        orgRole: "APPROVER",
        decision: "APPROVE" as any,
      });

      expect(result.isComplete).toBe(false);
      expect(result.finalStatus).toBe("PENDING");
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "PO_APPROVAL_VOTE" }),
      );
    });

    it("should mark APPROVED when required count reached", async () => {
      const reqWith1Approval = {
        ...basePendingRequest,
        currentApprovals: 1,
        approvals: [{ userId: "user-1", decision: "APPROVE" }],
      };
      prisma.approvalRequest.findUnique.mockResolvedValue(reqWith1Approval);
      prisma.approval.create.mockResolvedValue({});
      prisma.approvalRequest.update.mockResolvedValue({
        ...reqWith1Approval,
        currentApprovals: 2,
        status: "APPROVED",
        resolvedAt: new Date(),
      });

      const result = await service.submitDecision({
        approvalRequestId: "ar-1",
        userId: "user-2",
        orgRole: "FINANCE",
        decision: "APPROVE" as any,
      });

      expect(result.isComplete).toBe(true);
      expect(result.finalStatus).toBe("APPROVED");
    });

    it("should immediately reject on REJECT decision", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(basePendingRequest);
      prisma.approval.create.mockResolvedValue({});
      prisma.approvalRequest.update.mockResolvedValue({
        ...basePendingRequest,
        status: "REJECTED",
        resolvedAt: new Date(),
      });

      const result = await service.submitDecision({
        approvalRequestId: "ar-1",
        userId: "user-1",
        orgRole: "APPROVER",
        decision: "REJECT" as any,
        comment: "Amount too high",
      });

      expect(result.isComplete).toBe(true);
      expect(result.finalStatus).toBe("REJECTED");
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "PO_APPROVAL_REJECTED" }),
      );
    });

    it("should throw if request not found", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.submitDecision({
          approvalRequestId: "missing",
          userId: "user-1",
          orgRole: "APPROVER",
          decision: "APPROVE" as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw if request already resolved", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...basePendingRequest,
        status: "APPROVED",
      });

      await expect(
        service.submitDecision({
          approvalRequestId: "ar-1",
          userId: "user-1",
          orgRole: "APPROVER",
          decision: "APPROVE" as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw if user already voted", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...basePendingRequest,
        approvals: [{ userId: "user-1", decision: "APPROVE" }],
      });

      await expect(
        service.submitDecision({
          approvalRequestId: "ar-1",
          userId: "user-1",
          orgRole: "APPROVER",
          decision: "APPROVE" as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw if user role not in requiredRoles", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(basePendingRequest);

      await expect(
        service.submitDecision({
          approvalRequestId: "ar-1",
          userId: "user-3",
          orgRole: "MEMBER",
          decision: "APPROVE" as any,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw if request has expired", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        ...basePendingRequest,
        expiresAt: new Date("2020-01-01"), // expired
      });
      prisma.approvalRequest.update.mockResolvedValue({});

      await expect(
        service.submitDecision({
          approvalRequestId: "ar-1",
          userId: "user-1",
          orgRole: "APPROVER",
          decision: "APPROVE" as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
