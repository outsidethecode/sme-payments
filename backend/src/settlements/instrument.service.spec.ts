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
    it("should create an instrument in CREATED status", async () => {
      const created = {
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "CREATED",
        payerAccountRef: "SA1234",
      };
      mockPrisma.paymentInstrument.create.mockResolvedValue(created);

      const result = await service.create(
        {
          purchaseOrderId: "po-1",
          amount: 100_000,
          currency: "SAR",
          payerAccountRef: "SA1234",
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
          payerAccountRef: "SA1234",
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

  // ── requestRelease ──────────────────────────────────────

  describe("requestRelease", () => {
    it("should transition LOCKED → RELEASE_PENDING", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "LOCKED",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "RELEASE_PENDING",
        recipientAccountRef: "SA5678",
      });

      const result = await service.requestRelease(
        { instrumentId: "instr-1", recipientAccountRef: "SA5678" },
        "system-1",
      );

      expect(result.status).toBe("RELEASE_PENDING");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_RELEASE_REQUESTED",
        }),
      );
    });

    it("should reject release from CREATED state", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "CREATED",
      });

      await expect(
        service.requestRelease({ instrumentId: "instr-1" }, "system-1"),
      ).rejects.toThrow(
        "Invalid instrument transition: CREATED → RELEASE_PENDING",
      );
    });
  });

  // ── confirmRelease ──────────────────────────────────────

  describe("confirmRelease", () => {
    it("should transition RELEASE_PENDING → RELEASED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "RELEASE_PENDING",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "RELEASED",
        bankReference: "SIM-REL-001",
      });

      const result = await service.confirmRelease(
        { instrumentId: "instr-1", bankReference: "SIM-REL-001" },
        "system-1",
      );

      expect(result.status).toBe("RELEASED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_RELEASED",
        }),
      );
    });

    it("should reject release from LOCKED state (must go through RELEASE_PENDING)", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "LOCKED",
      });

      await expect(
        service.confirmRelease(
          { instrumentId: "instr-1", bankReference: "REF" },
          "system-1",
        ),
      ).rejects.toThrow("Invalid instrument transition: LOCKED → RELEASED");
    });
  });

  // ── refund ──────────────────────────────────────────────

  describe("refund", () => {
    it("should transition LOCKED → REFUNDED", async () => {
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
      });

      const result = await service.refund(
        { instrumentId: "instr-1", reason: "Dispute resolved" },
        "admin-1",
      );

      expect(result.status).toBe("REFUNDED");
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "INSTRUMENT_REFUNDED",
          payload: expect.objectContaining({
            reason: "Dispute resolved",
          }),
        }),
      );
    });

    it("should reject refund from RELEASED state", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "RELEASED",
      });

      await expect(
        service.refund(
          { instrumentId: "instr-1", reason: "Too late" },
          "admin-1",
        ),
      ).rejects.toThrow("Invalid instrument transition: RELEASED → REFUNDED");
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

    it("should transition RELEASE_PENDING → FAILED", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        purchaseOrderId: "po-1",
        amount: 100_000,
        currency: "SAR",
        status: "RELEASE_PENDING",
      });
      mockPrisma.paymentInstrument.update.mockResolvedValue({
        id: "instr-1",
        status: "FAILED",
      });

      const result = await service.fail("instr-1", "Bank error", "system-1");
      expect(result.status).toBe("FAILED");
    });

    it("should reject fail from RELEASED (terminal state)", async () => {
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: "instr-1",
        status: "RELEASED",
      });

      await expect(
        service.fail("instr-1", "Late fail", "admin-1"),
      ).rejects.toThrow("Invalid instrument transition: RELEASED → FAILED");
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
