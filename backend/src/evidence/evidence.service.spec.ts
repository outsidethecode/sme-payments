import { Test, TestingModule } from "@nestjs/testing";
import { EvidenceService } from "./evidence.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { AnchorService } from "../ledger/anchor.service";
import { ProofGeneratorService } from "../proofs/proof-generator.service";
import { CRYPTO_SERVICE } from "../crypto/crypto.interface";
import { ConfigService } from "@nestjs/config";

/**
 * Unit tests for Phase 8: Evidence Pack — paymentInstrument + reconciliation
 *
 * Tests the buildEvidencePack method with focus on the new sections:
 * - paymentInstrument (instrument lifecycle from ledger events)
 * - reconciliation (latest reconciliation report snapshot)
 * - verification checks 16 + 17
 */
describe("EvidenceService — Instrument & Reconciliation sections", () => {
  let service: EvidenceService;

  const basePO = {
    id: "po-1",
    referenceNumber: "PO-0001",
    externalPoNumber: null,
    description: "Test PO",
    lineItems: [{ description: "Widget", quantity: 1, unitPricePennies: 1000 }],
    amount: 1000,
    currency: "GBP",
    status: "ACCEPTED",
    paymentTerms: "NET-30",
    deliveryTerms: "DDP",
    expectedDeliveryDate: null,
    notes: null,
    buyerContactName: null,
    buyerContactEmail: null,
    currentRevision: 1,
    createdAt: new Date("2026-03-01"),
    settledAt: null,
    buyer: {
      id: "buyer-1",
      name: "Buyer",
      companyName: "Buyer Co",
      role: "BUYER",
    },
    supplier: {
      id: "supplier-1",
      name: "Supplier",
      companyName: "Supplier Co",
      role: "SUPPLIER",
    },
    paymentLock: null,
    paymentInstrument: null,
    settlements: [],
    disputes: [],
    earlyPaymentRequest: null,
    revisions: [],
  };

  const mockPrisma = {
    purchaseOrder: { findUnique: jest.fn() },
    evidenceAttachment: { findMany: jest.fn() },
    eventLog: { findMany: jest.fn() },
    reconciliationReport: { findFirst: jest.fn() },
  };

  const mockLedger = {};
  const mockAnchor = {
    getInclusionProof: jest.fn().mockResolvedValue({ found: false }),
    getAnchorForEntity: jest.fn().mockResolvedValue(null),
  };
  const mockProofGenerator = {
    generateEntityProofs: jest.fn().mockResolvedValue({ proofs: [] }),
  };
  const mockCrypto = {
    sha256Hex: jest.fn().mockReturnValue("abcdef1234567890"),
    signWithPlatformKey: jest.fn().mockReturnValue({
      signature: "sig-mock",
      publicKey: "pk-mock",
    }),
    randomUUID: jest.fn().mockReturnValue("uuid-mock"),
  };
  const mockConfig = {
    get: jest.fn().mockReturnValue("http://localhost:3001/api"),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    // Reset default mock return values after resetAllMocks
    mockAnchor.getInclusionProof.mockResolvedValue({ found: false });
    mockAnchor.getAnchorForEntity.mockResolvedValue(null);
    mockProofGenerator.generateEntityProofs.mockResolvedValue({ proofs: [] });
    mockCrypto.sha256Hex.mockReturnValue("abcdef1234567890");
    mockCrypto.signWithPlatformKey.mockReturnValue({
      signature: "sig-mock",
      publicKey: "pk-mock",
    });
    mockCrypto.randomUUID.mockReturnValue("uuid-mock");
    mockConfig.get.mockReturnValue("http://localhost:3001/api");
    mockPrisma.evidenceAttachment.findMany.mockResolvedValue([]);
    mockPrisma.eventLog.findMany.mockResolvedValue([]);
    mockPrisma.reconciliationReport.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: AnchorService, useValue: mockAnchor },
        { provide: ProofGeneratorService, useValue: mockProofGenerator },
        { provide: CRYPTO_SERVICE, useValue: mockCrypto },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(EvidenceService);
  });

  // ── paymentInstrument section ────────────────────────────

  describe("paymentInstrument section", () => {
    it("should be null when PO has no instrument", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.paymentInstrument).toBeNull();
    });

    it("should include instrument with lifecycle from ledger events", async () => {
      const instrument = {
        id: "pi-1",
        type: "ESCROW_LOCK",
        amount: 700000,
        currency: "SAR",
        status: "RELEASED",
        escrowReference: "ESCROW-001",
        bankReference: "SARIE-001",
        createdAt: new Date("2026-03-01"),
        lockedAt: new Date("2026-03-02"),
        releasedAt: new Date("2026-03-05"),
      };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        paymentInstrument: instrument,
      });

      // Return lifecycle events for the instrument entity
      mockPrisma.eventLog.findMany.mockImplementation(({ where }: any) => {
        if (where?.entityId === "pi-1") {
          return Promise.resolve([
            {
              id: "evt-1",
              eventType: "INSTRUMENT_CREATED",
              timestamp: new Date("2026-03-01T10:00:00Z"),
              payload: { status: "CREATED" },
              sequence: 1,
            },
            {
              id: "evt-2",
              eventType: "INSTRUMENT_LOCKED",
              timestamp: new Date("2026-03-02T10:00:00Z"),
              payload: { bankReference: "SARIE-001" },
              sequence: 2,
            },
            {
              id: "evt-3",
              eventType: "INSTRUMENT_RELEASED",
              timestamp: new Date("2026-03-05T10:00:00Z"),
              payload: { bankReference: "SARIE-001" },
              sequence: 3,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.paymentInstrument).toBeDefined();
      expect(pack.paymentInstrument!.instrumentId).toBe("pi-1");
      expect(pack.paymentInstrument!.type).toBe("ESCROW_LOCK");
      expect(pack.paymentInstrument!.amount).toBe(700000);
      expect(pack.paymentInstrument!.currency).toBe("SAR");
      expect(pack.paymentInstrument!.status).toBe("RELEASED");
      expect(pack.paymentInstrument!.escrowReference).toBe("ESCROW-001");
      expect(pack.paymentInstrument!.bankReference).toBe("SARIE-001");

      // Lifecycle should have 3 entries: CREATED → LOCKED → RELEASED
      expect(pack.paymentInstrument!.lifecycle).toHaveLength(3);
      expect(pack.paymentInstrument!.lifecycle[0].status).toBe("CREATED");
      expect(pack.paymentInstrument!.lifecycle[1].status).toBe("LOCKED");
      expect(pack.paymentInstrument!.lifecycle[1].bankRef).toBe("SARIE-001");
      expect(pack.paymentInstrument!.lifecycle[2].status).toBe("RELEASED");
    });

    it("should fall back to current state when no lifecycle events exist", async () => {
      const instrument = {
        id: "pi-2",
        type: "ESCROW_LOCK",
        amount: 500000,
        currency: "GBP",
        status: "CREATED",
        escrowReference: null,
        bankReference: null,
        createdAt: new Date("2026-03-10"),
        lockedAt: null,
        releasedAt: null,
      };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        paymentInstrument: instrument,
      });

      // No instrument events in ledger
      mockPrisma.eventLog.findMany.mockResolvedValue([]);

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.paymentInstrument).toBeDefined();
      expect(pack.paymentInstrument!.lifecycle).toHaveLength(1);
      expect(pack.paymentInstrument!.lifecycle[0].status).toBe("CREATED");
    });

    it("should include instrument entity in cross-entity chains", async () => {
      const instrument = {
        id: "pi-3",
        type: "ESCROW_LOCK",
        amount: 100000,
        currency: "GBP",
        status: "LOCKED",
        escrowReference: null,
        bankReference: "SARIE-003",
        createdAt: new Date("2026-03-01"),
      };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        paymentInstrument: instrument,
      });

      await service.buildEvidencePack("po-1");

      // proofGenerator.generateEntityProofs should have been called for
      // both the PO and the instrument
      const calls = mockProofGenerator.generateEntityProofs.mock.calls;
      const entityIds = calls.map((c: any[]) => c[0]);
      expect(entityIds).toContain("po-1");
      expect(entityIds).toContain("pi-3");
    });
  });

  // ── reconciliation section ───────────────────────────────

  describe("reconciliation section", () => {
    it("should be null when no reconciliation report exists", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });
      mockPrisma.reconciliationReport.findFirst.mockResolvedValue(null);

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.reconciliation).toBeNull();
    });

    it("should include CONSISTENT status when latest report has 0 mismatches", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });
      mockPrisma.reconciliationReport.findFirst.mockResolvedValue({
        id: "rr-1",
        runAt: new Date("2026-03-11T12:00:00Z"),
        totalChecked: 10,
        matched: 10,
        mismatches: 0,
        alerts: [],
        ledgerBalance: 700000,
        bankBalance: 700000,
        variance: 0,
      });

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.reconciliation).toBeDefined();
      expect(pack.reconciliation!.status).toBe("CONSISTENT");
      expect(pack.reconciliation!.lastChecked).toBe("2026-03-11T12:00:00.000Z");
      expect(pack.reconciliation!.bankBalance).toBe(700000);
      expect(pack.reconciliation!.ledgerBalance).toBe(700000);
      expect(pack.reconciliation!.variance).toBe(0);
    });

    it("should include MISMATCH_DETECTED status when report has mismatches", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });
      mockPrisma.reconciliationReport.findFirst.mockResolvedValue({
        id: "rr-2",
        runAt: new Date("2026-03-11T14:00:00Z"),
        totalChecked: 10,
        matched: 8,
        mismatches: 2,
        alerts: [],
        ledgerBalance: 700000,
        bankBalance: 690000,
        variance: 10000,
      });

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.reconciliation!.status).toBe("MISMATCH_DETECTED");
      expect(pack.reconciliation!.variance).toBe(10000);
    });
  });

  // ── verification checks ──────────────────────────────────

  describe("verification checks", () => {
    it("should include 13 checks (original 11 + checks 16 and 17)", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });

      const pack = await service.buildEvidencePack("po-1");

      expect(pack.verification.checksToPerform).toHaveLength(13);
    });

    it("should include instrument lifecycle integrity check", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });

      const pack = await service.buildEvidencePack("po-1");

      const lifecycleCheck = pack.verification.checksToPerform.find(
        (c: string) => c.includes("instrument lifecycle integrity"),
      );
      expect(lifecycleCheck).toBeDefined();
    });

    it("should include bank reference consistency check", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...basePO });

      const pack = await service.buildEvidencePack("po-1");

      const bankRefCheck = pack.verification.checksToPerform.find((c: string) =>
        c.includes("bank reference consistency"),
      );
      expect(bankRefCheck).toBeDefined();
    });
  });
});
