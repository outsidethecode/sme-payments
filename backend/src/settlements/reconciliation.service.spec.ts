import { Test, TestingModule } from "@nestjs/testing";
import { ReconciliationService } from "./reconciliation.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  SETTLEMENT_ADAPTER,
  TransferStatus,
} from "./settlement-adapter.interface";

describe("ReconciliationService", () => {
  let service: ReconciliationService;

  const mockPrisma = {
    paymentInstrument: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    settlement: {
      findMany: jest.fn(),
    },
    reconciliationReport: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  const mockLedger = {
    logEvent: jest.fn(),
  };

  const mockAdapter = {
    name: "SIMULATED",
    supportedCurrencies: ["GBP", "SAR"],
    reconcile: jest.fn(),
    reserveFunds: jest.fn(),
    releaseFunds: jest.fn(),
    transferFunds: jest.fn(),
    refund: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: SETTLEMENT_ADAPTER, useValue: mockAdapter },
      ],
    }).compile();

    service = module.get(ReconciliationService);

    // Default: no admin user (avoids ledger event requirement in most tests)
    mockPrisma.user.findFirst.mockResolvedValue(null);
  });

  // ── runReconciliation: empty state ──────────────────────

  describe("runReconciliation — empty state", () => {
    it("should return a clean report when no instruments or settlements need reconciliation", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-1",
      });

      const result = await service.runReconciliation();

      expect(result.totalChecked).toBe(0);
      expect(result.matched).toBe(0);
      expect(result.mismatches).toBe(0);
      expect(result.alerts).toEqual([]);
      expect(result.ledgerBalance).toBe(0);
      expect(result.variance).toBeNull();

      expect(mockPrisma.reconciliationReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalChecked: 0,
          matched: 0,
          mismatches: 0,
        }),
      });
    });
  });

  // ── runReconciliation: instrument matches ───────────────

  describe("runReconciliation — instrument matches", () => {
    it("should count LOCK_REQUESTED instrument as matched when rail says PENDING", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-1",
          status: "LOCK_REQUESTED",
          bankReference: "REF-001",
          createdAt: new Date(), // fresh — not stale
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-2",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "REF-001",
        status: TransferStatus.PENDING,
      });

      const result = await service.runReconciliation();

      expect(result.totalChecked).toBe(1);
      expect(result.matched).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it("should count LOCK_REQUESTED instrument as matched when rail says RESERVED", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-2",
          status: "LOCK_REQUESTED",
          bankReference: "REF-002",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-3",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "REF-002",
        status: TransferStatus.RESERVED,
      });

      const result = await service.runReconciliation();

      expect(result.matched).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it("should count SETTLEMENT_PENDING instrument as matched when rail says COMPLETED", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-3",
          status: "SETTLEMENT_PENDING",
          bankReference: "REF-003",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-4",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "REF-003",
        status: TransferStatus.COMPLETED,
      });

      const result = await service.runReconciliation();

      expect(result.matched).toBe(1);
      expect(result.mismatches).toBe(0);
    });
  });

  // ── runReconciliation: instrument mismatches ────────────

  describe("runReconciliation — instrument mismatches", () => {
    it("should flag LOCK_REQUESTED instrument when rail says FAILED", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-4",
          status: "LOCK_REQUESTED",
          bankReference: "REF-004",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-5",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "REF-004",
        status: TransferStatus.FAILED,
      });

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]).toMatchObject({
        instrumentId: "instr-4",
        expected: "LOCK_REQUESTED",
        actual: "FAILED",
        externalRef: "REF-004",
      });
    });
  });

  // ── runReconciliation: stale instruments ────────────────

  describe("runReconciliation — stale instruments", () => {
    it("should flag instruments stuck for more than 30 minutes", async () => {
      const staleDate = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-stale",
          status: "LOCK_REQUESTED",
          bankReference: "REF-STALE",
          createdAt: staleDate,
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-stale",
      });

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.alerts[0]).toMatchObject({
        instrumentId: "instr-stale",
        expected: "LOCK_REQUESTED",
        actual: "STALE",
      });
      expect(result.alerts[0].reason).toContain("stuck");
      expect(result.alerts[0].reason).toContain("45");
    });

    it("should NOT flag instruments under 30 minutes as stale", async () => {
      const freshDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-fresh",
          status: "LOCK_REQUESTED",
          bankReference: "REF-FRESH",
          createdAt: freshDate,
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-fresh",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "REF-FRESH",
        status: TransferStatus.PENDING,
      });

      const result = await service.runReconciliation();

      expect(result.matched).toBe(1);
      expect(result.mismatches).toBe(0);
    });
  });

  // ── runReconciliation: settlement reconciliation ────────

  describe("runReconciliation — settlement reconciliation", () => {
    it("should count PROCESSING settlement as matched when rail says PENDING", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([
        {
          id: "settle-1",
          status: "PROCESSING",
          externalRef: "EXT-001",
        },
      ]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-s1",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "EXT-001",
        status: TransferStatus.PENDING,
      });

      const result = await service.runReconciliation();

      expect(result.totalChecked).toBe(1);
      expect(result.matched).toBe(1);
    });

    it("should flag PROCESSING settlement when rail says FAILED", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([
        {
          id: "settle-2",
          status: "PROCESSING",
          externalRef: "EXT-002",
        },
      ]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-s2",
      });

      mockAdapter.reconcile.mockResolvedValue({
        externalRef: "EXT-002",
        status: TransferStatus.FAILED,
      });

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.alerts[0]).toMatchObject({
        settlementId: "settle-2",
        expected: "PROCESSING",
        actual: "FAILED",
      });
    });

    it("should count settlement without externalRef as matched", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([
        {
          id: "settle-3",
          status: "PROCESSING",
          externalRef: null,
        },
      ]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-s3",
      });

      const result = await service.runReconciliation();

      expect(result.matched).toBe(1);
      expect(result.mismatches).toBe(0);
      // Should NOT call adapter.reconcile for null refs
      expect(mockAdapter.reconcile).not.toHaveBeenCalled();
    });
  });

  // ── runReconciliation: adapter errors ───────────────────

  describe("runReconciliation — adapter errors", () => {
    it("should handle adapter reconcile errors gracefully for instruments", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-err",
          status: "LOCK_REQUESTED",
          bankReference: "REF-ERR",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-err",
      });

      mockAdapter.reconcile.mockRejectedValue(new Error("Bank unavailable"));

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.alerts[0]).toMatchObject({
        instrumentId: "instr-err",
        actual: "ERROR",
        reason: expect.stringContaining("Bank unavailable"),
      });
    });

    it("should handle adapter reconcile errors gracefully for settlements", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([
        {
          id: "settle-err",
          status: "PROCESSING",
          externalRef: "EXT-ERR",
        },
      ]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-err2",
      });

      mockAdapter.reconcile.mockRejectedValue(new Error("Timeout"));

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.alerts[0]).toMatchObject({
        settlementId: "settle-err",
        actual: "ERROR",
        reason: expect.stringContaining("Timeout"),
      });
    });
  });

  // ── runReconciliation: ledger balance ───────────────────

  describe("runReconciliation — ledger balance", () => {
    it("should compute ledger balance from LOCKED instruments", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 500_000 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-bal",
      });

      const result = await service.runReconciliation();

      expect(result.ledgerBalance).toBe(500_000);
      expect(mockPrisma.paymentInstrument.aggregate).toHaveBeenCalledWith({
        where: { status: "LOCKED" },
        _sum: { amount: true },
      });
    });
  });

  // ── runReconciliation: ledger event ─────────────────────

  describe("runReconciliation — ledger event", () => {
    it("should log BANK_RECONCILIATION_COMPLETED event when admin user exists", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-led",
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: "admin-1" });

      await service.runReconciliation();

      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "RECONCILIATION",
          entityId: "report-led",
          eventType: "BANK_RECONCILIATION_COMPLETED",
          actorId: "admin-1",
          actorRole: "SYSTEM",
          payload: expect.objectContaining({
            source: "RECONCILIATION_ENGINE",
          }),
        }),
      );
    });

    it("should skip ledger event when no admin user exists", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-noadmin",
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await service.runReconciliation();

      expect(mockLedger.logEvent).not.toHaveBeenCalled();
    });
  });

  // ── runReconciliation: mixed scenario ───────────────────

  describe("runReconciliation — mixed instruments and settlements", () => {
    it("should reconcile multiple instruments and settlements in one run", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-a",
          status: "LOCK_REQUESTED",
          bankReference: "REF-A",
          createdAt: new Date(),
        },
        {
          id: "instr-b",
          status: "SETTLEMENT_PENDING",
          bankReference: "REF-B",
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([
        {
          id: "settle-a",
          status: "PROCESSING",
          externalRef: "EXT-A",
        },
      ]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 300_000 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-mix",
      });

      mockAdapter.reconcile
        .mockResolvedValueOnce({
          externalRef: "REF-A",
          status: TransferStatus.PENDING,
        })
        .mockResolvedValueOnce({
          externalRef: "REF-B",
          status: TransferStatus.FAILED,
        }) // mismatch
        .mockResolvedValueOnce({
          externalRef: "EXT-A",
          status: TransferStatus.COMPLETED,
        }); // matched

      const result = await service.runReconciliation();

      expect(result.totalChecked).toBe(3);
      expect(result.matched).toBe(2);
      expect(result.mismatches).toBe(1);
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].instrumentId).toBe("instr-b");
      expect(result.ledgerBalance).toBe(300_000);
    });
  });

  // ── runReconciliation: instrument without bankReference ─

  describe("runReconciliation — instrument without bankReference", () => {
    it("should count instrument without bankReference as matched (no adapter call)", async () => {
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([
        {
          id: "instr-noref",
          status: "LOCK_REQUESTED",
          bankReference: null,
          createdAt: new Date(),
        },
      ]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-noref",
      });

      const result = await service.runReconciliation();

      expect(result.matched).toBe(1);
      expect(mockAdapter.reconcile).not.toHaveBeenCalled();
    });
  });

  // ── handleCron ──────────────────────────────────────────

  describe("handleCron", () => {
    it("should skip if last run was within the interval", async () => {
      // Last run 10 minutes ago, default interval = 60 minutes
      mockPrisma.reconciliationReport.findFirst.mockResolvedValue({
        runAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      await service.handleCron();

      // Should NOT have called findMany (i.e., should NOT have run reconciliation)
      expect(mockPrisma.paymentInstrument.findMany).not.toHaveBeenCalled();
    });

    it("should run if no previous report exists", async () => {
      mockPrisma.reconciliationReport.findFirst
        .mockResolvedValueOnce(null) // cron check: no last report
        .mockResolvedValueOnce(null); // getLatest if called
      mockPrisma.paymentInstrument.findMany.mockResolvedValue([]);
      mockPrisma.settlement.findMany.mockResolvedValue([]);
      mockPrisma.paymentInstrument.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.reconciliationReport.create.mockResolvedValue({
        id: "report-cron",
      });

      await service.handleCron();

      // Should have run reconciliation
      expect(mockPrisma.paymentInstrument.findMany).toHaveBeenCalled();
    });
  });

  // ── getReports ──────────────────────────────────────────

  describe("getReports", () => {
    it("should return paginated reports", async () => {
      const reports = [{ id: "r1" }, { id: "r2" }];
      mockPrisma.reconciliationReport.findMany.mockResolvedValue(reports);

      const result = await service.getReports(10, 5);

      expect(result).toEqual(reports);
      expect(mockPrisma.reconciliationReport.findMany).toHaveBeenCalledWith({
        orderBy: { runAt: "desc" },
        take: 10,
        skip: 5,
      });
    });
  });

  // ── getLatest ───────────────────────────────────────────

  describe("getLatest", () => {
    it("should return the most recent report", async () => {
      const report = { id: "r-latest", runAt: new Date() };
      mockPrisma.reconciliationReport.findFirst.mockResolvedValueOnce(report);

      const result = await service.getLatest();

      expect(result).toEqual(report);
      expect(mockPrisma.reconciliationReport.findFirst).toHaveBeenCalledWith({
        orderBy: { runAt: "desc" },
      });
    });

    it("should return null when no reports exist", async () => {
      mockPrisma.reconciliationReport.findFirst.mockResolvedValue(null);

      const result = await service.getLatest();

      expect(result).toBeNull();
    });
  });
});
