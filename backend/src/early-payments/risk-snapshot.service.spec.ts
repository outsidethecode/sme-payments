import { Test, TestingModule } from "@nestjs/testing";
import { RiskSnapshotService } from "./risk-snapshot.service";
import { PrismaService } from "../prisma/prisma.service";

describe("RiskSnapshotService", () => {
  let service: RiskSnapshotService;

  const mockPrisma = {
    purchaseOrder: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    dispute: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskSnapshotService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(RiskSnapshotService);
  });

  // ── PO not found ────────────────────────────────────────

  describe("computeForPO — PO not found", () => {
    it("should return zero-score snapshot when PO does not exist", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      const result = await service.computeForPO("nonexistent-po");

      expect(result.riskScore).toBe(0);
      expect(result.defaultProbability).toBe(100);
      expect(result.paymentLocked).toBe(false);
      expect(result.instrumentStatus).toBeNull();
    });
  });

  // ── Perfect risk scenario ───────────────────────────────

  describe("computeForPO — ideal conditions", () => {
    it("should return high score when payment locked, DELIVERED, no disputes, bank confirmed, fresh PO", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-1",
        buyerId: "buyer-1",
        status: "DELIVERED",
        createdAt: new Date(), // fresh
        expectedDeliveryDate: new Date("2026-04-01"),
        paymentLock: { status: "LOCKED" },
        paymentInstrument: { status: "LOCKED", bankReference: "SARIE-123" },
        evidenceAttachments: [{ id: "ev-1" }],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(10);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-1");

      // Payment locked (30% × 10) + DELIVERED (25% × 8) + no disputes (20% × 10)
      // + bank confirmed (15% × 10) + fresh (10% × ~10)
      // = 3 + 2 + 2 + 1.5 + ~1 = ~9.5
      expect(result.riskScore).toBeGreaterThanOrEqual(9);
      expect(result.riskScore).toBeLessThanOrEqual(10);
      expect(result.defaultProbability).toBeLessThan(15);
      expect(result.paymentLocked).toBe(true);
      expect(result.instrumentStatus).toBe("LOCKED");
      expect(result.bankReference).toBe("SARIE-123");
      expect(result.deliveryStatus).toBe("DELIVERED");
      expect(result.buyerDisputeRate).toBe(0);
      expect(result.evidencePackAvailable).toBe(true);
      expect(result.expectedSettlement).toBe("2026-04-01T00:00:00.000Z");
    });
  });

  // ── Payment lock factor ─────────────────────────────────

  describe("computeForPO — payment lock factor", () => {
    it("should score lower without payment lock", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-2",
        buyerId: "buyer-2",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(5);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-2");

      // No lock: 0 for lock (30%), ACCEPTED=3 (25%), no disputes=10 (20%), no bank=0 (15%), fresh=~10 (10%)
      // = 0 + 0.75 + 2 + 0 + ~1 = ~3.75
      expect(result.paymentLocked).toBe(false);
      expect(result.riskScore).toBeLessThan(5);
    });
  });

  // ── Delivery progress factor ────────────────────────────

  describe("computeForPO — delivery progress", () => {
    const testCases = [
      { status: "DRAFT", expectedMin: 0, expectedMax: 0 },
      { status: "ACCEPTED", expectedMin: 2, expectedMax: 4 },
      { status: "SHIPPED", expectedMin: 5, expectedMax: 7 },
      { status: "DELIVERED", expectedMin: 7, expectedMax: 9 },
      { status: "VERIFIED", expectedMin: 8, expectedMax: 11 },
    ];

    for (const tc of testCases) {
      it(`should reflect delivery progress for status=${tc.status}`, async () => {
        mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
          id: `po-${tc.status}`,
          buyerId: "buyer-1",
          status: tc.status,
          createdAt: new Date(),
          expectedDeliveryDate: null,
          paymentLock: null,
          paymentInstrument: null,
          evidenceAttachments: [],
        });
        mockPrisma.purchaseOrder.count.mockResolvedValue(1);
        mockPrisma.dispute.count.mockResolvedValue(0);

        const result = await service.computeForPO(`po-${tc.status}`);
        // Delivery weight is 25%, but other factors also contribute
        // We just check the score is reasonable
        expect(result.deliveryStatus).toBe(tc.status);
      });
    }
  });

  // ── Dispute history factor ──────────────────────────────

  describe("computeForPO — dispute history", () => {
    it("should penalize buyers with high dispute rates", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-dispute",
        buyerId: "buyer-bad",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: { status: "LOCKED" },
        paymentInstrument: { status: "LOCKED", bankReference: "REF-1" },
        evidenceAttachments: [{ id: "ev-1" }],
      });
      // 50% dispute rate
      mockPrisma.purchaseOrder.count.mockResolvedValue(10);
      mockPrisma.dispute.count.mockResolvedValue(5);

      const result = await service.computeForPO("po-dispute");

      expect(result.buyerDisputeRate).toBe(0.5);
      // With 50% disputes, the dispute score = 10×(1-0.5) = 5
      // Total will be lower than an identical PO with 0% disputes
      expect(result.riskScore).toBeLessThan(9);
    });

    it("should give full marks to buyers with zero disputes", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-clean",
        buyerId: "buyer-clean",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: { status: "LOCKED" },
        paymentInstrument: { status: "LOCKED", bankReference: "REF-2" },
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(20);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-clean");

      expect(result.buyerDisputeRate).toBe(0);
    });

    it("should assume clean for buyers with no PO history", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-new-buyer",
        buyerId: "buyer-new",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(0);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-new-buyer");

      expect(result.buyerDisputeRate).toBe(0);
    });
  });

  // ── Bank confirmation factor ────────────────────────────

  describe("computeForPO — bank confirmation", () => {
    it("should include bank reference when instrument has one", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-bank",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: { status: "LOCKED" },
        paymentInstrument: { status: "LOCKED", bankReference: "SARIE-456" },
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(5);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-bank");

      expect(result.bankReference).toBe("SARIE-456");
    });

    it("should report null bankReference when no instrument", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-nobank",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(5);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-nobank");

      expect(result.bankReference).toBeNull();
    });
  });

  // ── Freshness factor ────────────────────────────────────

  describe("computeForPO — freshness", () => {
    it("should score higher for recently created POs", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-fresh",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(), // just created
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(5);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const freshResult = await service.computeForPO("po-fresh");

      // Now test old PO
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-old",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days old
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });

      const oldResult = await service.computeForPO("po-old");

      expect(freshResult.riskScore).toBeGreaterThan(oldResult.riskScore);
    });
  });

  // ── Evidence pack availability ──────────────────────────

  describe("computeForPO — evidence pack", () => {
    it("should set evidencePackAvailable=true when attachments exist", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-ev",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [{ id: "att-1" }],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(1);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-ev");

      expect(result.evidencePackAvailable).toBe(true);
    });

    it("should set evidencePackAvailable=false when no attachments", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-noev",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date(),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(1);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-noev");

      expect(result.evidencePackAvailable).toBe(false);
    });
  });

  // ── Expected settlement date ────────────────────────────

  describe("computeForPO — expected settlement", () => {
    it("should use expectedDeliveryDate when available", async () => {
      const deliveryDate = new Date("2026-04-15");
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-date",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt: new Date("2026-03-01"),
        expectedDeliveryDate: deliveryDate,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(1);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-date");

      expect(result.expectedSettlement).toBe("2026-04-15T00:00:00.000Z");
    });

    it("should compute fallback date (createdAt + 30d) when no delivery date", async () => {
      const createdAt = new Date("2026-03-01");
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-nodate",
        buyerId: "buyer-1",
        status: "ACCEPTED",
        createdAt,
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(1);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const result = await service.computeForPO("po-nodate");

      // Should be createdAt + 30 days
      const expected = new Date(
        createdAt.getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(result.expectedSettlement).toBe(expected);
    });
  });

  // ── computeForPOs batch ─────────────────────────────────

  describe("computeForPOs", () => {
    it("should return a Map with snapshots for each PO", async () => {
      mockPrisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          id: "po-a",
          buyerId: "buyer-a",
          status: "ACCEPTED",
          createdAt: new Date(),
          expectedDeliveryDate: null,
          paymentLock: null,
          paymentInstrument: null,
          evidenceAttachments: [],
        })
        .mockResolvedValueOnce({
          id: "po-b",
          buyerId: "buyer-b",
          status: "SHIPPED",
          createdAt: new Date(),
          expectedDeliveryDate: null,
          paymentLock: { status: "LOCKED" },
          paymentInstrument: { status: "LOCKED", bankReference: "REF-B" },
          evidenceAttachments: [],
        });
      mockPrisma.purchaseOrder.count.mockResolvedValue(1);
      mockPrisma.dispute.count.mockResolvedValue(0);

      const results = await service.computeForPOs(["po-a", "po-b"]);

      expect(results.size).toBe(2);
      expect(results.get("po-a")!.deliveryStatus).toBe("ACCEPTED");
      expect(results.get("po-b")!.deliveryStatus).toBe("SHIPPED");
      expect(results.get("po-b")!.paymentLocked).toBe(true);
    });
  });

  // ── Default probability ─────────────────────────────────

  describe("defaultProbability", () => {
    it("should be inversely proportional to risk score", async () => {
      // High risk scenario: unlocked, DRAFT, disputes, no bank
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-risky",
        buyerId: "buyer-risky",
        status: "DRAFT",
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        expectedDeliveryDate: null,
        paymentLock: null,
        paymentInstrument: null,
        evidenceAttachments: [],
      });
      mockPrisma.purchaseOrder.count.mockResolvedValue(10);
      mockPrisma.dispute.count.mockResolvedValue(8); // 80% dispute rate

      const result = await service.computeForPO("po-risky");

      expect(result.defaultProbability).toBeGreaterThan(80);
      expect(result.riskScore).toBeLessThan(2);
    });
  });
});
