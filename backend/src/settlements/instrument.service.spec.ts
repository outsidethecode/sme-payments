import { Test, TestingModule } from "@nestjs/testing";
import { InstrumentService } from "./instrument.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

describe("InstrumentService", () => {
  let service: InstrumentService;

  const mockPrisma = {
    paymentInstrument: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockLedger = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstrumentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get(InstrumentService);
  });

  // ── create ──────────────────────────────────────────────

  describe("create", () => {
    it("should create an instrument in CREATED status with SUPPLIER beneficiary", async () => {
      const created = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "CREATED",
        payerAccountRef: "SA1234",
        settlementBeneficiary: "SUPPLIER",
      };
      mockPrisma.paymentInstrument.create.mockResolvedValue(created);

      const result = await service.create(
        {
          purchaseOrderId: "po-1",
          amount: 100_000,
          currency: "SAR",
          payerAccountRef: "SA1234",
          buyerOrgId: "org-buyer",
          supplierOrgId: "org-supplier",
        },
        "buyer-1",
      );

      expect(result).toEqual(created);
      expect(mockPrisma.paymentInstrument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purchaseOrderId: "po-1",
          amount: 100_000,
          currency: "SAR",
          status: "CREATED",
          settlementBeneficiary: "SUPPLIER",
          payerAccountRef: "SA1234",
          buyerOrgId: "org-buyer",
          supplierOrgId: "org-supplier",
        }),
      });
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_CREATED",
          entityType: "PAYMENT_INSTRUMENT",
          entityId: "instr-1",
        }),
      );
    });
  });

  // ── requestLock ─────────────────────────────────────────

  describe("requestLock", () => {
    it("should transition CREATED → LOCK_REQUESTED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "CREATED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "LOCK_REQUESTED",
      });

      const result = await service.requestLock("instr-1", "buyer-1");

      expect(result.status).toBe("LOCK_REQUESTED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_LOCK_REQUESTED",
          entityId: "instr-1",
          actorId: "buyer-1",
        }),
      );
    });

    it("should reject invalid transition LOCKED → LOCK_REQUESTED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "LOCKED",
      });

      await expect(service.requestLock("instr-1", "buyer-1")).rejects.toThrow(
        "Invalid instrument transition: LOCKED → LOCK_REQUESTED",
      );
    });
  });

  // ── confirmLock ─────────────────────────────────────────

  describe("confirmLock", () => {
    it("should transition LOCK_REQUESTED → LOCKED with bank reference", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "LOCK_REQUESTED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "LOCKED",
        bankReference: "SARIE-RSV-001",
      });

      const result = await service.confirmLock(
        { instrumentId: "instr-1", bankReference: "SARIE-RSV-001" },
        "buyer-1",
      );

      expect(result.status).toBe("LOCKED");
      expect(mockPrisma.paymentInstrument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "instr-1" },
          data: expect.objectContaining({
            status: "LOCKED",
            bankReference: "SARIE-RSV-001",
          }),
        }),
      );
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_LOCKED",
          entityId: "instr-1",
        }),
      );
    });

    it("should reject invalid transition CREATED → LOCKED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "CREATED",
      });

      await expect(
        service.confirmLock(
          { instrumentId: "instr-1", bankReference: "REF" },
          "buyer-1",
        ),
      ).rejects.toThrow("Invalid instrument transition: CREATED → LOCKED");
    });
  });

  // ── requestFinancing ────────────────────────────────────

  describe("requestFinancing", () => {
    it("should transition LOCKED → FINANCING_REQUESTED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "LOCKED",
        settlementBeneficiary: "SUPPLIER",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FINANCING_REQUESTED",
      });

      const result = await service.requestFinancing("instr-1", "supplier-1");

      expect(result.status).toBe("FINANCING_REQUESTED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "FINANCING_REQUESTED",
          actorId: "supplier-1",
          actorRole: "SUPPLIER",
        }),
      );
    });

    it("should reject financing from CREATED state", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "CREATED",
      });

      await expect(
        service.requestFinancing("instr-1", "supplier-1"),
      ).rejects.toThrow(
        "Invalid instrument transition: CREATED → FINANCING_REQUESTED",
      );
    });
  });

  // ── confirmFinancing (atomic beneficiary flip) ──────────

  describe("confirmFinancing", () => {
    it("should atomically transition FINANCING_REQUESTED → FINANCING_FUNDED and flip beneficiary", async () => {
      const updatedInstrument = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "FINANCING_FUNDED",
        settlementBeneficiary: "LIQUIDITY_PROVIDER",
        financingPartnerId: "lp-1",
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              purchase_order_id: "po-1",
              amount: 100_000,
              currency: "SAR",
              status: "FINANCING_REQUESTED",
              settlement_beneficiary: "SUPPLIER",
            },
          ]),
          paymentInstrument: {
            update: jest.fn().mockResolvedValue(updatedInstrument),
          },
        };
        return cb(txMock);
      });

      const result = await service.confirmFinancing(
        { instrumentId: "instr-1", financingPartnerId: "lp-1" },
        "lp-1",
      );

      expect(result.status).toBe("FINANCING_FUNDED");
      expect(result.settlementBeneficiary).toBe("LIQUIDITY_PROVIDER");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "FINANCING_FUNDED",
          actorId: "lp-1",
          actorRole: "LIQUIDITY_PARTNER",
          payload: expect.objectContaining({
            previousBeneficiary: "SUPPLIER",
            newBeneficiary: "LIQUIDITY_PROVIDER",
            financingPartnerId: "lp-1",
          }),
        }),
      );
    });

    it("should reject if instrument is not in FINANCING_REQUESTED state", async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              status: "LOCKED",
              settlement_beneficiary: "SUPPLIER",
            },
          ]),
          paymentInstrument: { update: jest.fn() },
        };
        return cb(txMock);
      });

      await expect(
        service.confirmFinancing(
          { instrumentId: "instr-1", financingPartnerId: "lp-1" },
          "lp-1",
        ),
      ).rejects.toThrow(
        "Cannot fund: instrument is LOCKED, expected FINANCING_REQUESTED",
      );
    });

    it("should reject if beneficiary is already LIQUIDITY_PROVIDER (double-fund guard)", async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              status: "FINANCING_REQUESTED",
              settlement_beneficiary: "LIQUIDITY_PROVIDER",
            },
          ]),
          paymentInstrument: { update: jest.fn() },
        };
        return cb(txMock);
      });

      await expect(
        service.confirmFinancing(
          { instrumentId: "instr-1", financingPartnerId: "lp-2" },
          "lp-2",
        ),
      ).rejects.toThrow(
        "Cannot fund: beneficiary already set to LIQUIDITY_PROVIDER",
      );
    });

    it("should reject if instrument not found", async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          paymentInstrument: { update: jest.fn() },
        };
        return cb(txMock);
      });

      await expect(
        service.confirmFinancing(
          { instrumentId: "nonexistent", financingPartnerId: "lp-1" },
          "lp-1",
        ),
      ).rejects.toThrow("Payment instrument nonexistent not found");
    });
  });

  // ── revertFinancing (compensating transaction) ──────────

  describe("revertFinancing", () => {
    it("should revert FINANCING_FUNDED → LOCKED and reset beneficiary", async () => {
      const reverted = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        status: "LOCKED",
        settlementBeneficiary: "SUPPLIER",
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              purchase_order_id: "po-1",
              amount: 100_000,
              status: "FINANCING_FUNDED",
              settlement_beneficiary: "LIQUIDITY_PROVIDER",
            },
          ]),
          paymentInstrument: {
            update: jest.fn().mockResolvedValue(reverted),
          },
        };
        return cb(txMock);
      });

      const result = await service.revertFinancing("instr-1", "lp-1");

      expect(result.status).toBe("LOCKED");
      expect(result.settlementBeneficiary).toBe("SUPPLIER");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "FINANCING_REVERTED",
          payload: expect.objectContaining({
            previousBeneficiary: "LIQUIDITY_PROVIDER",
            newBeneficiary: "SUPPLIER",
          }),
        }),
      );
    });

    it("should also revert FINANCING_REQUESTED → LOCKED", async () => {
      const reverted = {
        id: "instr-1",
        status: "LOCKED",
        settlementBeneficiary: "SUPPLIER",
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              purchase_order_id: "po-1",
              amount: 100_000,
              status: "FINANCING_REQUESTED",
              settlement_beneficiary: "SUPPLIER",
            },
          ]),
          paymentInstrument: {
            update: jest.fn().mockResolvedValue(reverted),
          },
        };
        return cb(txMock);
      });

      const result = await service.revertFinancing("instr-1", "system-1");
      expect(result.status).toBe("LOCKED");
    });

    it("should reject revert from LOCKED state", async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ id: "instr-1", status: "LOCKED" }]),
          paymentInstrument: { update: jest.fn() },
        };
        return cb(txMock);
      });

      await expect(service.revertFinancing("instr-1", "lp-1")).rejects.toThrow(
        "Cannot revert financing: instrument is LOCKED",
      );
    });
  });

  // ── requestSettlement ───────────────────────────────────

  describe("requestSettlement", () => {
    it("should transition LOCKED → SETTLEMENT_PENDING (direct settlement, no LP)", async () => {
      const updated = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        status: "SETTLEMENT_PENDING",
        recipientAccountRef: "SA5678",
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              purchase_order_id: "po-1",
              amount: 100_000,
              currency: "SAR",
              status: "LOCKED",
              settlement_beneficiary: "SUPPLIER",
            },
          ]),
          paymentInstrument: {
            update: jest.fn().mockResolvedValue(updated),
          },
        };
        return cb(txMock);
      });

      const result = await service.requestSettlement(
        { instrumentId: "instr-1", recipientAccountRef: "SA5678" },
        "system-1",
      );

      expect(result.status).toBe("SETTLEMENT_PENDING");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SETTLEMENT_INITIATED",
        }),
      );
    });

    it("should transition FINANCING_FUNDED → SETTLEMENT_PENDING (LP funded)", async () => {
      const updated = {
        id: "instr-1",
        status: "SETTLEMENT_PENDING",
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: "instr-1",
              purchase_order_id: "po-1",
              amount: 100_000,
              currency: "SAR",
              status: "FINANCING_FUNDED",
              settlement_beneficiary: "LIQUIDITY_PROVIDER",
            },
          ]),
          paymentInstrument: {
            update: jest.fn().mockResolvedValue(updated),
          },
        };
        return cb(txMock);
      });

      const result = await service.requestSettlement(
        { instrumentId: "instr-1" },
        "system-1",
      );

      expect(result.status).toBe("SETTLEMENT_PENDING");
    });

    it("should reject settlement from CREATED state", async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ id: "instr-1", status: "CREATED" }]),
          paymentInstrument: { update: jest.fn() },
        };
        return cb(txMock);
      });

      await expect(
        service.requestSettlement({ instrumentId: "instr-1" }, "system-1"),
      ).rejects.toThrow(
        "Invalid instrument transition: CREATED → SETTLEMENT_PENDING",
      );
    });
  });

  // ── confirmSettlement ───────────────────────────────────

  describe("confirmSettlement", () => {
    it("should transition SETTLEMENT_PENDING → SETTLED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "SETTLEMENT_PENDING",
        settlementBeneficiary: "SUPPLIER",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "SETTLED",
        bankReference: "SIM-SET-001",
        settlementBeneficiary: "SUPPLIER",
      });

      const result = await service.confirmSettlement(
        { instrumentId: "instr-1", bankReference: "SIM-SET-001" },
        "system-1",
      );

      expect(result.status).toBe("SETTLED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_SETTLED",
        }),
      );
    });

    it("should reject settlement confirmation from LOCKED state", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "LOCKED",
      });

      await expect(
        service.confirmSettlement(
          { instrumentId: "instr-1", bankReference: "REF" },
          "system-1",
        ),
      ).rejects.toThrow("Invalid instrument transition: LOCKED → SETTLED");
    });
  });

  // ── refund ──────────────────────────────────────────────

  describe("refund", () => {
    it("should transition LOCKED → REFUNDED with BUYER beneficiary", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "LOCKED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "REFUNDED",
        settlementBeneficiary: "BUYER",
      });

      const result = await service.refund(
        { instrumentId: "instr-1", reason: "Dispute resolved" },
        "admin-1",
      );

      expect(result.status).toBe("REFUNDED");
      expect(mockPrisma.paymentInstrument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "REFUNDED",
            settlementBeneficiary: "BUYER",
          }),
        }),
      );
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_REFUNDED",
          payload: expect.objectContaining({
            reason: "Dispute resolved",
          }),
        }),
      );
    });

    it("should reject refund from SETTLED state", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "SETTLED",
      });

      await expect(
        service.refund(
          { instrumentId: "instr-1", reason: "Too late" },
          "admin-1",
        ),
      ).rejects.toThrow("Invalid instrument transition: SETTLED → REFUNDED");
    });
  });

  // ── fail ────────────────────────────────────────────────

  describe("fail", () => {
    it("should transition CREATED → FAILED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "CREATED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FAILED",
      });

      const result = await service.fail("instr-1", "Bank rejected", "buyer-1");

      expect(result.status).toBe("FAILED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_FAILED",
          payload: expect.objectContaining({
            reason: "Bank rejected",
            previousStatus: "CREATED",
          }),
        }),
      );
    });

    it("should transition LOCK_REQUESTED → FAILED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "LOCK_REQUESTED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FAILED",
      });

      const result = await service.fail("instr-1", "Timeout", "buyer-1");
      expect(result.status).toBe("FAILED");
    });

    it("should transition SETTLEMENT_PENDING → FAILED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "SETTLEMENT_PENDING",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FAILED",
      });

      const result = await service.fail("instr-1", "Bank error", "system-1");
      expect(result.status).toBe("FAILED");
    });

    it("should transition FINANCING_REQUESTED → FAILED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "FINANCING_REQUESTED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FAILED",
      });

      const result = await service.fail("instr-1", "Aborted", "system-1");
      expect(result.status).toBe("FAILED");
    });

    it("should reject fail from SETTLED (terminal state)", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "SETTLED",
      });

      await expect(
        service.fail("instr-1", "Late fail", "admin-1"),
      ).rejects.toThrow("Invalid instrument transition: SETTLED → FAILED");
    });

    it("should reject fail from REFUNDED (terminal state)", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "REFUNDED",
      });

      await expect(
        service.fail("instr-1", "Late fail", "admin-1"),
      ).rejects.toThrow("Invalid instrument transition: REFUNDED → FAILED");
    });
  });

  // ── findByPO ────────────────────────────────────────────

  describe("findByPO", () => {
    it("should return instrument by purchaseOrderId", async () => {
      const expected = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        status: "LOCKED",
      };
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(expected);

      const result = await service.findByPO("po-1");
      expect(result).toEqual(expected);
      expect(mockPrisma.paymentInstrument.findUnique).toHaveBeenCalledWith({
        where: { purchaseOrderId: "po-1" },
      });
    });

    it("should return null when no instrument exists", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(null);

      const result = await service.findByPO("po-nonexistent");
      expect(result).toBeNull();
    });
  });

  // ── Not found ───────────────────────────────────────────

  describe("not found", () => {
    it("should throw when instrument not found for transition", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(null);

      await expect(
        service.requestLock("nonexistent", "buyer-1"),
      ).rejects.toThrow("Payment instrument nonexistent not found");
    });
  });
});
