import { Test, TestingModule } from "@nestjs/testing";
import { createHmac } from "crypto";
import { SettlementService, BankWebhookPayload } from "./settlement.service";
import { SimulatedAdapter } from "./simulated.adapter";
import { SETTLEMENT_ADAPTER } from "./settlement-adapter.interface";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { InstrumentService } from "./instrument.service";

// ── Helper: sign a webhook payload ──────────────────────────

const WEBHOOK_SECRET = "test-webhook-secret-32-bytes-ok";

function signPayload(
  payload: Omit<BankWebhookPayload, "signature">,
): BankWebhookPayload {
  const message = [
    payload.externalRef,
    payload.status,
    payload.amount,
    payload.bankReference,
    payload.timestamp,
  ].join("|");

  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(message)
    .digest("hex");

  return { ...payload, signature };
}

// ── Tests ───────────────────────────────────────────────────

describe("Bank Webhook Handler", () => {
  let service: SettlementService;

  const mockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    paymentLock: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    settlement: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    platformFee: { create: jest.fn() },
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
    requestFinancing: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "FINANCING_REQUESTED" }),
    confirmFinancing: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "FINANCING_FUNDED" }),
    revertFinancing: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "LOCKED" }),
    requestSettlement: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "SETTLEMENT_PENDING" }),
    confirmSettlement: jest
      .fn()
      .mockResolvedValue({ id: "instr-1", status: "SETTLED" }),
    refund: jest.fn().mockResolvedValue({ id: "instr-1", status: "REFUNDED" }),
    fail: jest.fn().mockResolvedValue({ id: "instr-1", status: "FAILED" }),
    findByPO: jest.fn().mockResolvedValue({ id: "instr-1", status: "LOCKED" }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.BANK_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        {
          provide: SETTLEMENT_ADAPTER,
          useFactory: () => new SimulatedAdapter(mockPrisma as any),
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: InstrumentService, useValue: mockInstrument },
      ],
    }).compile();

    service = module.get(SettlementService);
  });

  afterEach(() => {
    delete process.env.BANK_WEBHOOK_SECRET;
  });

  // ── Signature verification ────────────────────────────────

  describe("verifyWebhookSignature", () => {
    it("should accept a valid HMAC-SHA256 signature", () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: new Date().toISOString(),
      });

      expect(() =>
        service.verifyWebhookSignature(payload, WEBHOOK_SECRET),
      ).not.toThrow();
    });

    it("should reject an invalid signature", () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: new Date().toISOString(),
      });

      payload.signature = "0".repeat(64); // tampered

      expect(() =>
        service.verifyWebhookSignature(payload, WEBHOOK_SECRET),
      ).toThrow("Invalid webhook signature");
    });

    it("should reject a signature with wrong secret", () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: new Date().toISOString(),
      });

      expect(() =>
        service.verifyWebhookSignature(
          payload,
          "wrong-secret-wrong-secret-32b",
        ),
      ).toThrow("Invalid webhook signature");
    });
  });

  // ── Replay protection ─────────────────────────────────────

  describe("replay protection", () => {
    it("should reject webhook older than 5 minutes", async () => {
      const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: oldTimestamp,
      });

      await expect(service.handleBankCallback(payload)).rejects.toThrow(
        "Webhook timestamp too old",
      );
    });

    it("should accept webhook within 5-minute window", async () => {
      const recentTimestamp = new Date(
        Date.now() - 2 * 60 * 1000,
      ).toISOString();
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: recentTimestamp,
      });

      // Lock found in PENDING state
      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "PENDING",
        openBankingRef: "SIM-RSV-001",
      });
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "LOCKED",
      });

      const result = await service.handleBankCallback(payload);
      expect(result.accepted).toBe(true);
      expect(result.action).toBe("confirmed");
    });
  });

  // ── Missing secret ────────────────────────────────────────

  describe("missing webhook secret", () => {
    it("should throw when BANK_WEBHOOK_SECRET is not set", async () => {
      delete process.env.BANK_WEBHOOK_SECRET;

      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-001",
        timestamp: new Date().toISOString(),
      });

      await expect(service.handleBankCallback(payload)).rejects.toThrow(
        "Webhook secret not configured",
      );
    });
  });

  // ── PaymentLock webhooks ──────────────────────────────────

  describe("lock webhook: CONFIRMED", () => {
    it("should confirm a PENDING lock to LOCKED", async () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-001",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-CONF-001",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "PENDING",
        openBankingRef: "SIM-RSV-001",
      });
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-1",
        purchaseOrderId: "po-1",
        buyerId: "buyer-1",
        amount: 50_000,
        status: "LOCKED",
      });

      const result = await service.handleBankCallback(payload);

      expect(result.accepted).toBe(true);
      expect(result.action).toBe("confirmed");
      expect(result.detail).toBe("Lock PENDING → LOCKED");

      // Verify confirmLock was called (via paymentLock.update)
      expect(mockPrisma.paymentLock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lock-1" },
          data: expect.objectContaining({ status: "LOCKED" }),
        }),
      );

      // Verify BANK_WEBHOOK_RECEIVED was logged with entity owner as actor
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "BANK_WEBHOOK_RECEIVED",
          entityType: "PAYMENT_LOCK",
          entityId: "lock-1",
          actorId: "buyer-1",
          actorRole: "SYSTEM",
        }),
      );
    });

    it("should return no-op if lock is already LOCKED (idempotent)", async () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-002",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-CONF-002",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-2",
        status: "LOCKED",
        openBankingRef: "SIM-RSV-002",
      });

      const result = await service.handleBankCallback(payload);

      expect(result.action).toBe("no-op");
      expect(result.detail).toBe("Lock already LOCKED");
      // confirmLock NOT called
      expect(mockPrisma.paymentLock.update).not.toHaveBeenCalled();
    });

    it("should return no-op for lock in terminal state (RELEASED)", async () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-003",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-CONF-003",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-3",
        status: "RELEASED",
        openBankingRef: "SIM-RSV-003",
      });

      const result = await service.handleBankCallback(payload);
      expect(result.action).toBe("no-op");
      expect(result.detail).toContain("terminal state RELEASED");
    });
  });

  describe("lock webhook: FAILED", () => {
    it("should fail a PENDING lock to LOCK_FAILED", async () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-004",
        status: "FAILED",
        amount: 50_000,
        bankReference: "BANK-FAIL-001",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-4",
        purchaseOrderId: "po-4",
        buyerId: "buyer-4",
        amount: 50_000,
        status: "PENDING",
        openBankingRef: "SIM-RSV-004",
      });
      mockPrisma.paymentLock.update.mockResolvedValue({
        id: "lock-4",
        purchaseOrderId: "po-4",
        buyerId: "buyer-4",
        status: "LOCK_FAILED",
      });

      const result = await service.handleBankCallback(payload);

      expect(result.action).toBe("failed");
      expect(result.detail).toBe("Lock PENDING → LOCK_FAILED");
    });

    it("should return no-op if lock already LOCK_FAILED", async () => {
      const payload = signPayload({
        externalRef: "SIM-RSV-005",
        status: "FAILED",
        amount: 50_000,
        bankReference: "BANK-FAIL-002",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue({
        id: "lock-5",
        status: "LOCK_FAILED",
        openBankingRef: "SIM-RSV-005",
      });

      const result = await service.handleBankCallback(payload);
      expect(result.action).toBe("no-op");
    });
  });

  // ── Settlement webhooks ───────────────────────────────────

  describe("settlement webhook: CONFIRMED", () => {
    it("should confirm a PROCESSING settlement to COMPLETED", async () => {
      const payload = signPayload({
        externalRef: "SIM-REL-001",
        status: "CONFIRMED",
        amount: 49_750,
        bankReference: "BANK-SETTLE-001",
        timestamp: new Date().toISOString(),
      });

      // No lock found → falls through to settlement lookup
      mockPrisma.paymentLock.findFirst.mockResolvedValue(null);
      mockPrisma.settlement.findFirst.mockResolvedValue({
        id: "s-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 49_750,
        type: "STANDARD",
        status: "PROCESSING",
        settlementRail: "SIMULATED",
        externalRef: "SIM-REL-001",
      });
      mockPrisma.settlement.update.mockResolvedValue({
        id: "s-1",
        purchaseOrderId: "po-1",
        toUserId: "supplier-1",
        amount: 49_750,
        type: "STANDARD",
        status: "COMPLETED",
        settlementRail: "SIMULATED",
      });

      const result = await service.handleBankCallback(payload);

      expect(result.accepted).toBe(true);
      expect(result.action).toBe("confirmed");
      expect(result.detail).toBe("Settlement PROCESSING → COMPLETED");

      // Verify BANK_WEBHOOK_RECEIVED logged for settlement with entity owner
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "BANK_WEBHOOK_RECEIVED",
          entityType: "SETTLEMENT",
          entityId: "s-1",
          actorId: "supplier-1",
          actorRole: "SYSTEM",
        }),
      );
    });

    it("should return no-op if settlement already COMPLETED", async () => {
      const payload = signPayload({
        externalRef: "SIM-REL-002",
        status: "CONFIRMED",
        amount: 49_750,
        bankReference: "BANK-SETTLE-002",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue(null);
      mockPrisma.settlement.findFirst.mockResolvedValue({
        id: "s-2",
        status: "COMPLETED",
        externalRef: "SIM-REL-002",
      });

      const result = await service.handleBankCallback(payload);
      expect(result.action).toBe("no-op");
      expect(result.detail).toBe("Settlement already COMPLETED");
    });
  });

  describe("settlement webhook: FAILED", () => {
    it("should fail a PROCESSING settlement to FAILED", async () => {
      const payload = signPayload({
        externalRef: "SIM-REL-003",
        status: "FAILED",
        amount: 49_750,
        bankReference: "BANK-FAIL-SETTLE-001",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue(null);
      mockPrisma.settlement.findFirst.mockResolvedValue({
        id: "s-3",
        purchaseOrderId: "po-3",
        toUserId: "supplier-3",
        amount: 49_750,
        type: "STANDARD",
        status: "PROCESSING",
        settlementRail: "SIMULATED",
        externalRef: "SIM-REL-003",
      });
      mockPrisma.settlement.update.mockResolvedValue({
        id: "s-3",
        purchaseOrderId: "po-3",
        toUserId: "supplier-3",
        status: "FAILED",
        settlementRail: "SIMULATED",
      });

      const result = await service.handleBankCallback(payload);

      expect(result.action).toBe("failed");
      expect(result.detail).toBe("Settlement PROCESSING → FAILED");
    });
  });

  // ── Unknown external ref ──────────────────────────────────

  describe("unknown externalRef", () => {
    it("should throw when no lock or settlement matches", async () => {
      const payload = signPayload({
        externalRef: "UNKNOWN-REF",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-UNKNOWN",
        timestamp: new Date().toISOString(),
      });

      mockPrisma.paymentLock.findFirst.mockResolvedValue(null);
      mockPrisma.settlement.findFirst.mockResolvedValue(null);

      await expect(service.handleBankCallback(payload)).rejects.toThrow(
        "No lock or settlement found for ref UNKNOWN-REF",
      );
    });
  });
});
