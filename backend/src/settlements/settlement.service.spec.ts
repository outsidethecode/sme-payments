import { Test, TestingModule } from "@nestjs/testing";
import { SettlementService } from "./settlement.service";
import { SimulatedAdapter } from "./simulated.adapter";
import {
  SETTLEMENT_ADAPTER,
  TransferStatus,
} from "./settlement-adapter.interface";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { InstrumentService } from "./instrument.service";

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

  const mockInstrument = {
    create: jest.fn().mockResolvedValue({ id: "instr-1", status: "CREATED" }),
    requestLock: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "LOCK_REQUESTED" }),
    confirmLock: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "LOCKED" }),
    requestRelease: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "RELEASE_PENDING" }),
    confirmRelease: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "RELEASED" }),
    refund: jest.fn().mockResolvedValue({ id: "instr-1", status: "REFUNDED" }),
    fail: jest.fn().mockResolvedValue({ id: "instr-1", status: "FAILED" }),
    findByPO: jest.fn().mockResolvedValue({ id: "instr-1", status: "LOCKED" }),
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
        { provide: InstrumentService, useValue: mockInstrument },
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
    it("should create PENDING lock, call adapter, then confirm to LOCKED", async () => {
      // SimulatedAdapter.reserveFunds checks balance then decrements
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 100_000 });
      mockPrisma.user.update.mockResolvedValue({});

      // Step 1: Lock created as PENDING
      mockPrisma.paymentLock.create.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "PENDING",
      });

      // Step 4: confirmLock updates to LOCKED
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
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

      // Verify lock was created as PENDING first
      expect(mockPrisma.paymentLock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
            purchaseOrderId: "po-1",
            buyerId: "buyer-1",
            amount: 50_000,
          }),
        }),
      );

      // Verify lock was then updated to LOCKED (confirmLock)
      expect(mockPrisma.paymentLock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lock-1" },
          data: expect.objectContaining({
            status: "LOCKED",
            openBankingRef: expect.stringMatching(/^SIM-RSV-/),
          }),
        }),
      );

      // Verify BOTH ledger events were logged: REQUESTED then CONFIRMED
      expect(mockLedger.logEvent).toHaveBeenCalledTimes(2);
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          eventType: "PAYMENT_LOCK_REQUESTED",
          entityId: "lock-1",
        }),
      );
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          eventType: "PAYMENT_LOCK_CONFIRMED",
          entityId: "lock-1",
        }),
      );

      // Verify adapter still decremented buyer balance
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "buyer-1" },
          data: { balance: { decrement: 50_000 } },
        }),
      );
    });

    it("should create PENDING lock then transition to LOCK_FAILED on insufficient balance", async () => {
      // SimulatedAdapter will throw "Insufficient balance"
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 1_000 });

      // Lock created as PENDING
      mockPrisma.paymentLock.create.mockResolvedValue({
        id: "lock-fail-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "PENDING",
      });

      // failLock updates to LOCK_FAILED
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-fail-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "LOCK_FAILED",
        failureReason: "Insufficient balance",
      });

      await expect(
        service.reserveForPO({
          purchaseOrderId: "po-1",
          buyerId: "buyer-1",
          amount: 50_000,
          currency: "GBP",
        }),
      ).rejects.toThrow("Insufficient balance");

      // Verify PENDING lock was created
      expect(mockPrisma.paymentLock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );

      // Verify lock transitioned to LOCK_FAILED
      expect(mockPrisma.paymentLock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lock-fail-1" },
          data: expect.objectContaining({
            status: "LOCK_FAILED",
            failureReason: expect.stringContaining("Insufficient balance"),
          }),
        }),
      );

      // Verify REQUESTED + FAILED ledger events
      expect(mockLedger.logEvent).toHaveBeenCalledTimes(2);
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ eventType: "PAYMENT_LOCK_REQUESTED" }),
      );
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ eventType: "PAYMENT_LOCK_FAILED" }),
      );
    });
  });

  describe("confirmLock", () => {
    it("should transition PENDING → LOCKED and log CONFIRMED event", async () => {
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "LOCKED",
      });

      const processedAt = new Date("2025-03-01T12:00:00Z");
      await service.confirmLock("lock-1", "EXT-REF-123", processedAt);

      expect(mockPrisma.paymentLock.update).toHaveBeenCalledWith({
        where: { id: "lock-1" },
        data: {
          status: "LOCKED",
          openBankingRef: "EXT-REF-123",
          lockedAt: processedAt,
        },
      });

      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "PAYMENT_LOCK",
          entityId: "lock-1",
          eventType: "PAYMENT_LOCK_CONFIRMED",
          payload: expect.objectContaining({
            externalRef: "EXT-REF-123",
          }),
        }),
      );
    });
  });

  describe("failLock", () => {
    it("should transition PENDING → LOCK_FAILED and log FAILED event", async () => {
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-2",
        purchaseOrderId: "po-2",
        buyerId: "buyer-2",
        amount: 30_000,
        status: "LOCK_FAILED",
        failureReason: "Bank declined",
      });

      await service.failLock("lock-2", "Bank declined");

      expect(mockPrisma.paymentLock.update).toHaveBeenCalledWith({
        where: { id: "lock-2" },
        data: {
          status: "LOCK_FAILED",
          failedAt: expect.any(Date),
          failureReason: "Bank declined",
        },
      });

      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "PAYMENT_LOCK",
          entityId: "lock-2",
          eventType: "PAYMENT_LOCK_FAILED",
          payload: expect.objectContaining({
            reason: "Bank declined",
          }),
        }),
      );
    });
  });

  describe("settlePO", () => {
    it("should create PROCESSING settlement, call adapter, then confirm to COMPLETED", async () => {
      mockPrisma.paymentLock.findUnique.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        status: "LOCKED",
        openBankingRef: "SIM-RSV-TEST",
      });

      // SimulatedAdapter.releaseFunds credits the user
      mockPrisma.user.update.mockResolvedValue({});

      // Settlement created as PROCESSING
      mockPrisma.settlement.create.mockResolvedValue({
        id: "settlement-1",
        purchaseOrderId: "po-1",
        fromUserId: "buyer-1",
        toUserId: "supplier-1",
        amount: 49_750,
        type: "STANDARD",
        status: "PROCESSING",
      });

      // confirmSettlement updates to COMPLETED
      mockPrisma.settlement.update.mockResolvedValue({
        id: "settlement-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 49_750,
        type: "STANDARD",
        status: "COMPLETED",
        settlementRail: "SIMULATED",
      });

      // $transaction executes the callback (lock release + platform fee)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === "function") return fn(mockPrisma);
        return Promise.all(fn);
      });

      mockPrisma.paymentLock.update.mockResolvedValue({});
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

      // Verify settlement was created as PROCESSING first
      expect(mockPrisma.settlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PROCESSING",
            type: "STANDARD",
          }),
        }),
      );

      // Verify settlement was confirmed to COMPLETED
      expect(mockPrisma.settlement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "settlement-1" },
          data: expect.objectContaining({
            status: "COMPLETED",
            externalRef: expect.stringMatching(/^SIM-REL-/),
          }),
        }),
      );

      // Verify ledger events: SETTLEMENT_PROCESSING + SETTLEMENT_CONFIRMED + PAYMENT_LOCK_RELEASED
      const logCalls = mockLedger.logEvent.mock.calls.map(
        (c: any[]) => c[0].eventType,
      );
      expect(logCalls).toContain("SETTLEMENT_PROCESSING");
      expect(logCalls).toContain("SETTLEMENT_CONFIRMED");
      expect(logCalls).toContain("PAYMENT_LOCK_RELEASED");
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

  describe("confirmSettlement", () => {
    it("should transition PROCESSING → COMPLETED and log CONFIRMED event", async () => {
      mockPrisma.settlement.update.mockResolvedValue({
        id: "s-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 49_750,
        type: "STANDARD",
        status: "COMPLETED",
        settlementRail: "SIMULATED",
      });

      const processedAt = new Date("2025-03-01T12:00:00Z");
      await service.confirmSettlement("s-1", "EXT-REF-456", processedAt);

      expect(mockPrisma.settlement.update).toHaveBeenCalledWith({
        where: { id: "s-1" },
        data: {
          status: "COMPLETED",
          externalRef: "EXT-REF-456",
          completedAt: processedAt,
        },
      });

      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "SETTLEMENT",
          entityId: "s-1",
          eventType: "SETTLEMENT_CONFIRMED",
          payload: expect.objectContaining({
            externalRef: "EXT-REF-456",
          }),
        }),
      );
    });
  });

  describe("failSettlement", () => {
    it("should transition PROCESSING → FAILED and log FAILED event", async () => {
      mockPrisma.settlement.update.mockResolvedValue({
        id: "s-2",
        purchaseOrderId: "po-2",
        toUserId: "supplier-2",
        amount: 30_000,
        type: "STANDARD",
        status: "FAILED",
        settlementRail: "SIMULATED",
      });

      await service.failSettlement("s-2", "Bank rejected transfer");

      expect(mockPrisma.settlement.update).toHaveBeenCalledWith({
        where: { id: "s-2" },
        data: {
          status: "FAILED",
          failureReason: "Bank rejected transfer",
        },
      });

      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "SETTLEMENT",
          entityId: "s-2",
          eventType: "SETTLEMENT_FAILED",
          payload: expect.objectContaining({
            reason: "Bank rejected transfer",
          }),
        }),
      );
    });
  });

  describe("transferAdvance", () => {
    it("should create PROCESSING settlement, transfer LP→Supplier, then confirm", async () => {
      // SimulatedAdapter.transferFunds checks sender balance then does debit+credit
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 500_000 });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]); // batch update results

      // Settlement created as PROCESSING
      mockPrisma.settlement.create.mockResolvedValue({
        id: "adv-settle-1",
        purchaseOrderId: "po-1",
        fromUserId: "lp-1",
        toUserId: "supplier-1",
        amount: 47_500,
        type: "EARLY_PAY_ADVANCE",
        status: "PROCESSING",
      });

      // confirmSettlement updates to COMPLETED
      mockPrisma.settlement.update.mockResolvedValue({
        id: "adv-settle-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 47_500,
        type: "EARLY_PAY_ADVANCE",
        status: "COMPLETED",
        settlementRail: "SIMULATED",
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

      // Verify PROCESSING → COMPLETED flow
      expect(mockPrisma.settlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PROCESSING",
            type: "EARLY_PAY_ADVANCE",
          }),
        }),
      );
      expect(mockPrisma.settlement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "adv-settle-1" },
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );

      // Verify ledger events include SETTLEMENT_PROCESSING + SETTLEMENT_CONFIRMED + EARLY_PAY_FUNDED
      const logCalls = mockLedger.logEvent.mock.calls.map(
        (c: any[]) => c[0].eventType,
      );
      expect(logCalls).toContain("SETTLEMENT_PROCESSING");
      expect(logCalls).toContain("SETTLEMENT_CONFIRMED");
      expect(logCalls).toContain("EARLY_PAY_FUNDED");
    });

    it("should create PROCESSING settlement then transition to FAILED on insufficient balance", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ balance: 100 });

      // Settlement created as PROCESSING
      mockPrisma.settlement.create.mockResolvedValue({
        id: "adv-fail-1",
        purchaseOrderId: "po-1",
        fromUserId: "lp-1",
        toUserId: "supplier-1",
        amount: 47_500,
        type: "EARLY_PAY_ADVANCE",
        status: "PROCESSING",
      });

      // failSettlement updates to FAILED
      mockPrisma.settlement.update.mockResolvedValue({
        id: "adv-fail-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 47_500,
        type: "EARLY_PAY_ADVANCE",
        status: "FAILED",
        settlementRail: "SIMULATED",
      });

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

      // Verify settlement was created PROCESSING then moved to FAILED
      expect(mockPrisma.settlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PROCESSING" }),
        }),
      );
      expect(mockPrisma.settlement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "adv-fail-1" },
          data: expect.objectContaining({
            status: "FAILED",
            failureReason: expect.stringContaining("Insufficient balance"),
          }),
        }),
      );
    });
  });

  describe("refundPO", () => {
    it("should log refund intent, return funds to buyer, then log confirmed", async () => {
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

      // Verify BOTH ledger events: REFUND_REQUESTED then REFUNDED
      expect(mockLedger.logEvent).toHaveBeenCalledTimes(2);
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          eventType: "PAYMENT_LOCK_REFUND_REQUESTED",
        }),
      );
      expect(mockLedger.logEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          eventType: "PAYMENT_LOCK_REFUNDED",
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
