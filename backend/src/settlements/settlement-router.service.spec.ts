import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { SettlementRouterService } from "./settlement-router.service";
import { PrismaService } from "../prisma/prisma.service";
import { OrganisationsService } from "../organisations/organisations.service";

describe("SettlementRouterService", () => {
  let service: SettlementRouterService;

  const mockPrisma = {
    purchaseOrder: { findUnique: jest.fn() },
    paymentInstrument: { findUnique: jest.fn() },
    earlyPaymentRequest: { findUnique: jest.fn() },
  };

  const mockOrgs = {
    getOrgByUserId: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementRouterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrganisationsService, useValue: mockOrgs },
      ],
    }).compile();

    service = module.get(SettlementRouterService);
  });

  // ── resolveSettlement ─────────────────────────────────

  describe("resolveSettlement", () => {
    const basePo = {
      id: "po-1",
      amount: 100_000,
      currency: "GBP",
      supplierId: "supplier-1",
    };

    const baseInstrument = {
      id: "instr-1",
      purchaseOrderId: "po-1",
      settlementBeneficiary: "SUPPLIER",
    };

    it("should resolve to SUPPLIER when beneficiary is SUPPLIER", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePo);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(baseInstrument);
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
      mockOrgs.getOrgByUserId.mockResolvedValue({
        id: "org-s",
        bankIban: "GB123",
      });

      const plan = await service.resolveSettlement("po-1");

      expect(plan.recipient).toBe("SUPPLIER");
      expect(plan.recipientUserId).toBe("supplier-1");
      expect(plan.recipientBankIban).toBe("GB123");
      expect(plan.grossAmount).toBe(100_000);
      // Fee: Math.round(100000 * 50 / 10000) = 500
      expect(plan.platformFee).toBe(500);
      expect(plan.feeBps).toBe(50);
      expect(plan.netAmount).toBe(99_500);
      expect(plan.currency).toBe("GBP");
      expect(plan.earlyPaymentRequestId).toBeUndefined();
    });

    it("should resolve to LIQUIDITY_PROVIDER when beneficiary is flipped", async () => {
      const lpInstrument = {
        ...baseInstrument,
        settlementBeneficiary: "LIQUIDITY_PROVIDER",
      };
      const earlyPay = {
        id: "ep-1",
        status: "FUNDED",
        liquidityPartnerId: "lp-1",
      };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePo);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(lpInstrument);
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(earlyPay);
      mockOrgs.getOrgByUserId.mockResolvedValue({
        id: "org-lp",
        bankIban: "SA456",
      });

      const plan = await service.resolveSettlement("po-1");

      expect(plan.recipient).toBe("LIQUIDITY_PROVIDER");
      expect(plan.recipientUserId).toBe("lp-1");
      expect(plan.recipientBankIban).toBe("SA456");
      expect(plan.earlyPaymentRequestId).toBe("ep-1");
    });

    it("should fall back to SUPPLIER when LP beneficiary but no LP partner", async () => {
      const lpInstrument = {
        ...baseInstrument,
        settlementBeneficiary: "LIQUIDITY_PROVIDER",
      };
      const earlyPay = {
        id: "ep-1",
        status: "REQUESTED",
        liquidityPartnerId: null,
      };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePo);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(lpInstrument);
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(earlyPay);
      mockOrgs.getOrgByUserId.mockResolvedValue({
        id: "org-s",
        bankIban: "GB123",
      });

      const plan = await service.resolveSettlement("po-1");

      expect(plan.recipient).toBe("SUPPLIER");
      expect(plan.recipientUserId).toBe("supplier-1");
    });

    it("should throw if PO not found", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(service.resolveSettlement("missing")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw if no payment instrument", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePo);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(null);

      await expect(service.resolveSettlement("po-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should use SAR currency from PO", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePo,
        currency: "SAR",
      });
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(baseInstrument);
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
      mockOrgs.getOrgByUserId.mockResolvedValue({ bankIban: null });

      const plan = await service.resolveSettlement("po-1");

      expect(plan.currency).toBe("SAR");
    });

    it("should default to GBP when currency is null", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePo,
        currency: null,
      });
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(baseInstrument);
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
      mockOrgs.getOrgByUserId.mockResolvedValue({ bankIban: null });

      const plan = await service.resolveSettlement("po-1");

      expect(plan.currency).toBe("GBP");
    });
  });

  // ── resolveDisputeSettlement ──────────────────────────

  describe("resolveDisputeSettlement", () => {
    const basePo = {
      id: "po-1",
      amount: 100_000,
      currency: "GBP",
      buyerId: "buyer-1",
      supplierId: "supplier-1",
      paymentLock: { id: "lock-1", status: "LOCKED", openBankingRef: "ref-1" },
    };

    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePo);
    });

    it("FULL_REFUND: should produce a single REFUND action", async () => {
      const plan = await service.resolveDisputeSettlement(
        "po-1",
        "FULL_REFUND",
        undefined,
        "Goods not as described",
      );

      expect(plan.outcome).toBe("FULL_REFUND");
      expect(plan.newPoStatus).toBe("CANCELLED");
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        type: "REFUND",
        recipientUserId: "buyer-1",
        amount: 100_000,
        currency: "GBP",
        reason: "Dispute full refund: Goods not as described",
      });
    });

    it("PARTIAL_REFUND: should produce REFUND action (remainder settlement deferred)", async () => {
      const plan = await service.resolveDisputeSettlement(
        "po-1",
        "PARTIAL_REFUND",
        40_000,
        "Minor defects",
      );

      expect(plan.outcome).toBe("PARTIAL_REFUND");
      expect(plan.newPoStatus).toBe("SETTLED");
      expect(plan.actions).toHaveLength(1);

      // Refund to buyer
      expect(plan.actions[0]).toEqual({
        type: "REFUND",
        recipientUserId: "buyer-1",
        amount: 40_000,
        currency: "GBP",
        reason: "Dispute partial refund: Minor defects",
      });
    });

    it("PARTIAL_REFUND: should throw if refundAmount <= 0", async () => {
      await expect(
        service.resolveDisputeSettlement("po-1", "PARTIAL_REFUND", 0),
      ).rejects.toThrow(BadRequestException);
    });

    it("PARTIAL_REFUND: should throw if refundAmount >= PO amount", async () => {
      await expect(
        service.resolveDisputeSettlement("po-1", "PARTIAL_REFUND", 100_000),
      ).rejects.toThrow(BadRequestException);
    });

    it("RELEASE_TO_SUPPLIER: should produce a SETTLE action with correct fee", async () => {
      mockOrgs.getOrgByUserId.mockResolvedValue({
        id: "org-s",
        bankIban: "GB123",
      });

      const plan = await service.resolveDisputeSettlement(
        "po-1",
        "RELEASE_TO_SUPPLIER",
      );

      expect(plan.outcome).toBe("RELEASE_TO_SUPPLIER");
      expect(plan.newPoStatus).toBe("VERIFIED");
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        type: "SETTLE",
        recipientUserId: "supplier-1",
        recipientBankIban: "GB123",
        grossAmount: 100_000,
        platformFee: 500,
        feeBps: 50,
        netAmount: 99_500,
        currency: "GBP",
      });
    });

    it("REWORK: should produce a NOOP action", async () => {
      const plan = await service.resolveDisputeSettlement("po-1", "REWORK");

      expect(plan.outcome).toBe("REWORK");
      expect(plan.newPoStatus).toBe("FULFILLMENT");
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        type: "NOOP",
        reason: "PO returned to FULFILLMENT — no settlement action",
      });
    });

    it("should produce NOOP when no locked funds for FULL_REFUND", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePo,
        paymentLock: { id: "lock-1", status: "RELEASED" },
      });

      const plan = await service.resolveDisputeSettlement(
        "po-1",
        "FULL_REFUND",
      );

      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        type: "NOOP",
        reason: "No locked funds to refund",
      });
    });

    it("should produce NOOP when no locked funds for RELEASE_TO_SUPPLIER", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePo,
        paymentLock: null,
      });

      const plan = await service.resolveDisputeSettlement(
        "po-1",
        "RELEASE_TO_SUPPLIER",
      );

      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        type: "NOOP",
        reason: "No locked funds to release",
      });
    });

    it("should throw if PO not found", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveDisputeSettlement("missing", "FULL_REFUND"),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
