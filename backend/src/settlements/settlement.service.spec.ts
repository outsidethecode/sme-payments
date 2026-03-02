import { Test, TestingModule } from "@nestjs/testing";
import { SettlementService } from "./settlement.service";
import { SimulatedAdapter } from "./simulated.adapter";
import {
  SETTLEMENT_ADAPTER,
  TransferStatus,
} from "./settlement-adapter.interface";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

describe("SettlementService", () => {
  let service: SettlementService;
  let adapter: SimulatedAdapter;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentLock: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    settlement: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    platformFee: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockLedger = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        {
          provide: SETTLEMENT_ADAPTER,
          useFactory: () => {
            // Create a real SimulatedAdapter but with our mock prisma
            return new SimulatedAdapter(mockPrisma as any);
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get(SettlementService);
    adapter = module.get(SETTLEMENT_ADAPTER);
    prisma = module.get(PrismaService);
  });

  describe("getAdapterName", () => {
    it("should return SIMULATED for the simulated adapter", () => {
      expect(service.getAdapterName()).toBe("SIMULATED");
    });
  });

  describe("reserveForPO", () => {
    it("should reserve funds and create a payment lock", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 100_000 });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.paymentLock.create.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        amount: 50_000,
        status: "LOCKED",
      });

      const result = await service.reserveForPO({
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        currency: "GBP",
      });

      expect(result.paymentLockId).toBe("lock-1");
      expect(result.externalRef).toMatch(/^SIM-RSV-/);
      expect(result.status).toBe(TransferStatus.RESERVED);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "buyer-1" },
          data: { balance: { decrement: 50_000 } },
        }),
      );
    });

    it("should throw when buyer has insufficient balance", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 1_000 });

      await expect(
        service.reserveForPO({
          purchaseOrderId: "po-1",
          buyerId: "buyer-1",
          amount: 50_000,
          currency: "GBP",
        }),
      ).rejects.toThrow("Insufficient balance");
    });
  });

  describe("settlePO", () => {
    it("should release funds and create settlement record", async () => {
      mockPrisma.paymentLock.findUnique.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        status: "LOCKED",
        openBankingRef: "SIM-RSV-TEST",
      });

      // SimulatedAdapter.releaseFunds credits the user
      mockPrisma.user.update.mockResolvedValue({});

      // $transaction executes the callback
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === "function") return fn(mockPrisma);
        return Promise.all(fn);
      });

      mockPrisma.paymentLock.update.mockResolvedValue({});
      mockPrisma.settlement.create.mockResolvedValue({
        id: "settlement-1",
        amount: 49_750,
        type: "STANDARD",
        status: "COMPLETED",
      });
      mockPrisma.platformFee.create.mockResolvedValue({});

      const result = await service.settlePO({
        purchaseOrderId: "po-1",
        recipientId: "supplier-1",
        totalAmount: 50_000,
        feeBps: 50,
        currency: "GBP",
      });

      expect(result.settlementId).toBe("settlement-1");
      expect(result.feeAmount).toBe(250); // 50_000 * 50 / 10_000
      expect(result.netAmount).toBe(49_750);
      expect(result.externalRef).toMatch(/^SIM-REL-/);
    });

    it("should throw when no active lock exists", async () => {
      mockPrisma.paymentLock.findUnique.mockResolvedValue(null);

      await expect(
        service.settlePO({
          purchaseOrderId: "po-1",
          recipientId: "supplier-1",
          totalAmount: 50_000,
          feeBps: 50,
          currency: "GBP",
        }),
      ).rejects.toThrow("No active payment lock");
    });
  });

  describe("transferAdvance", () => {
    it("should transfer LP → Supplier advance and record settlement", async () => {
      // SimulatedAdapter.transferFunds checks sender balance then does debit+credit
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 500_000 });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]); // batch update results

      mockPrisma.settlement.create.mockResolvedValue({
        id: "adv-settle-1",
        type: "EARLY_PAY_ADVANCE",
      });

      const result = await service.transferAdvance({
        purchaseOrderId: "po-1",
        earlyPaymentRequestId: "ep-1",
        lpId: "lp-1",
        supplierId: "supplier-1",
        amount: 47_500,
        currency: "GBP",
      });

      expect(result.settlementId).toBe("adv-settle-1");
      expect(result.externalRef).toMatch(/^SIM-TRF-/);
    });

    it("should throw when LP has insufficient balance", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 100 });

      await expect(
        service.transferAdvance({
          purchaseOrderId: "po-1",
          earlyPaymentRequestId: "ep-1",
          lpId: "lp-1",
          supplierId: "supplier-1",
          amount: 47_500,
          currency: "GBP",
        }),
      ).rejects.toThrow("Insufficient balance");
    });
  });

  describe("refundPO", () => {
    it("should return funds to buyer", async () => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.paymentLock.update.mockResolvedValue({});

      const result = await service.refundPO({
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        currency: "GBP",
        reservationRef: "SIM-RSV-TEST",
        reason: "PO cancelled",
      });

      expect(result.status).toBe(TransferStatus.REFUNDED);
      expect(result.externalRef).toMatch(/^SIM-RFD-/);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "buyer-1" },
          data: { balance: { increment: 50_000 } },
        }),
      );
    });
  });

  describe("reconcile", () => {
    it("should update settlement status when rail confirms change", async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue({
        id: "s-1",
        status: "PENDING",
        externalRef: "SIM-RSV-TEST",
      });
      mockPrisma.settlement.update.mockResolvedValue({
        id: "s-1",
        status: "COMPLETED",
      });

      // For SIM- prefixed refs, simulated adapter returns COMPLETED
      const result = await service.reconcile({
        settlementId: "s-1",
        externalRef: "SIM-RSV-TEST",
      });

      expect(result.changed).toBe(true);
      expect(result.currentStatus).toBe("COMPLETED");
      expect(result.previousStatus).toBe("PENDING");
    });

    it("should not update when settlement already matches", async () => {
      mockPrisma.settlement.findUnique.mockResolvedValue({
        id: "s-1",
        status: "COMPLETED",
        externalRef: "SIM-REL-TEST",
      });

      const result = await service.reconcile({
        settlementId: "s-1",
        externalRef: "SIM-REL-TEST",
      });

      expect(result.changed).toBe(false);
      expect(result.currentStatus).toBe("COMPLETED");
    });
  });

  describe("findAll", () => {
    it("should return all settlements for admin", async () => {
      mockPrisma.settlement.findMany.mockResolvedValue([
        { id: "s-1", type: "STANDARD", status: "COMPLETED" },
      ]);

      const result = await service.findAll("admin-1", "ADMIN");
      expect(result).toHaveLength(1);
      expect(mockPrisma.settlement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it("should filter by user for non-admins", async () => {
      mockPrisma.settlement.findMany.mockResolvedValue([]);

      await service.findAll("buyer-1", "BUYER");
      expect(mockPrisma.settlement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ fromUserId: "buyer-1" }, { toUserId: "buyer-1" }] },
        }),
      );
    });
  });
});
