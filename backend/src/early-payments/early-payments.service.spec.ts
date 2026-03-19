import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { EarlyPaymentsService } from "./early-payments.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { PoliciesService } from "../policies/policies.service";
import { PolicyEvaluationService } from "../policies/policy-evaluation.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementService } from "../settlements/settlement.service";
import { InstrumentService } from "../settlements/instrument.service";
import { RiskSnapshotService } from "./risk-snapshot.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

// Mock requireSignature to no-op in unit tests (it has its own spec)
jest.mock("../ledger/ledger.service", () => ({
  ...jest.requireActual("../ledger/ledger.service"),
  requireSignature: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────

const SUPPLIER_ID = "supplier-1";
const BUYER_ID = "buyer-1";
const LP_ID = "lp-1";
const PO_ID = "po-1";
const EP_ID = "ep-1";
const INSTRUMENT_ID = "instrument-1";
const ORG_SUPPLIER = { id: "org-supplier", bankIban: "SA000111" };
const ORG_BUYER = { id: "org-buyer", bankIban: "SA000222" };
const ORG_LP = { id: "org-lp", bankIban: "SA000333" };

function makePO(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    buyerId: BUYER_ID,
    supplierId: SUPPLIER_ID,
    status: "FULFILLMENT",
    amount: 100_000,
    currency: "SAR",
    referenceNumber: "PO-TEST-001",
    paymentLock: { id: "lock-1", status: "LOCKED", amount: 100_000 },
    buyer: {
      id: BUYER_ID,
      email: "b@test.com",
      name: "Buyer",
      role: "BUYER",
      companyName: "Buyer Co",
    },
    supplier: {
      id: SUPPLIER_ID,
      email: "s@test.com",
      name: "Supplier",
      role: "SUPPLIER",
      companyName: "Supplier Co",
    },
    ...overrides,
  };
}

function makeEPRequest(overrides: Record<string, unknown> = {}) {
  const po = makePO();
  return {
    id: EP_ID,
    purchaseOrderId: PO_ID,
    supplierId: SUPPLIER_ID,
    liquidityPartnerId: null,
    faceValue: 100_000,
    serviceFee: 2_500,
    netAdvance: 97_500,
    currency: "SAR",
    status: "REQUESTED",
    riskAcknowledged: false,
    fundedAt: null,
    settledAt: null,
    createdAt: new Date(),
    purchaseOrder: po,
    supplier: po.supplier,
    liquidityPartner: null,
    ...overrides,
  };
}

const policyAllowed = {
  allowed: true,
  requiresApproval: false,
  reason: "auto-approved",
};
const policyDenied = {
  allowed: false,
  requiresApproval: false,
  reason: "denied by policy",
};
const policyPendingApproval = {
  allowed: false,
  requiresApproval: true,
  reason: "needs approval",
  approvalRequestId: "approval-1",
};

// ── Mocks ─────────────────────────────────────────────────────

const mockPrisma = {
  purchaseOrder: { findUnique: jest.fn() },
  earlyPaymentRequest: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  paymentInstrument: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  platformFee: { create: jest.fn() },
  $transaction: jest.fn((fn: (tx: any) => any) =>
    fn({
      earlyPaymentRequest: {
        update: jest
          .fn()
          .mockResolvedValue(
            makeEPRequest({ status: "FUNDED", liquidityPartnerId: LP_ID }),
          ),
      },
      platformFee: { create: jest.fn() },
    }),
  ),
};

const mockLedger = {
  logEvent: jest.fn().mockResolvedValue({ id: "evt-1", eventType: "test" }),
  buildReceipt: jest.fn().mockReturnValue({ hash: "abc" }),
};

const mockPolicies = {
  evaluateLPFunding: jest.fn().mockResolvedValue({ allowed: true }),
};

const mockPolicyEngine = {
  evaluateForActor: jest.fn().mockResolvedValue(policyAllowed),
};

const mockOrgs = {
  getOrgByUserId: jest.fn((userId: string) => {
    if (userId === SUPPLIER_ID) return ORG_SUPPLIER;
    if (userId === BUYER_ID) return ORG_BUYER;
    if (userId === LP_ID) return ORG_LP;
    return null;
  }),
};

const mockSettlement = {
  transferAdvance: jest.fn().mockResolvedValue({ externalRef: "ext-123" }),
  getAdapterName: jest.fn().mockReturnValue("mock-adapter"),
};

const mockInstrumentService = {
  requestFinancing: jest.fn(),
  confirmFinancing: jest.fn(),
  revertFinancing: jest.fn(),
};

const mockRiskSnapshot = {
  computeForPOs: jest.fn().mockResolvedValue(new Map()),
  computeForPO: jest.fn().mockResolvedValue(null),
};

const mockFeatureFlags = {
  isEnabled: jest.fn().mockResolvedValue(true),
};

// ── Test Suite ────────────────────────────────────────────────

describe("EarlyPaymentsService", () => {
  let service: EarlyPaymentsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    // Re-apply defaults after reset
    mockFeatureFlags.isEnabled.mockResolvedValue(true);
    mockPolicyEngine.evaluateForActor.mockResolvedValue(policyAllowed);
    mockPolicies.evaluateLPFunding.mockResolvedValue({ allowed: true });
    mockLedger.logEvent.mockResolvedValue({ id: "evt-1", eventType: "test" });
    mockLedger.buildReceipt.mockReturnValue({ hash: "abc" });
    mockSettlement.transferAdvance.mockResolvedValue({
      externalRef: "ext-123",
    });
    mockSettlement.getAdapterName.mockReturnValue("mock-adapter");
    mockOrgs.getOrgByUserId.mockImplementation((userId: string) => {
      if (userId === SUPPLIER_ID) return ORG_SUPPLIER;
      if (userId === BUYER_ID) return ORG_BUYER;
      if (userId === LP_ID) return ORG_LP;
      return null;
    });
    mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) =>
      fn({
        earlyPaymentRequest: {
          update: jest
            .fn()
            .mockResolvedValue(
              makeEPRequest({ status: "FUNDED", liquidityPartnerId: LP_ID }),
            ),
        },
        platformFee: { create: jest.fn() },
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EarlyPaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: PoliciesService, useValue: mockPolicies },
        { provide: PolicyEvaluationService, useValue: mockPolicyEngine },
        { provide: OrganisationsService, useValue: mockOrgs },
        { provide: SettlementService, useValue: mockSettlement },
        { provide: InstrumentService, useValue: mockInstrumentService },
        { provide: RiskSnapshotService, useValue: mockRiskSnapshot },
        { provide: FeatureFlagService, useValue: mockFeatureFlags },
      ],
    }).compile();

    service = module.get(EarlyPaymentsService);
  });

  // ══════════════════════════════════════════════════════════
  // requestEarlyPayment
  // ══════════════════════════════════════════════════════════

  describe("requestEarlyPayment", () => {
    // ── Feature flag gate ─────────────────────────────────

    it("should throw ForbiddenException when EARLY_PAYMENTS feature is disabled", async () => {
      mockFeatureFlags.isEnabled.mockResolvedValue(false);

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow("Early payments feature is not enabled");
    });

    // ── PO not found ──────────────────────────────────────

    it("should throw NotFoundException when PO does not exist", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    // ── Identity check: only the supplier ─────────────────

    it("should throw ForbiddenException when non-supplier tries to request", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());

      await expect(
        service.requestEarlyPayment(PO_ID, BUYER_ID),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.requestEarlyPayment(PO_ID, BUYER_ID),
      ).rejects.toThrow("Only the supplier");
    });

    // ── Status eligibility ────────────────────────────────

    describe("status eligibility", () => {
      it.each([
        "DRAFT",
        "SENT",
        "ACCEPTED",
        "NEGOTIATION",
        "REJECTED",
        "SETTLED",
        "DISPUTED",
      ])("should reject PO in %s status", async (status) => {
        mockPrisma.purchaseOrder.findUnique.mockResolvedValue(
          makePO({ status }),
        );

        await expect(
          service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
        ).rejects.toThrow("FULFILLMENT, SHIPPED, or DELIVERED");
      });

      it.each(["FULFILLMENT", "SHIPPED", "DELIVERED"])(
        "should accept PO in %s status",
        async (status) => {
          mockPrisma.purchaseOrder.findUnique.mockResolvedValue(
            makePO({ status }),
          );
          mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
            id: INSTRUMENT_ID,
            purchaseOrderId: PO_ID,
          });
          mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
          mockPrisma.earlyPaymentRequest.create.mockResolvedValue(
            makeEPRequest({ status: "REQUESTED" }),
          );

          const result = await service.requestEarlyPayment(PO_ID, SUPPLIER_ID);
          expect(result).toBeDefined();
        },
      );
    });

    // ── Payment lock required ─────────────────────────────

    it("should reject when PO has no paymentLock", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(
        makePO({ paymentLock: null }),
      );

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow("locked payment");
    });

    it("should reject when paymentLock is not in LOCKED status", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(
        makePO({
          paymentLock: { id: "lock-1", status: "RELEASED", amount: 100_000 },
        }),
      );

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    // ── Policy engine gate ────────────────────────────────

    it("should throw ForbiddenException when policy engine denies", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());
      mockPolicyEngine.evaluateForActor.mockResolvedValue(policyDenied);

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return pending approval when policy requires it", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());
      mockPolicyEngine.evaluateForActor.mockResolvedValue(
        policyPendingApproval,
      );

      const result = await service.requestEarlyPayment(PO_ID, SUPPLIER_ID);
      expect(result.pendingApproval).toBe(true);
      expect(result.approvalRequestId).toBe("approval-1");
    });

    // ── Instrument guard ──────────────────────────────────

    it("should throw when PO has no payment instrument", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue(null);

      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.requestEarlyPayment(PO_ID, SUPPLIER_ID),
      ).rejects.toThrow("no payment instrument");
    });

    // ── Idempotency: existing request ─────────────────────

    it("should return existing request instead of creating duplicate", async () => {
      const existing = makeEPRequest();
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: INSTRUMENT_ID,
      });
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(existing);

      const result = await service.requestEarlyPayment(PO_ID, SUPPLIER_ID);
      expect(result).toBeDefined();
      expect(mockPrisma.earlyPaymentRequest.create).not.toHaveBeenCalled();
    });

    // ── Success path ──────────────────────────────────────

    it("should create request, transition instrument, and log event on success", async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(makePO());
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: INSTRUMENT_ID,
        purchaseOrderId: PO_ID,
      });
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
      const created = makeEPRequest({ status: "REQUESTED" });
      mockPrisma.earlyPaymentRequest.create.mockResolvedValue(created);

      const result = await service.requestEarlyPayment(PO_ID, SUPPLIER_ID);

      expect(mockInstrumentService.requestFinancing).toHaveBeenCalledWith(
        INSTRUMENT_ID,
        SUPPLIER_ID,
      );
      expect(mockPrisma.earlyPaymentRequest.create).toHaveBeenCalled();
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "EARLY_PAYMENT",
          eventType: "EARLY_PAY_REQUESTED",
          actorId: SUPPLIER_ID,
        }),
      );
      expect(result).toHaveProperty("_receipt");
    });

    // ── Fee calculation ───────────────────────────────────

    it("should compute 2.5% fee correctly", async () => {
      const po = makePO({ amount: 200_000 }); // 2000.00 SAR
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(po);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: INSTRUMENT_ID,
        purchaseOrderId: PO_ID,
      });
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);
      mockPrisma.earlyPaymentRequest.create.mockImplementation(({ data }) => {
        return Promise.resolve(
          makeEPRequest({
            faceValue: data.faceValue,
            serviceFee: data.serviceFee,
            netAdvance: data.netAdvance,
          }),
        );
      });

      await service.requestEarlyPayment(PO_ID, SUPPLIER_ID);

      const createCall = mockPrisma.earlyPaymentRequest.create.mock.calls[0][0];
      expect(createCall.data.faceValue).toBe(200_000);
      expect(createCall.data.serviceFee).toBe(5_000); // 2.5% of 200,000
      expect(createCall.data.netAdvance).toBe(195_000);
    });
  });

  // ══════════════════════════════════════════════════════════
  // findAll
  // ══════════════════════════════════════════════════════════

  describe("findAll", () => {
    it("should filter by supplierId for SUPPLIER role", async () => {
      mockPrisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      await service.findAll(SUPPLIER_ID, "SUPPLIER");

      expect(mockPrisma.earlyPaymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: SUPPLIER_ID },
        }),
      );
    });

    it("should show REQUESTED + own funded for LP role", async () => {
      mockPrisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      await service.findAll(LP_ID, "LIQUIDITY_PARTNER");

      expect(mockPrisma.earlyPaymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ status: "REQUESTED" }, { liquidityPartnerId: LP_ID }],
          },
        }),
      );
    });

    it("should show all for ADMIN role (no where filter on ID)", async () => {
      mockPrisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      await service.findAll("admin-1", "ADMIN");

      const call = mockPrisma.earlyPaymentRequest.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty("supplierId");
      expect(call.where).not.toHaveProperty("OR");
    });
  });

  // ══════════════════════════════════════════════════════════
  // findById
  // ══════════════════════════════════════════════════════════

  describe("findById", () => {
    it("should throw NotFoundException when request does not exist", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);

      await expect(service.findById("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return formatted request when found", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );

      const result = await service.findById(EP_ID);
      expect(result.id).toBe(EP_ID);
      expect(result.faceValuePennies).toBe(100_000);
      expect(result.status).toBe("REQUESTED");
    });
  });

  // ══════════════════════════════════════════════════════════
  // fund
  // ══════════════════════════════════════════════════════════

  describe("fund", () => {
    const lpUser = {
      id: LP_ID,
      role: "LIQUIDITY_PARTNER",
      balance: 1_000_000,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(lpUser);
      mockPrisma.paymentInstrument.findUnique.mockResolvedValue({
        id: INSTRUMENT_ID,
        purchaseOrderId: PO_ID,
      });
    });

    // ── Not found ─────────────────────────────────────────

    it("should throw NotFoundException when request does not exist", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(null);

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    // ── Idempotency: already funded by same LP ────────────

    it("should return existing when already FUNDED by same LP", async () => {
      const funded = makeEPRequest({
        status: "FUNDED",
        liquidityPartnerId: LP_ID,
      });
      mockPrisma.earlyPaymentRequest.findUnique
        .mockResolvedValueOnce(funded) // first call: initial fetch
        .mockResolvedValueOnce(funded); // second call: full fetch

      const result = await service.fund(EP_ID, LP_ID);
      expect(result).toBeDefined();
      // Should NOT try to fund again
      expect(mockInstrumentService.confirmFinancing).not.toHaveBeenCalled();
    });

    // ── Status guard ──────────────────────────────────────

    it("should throw when request is not in REQUESTED status", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest({ status: "EXPIRED" }),
      );

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        "Cannot fund a request in EXPIRED status",
      );
    });

    // ── PO in unfundable status ───────────────────────────

    it("should expire request and throw when PO is SETTLED", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest({
          purchaseOrder: makePO({ status: "SETTLED" }),
        }),
      );

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.earlyPaymentRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "EXPIRED" },
        }),
      );
    });

    it.each(["FULFILLMENT", "SHIPPED", "DELIVERED"])(
      "should allow funding when PO is in %s status",
      async (status) => {
        mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
          makeEPRequest({ purchaseOrder: makePO({ status }) }),
        );

        const result = await service.fund(EP_ID, LP_ID);
        expect(result).toBeDefined();
      },
    );

    // ── Non-LP user ───────────────────────────────────────

    it("should throw ForbiddenException when non-LP tries to fund", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "buyer-1",
        role: "BUYER",
        balance: 1_000_000,
      });

      await expect(service.fund(EP_ID, "buyer-1")).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.fund(EP_ID, "buyer-1")).rejects.toThrow(
        "Only liquidity partners",
      );
    });

    // ── Insufficient balance ──────────────────────────────

    it("should throw when LP has insufficient balance", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        id: LP_ID,
        role: "LIQUIDITY_PARTNER",
        balance: 100, // far too low
      });

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        "Insufficient balance",
      );
    });

    // ── Policy engine gate ────────────────────────────────

    it("should throw when LP funding policy denies", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockPolicyEngine.evaluateForActor.mockResolvedValue(policyDenied);

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should return pending when LP funding policy requires approval", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockPolicyEngine.evaluateForActor.mockResolvedValue(
        policyPendingApproval,
      );

      const result = await service.fund(EP_ID, LP_ID);
      expect(result.pendingApproval).toBe(true);
    });

    // ── LP funding policy (concentration) ─────────────────

    it("should throw when LP funding concentration check fails", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockPolicies.evaluateLPFunding.mockResolvedValue({
        allowed: false,
        reason: "Buyer concentration > 35%",
      });

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow(
        "Funding blocked by policy",
      );
    });

    // ── Transfer failure → compensate ─────────────────────

    it("should revert instrument financing when transfer fails", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );
      mockSettlement.transferAdvance.mockRejectedValue(
        new Error("Bank timeout"),
      );

      await expect(service.fund(EP_ID, LP_ID)).rejects.toThrow("Bank timeout");
      expect(mockInstrumentService.revertFinancing).toHaveBeenCalledWith(
        INSTRUMENT_ID,
        LP_ID,
      );
    });

    // ── Success path ──────────────────────────────────────

    it("should confirm financing, transfer, update status, record fee, and log on success", async () => {
      mockPrisma.earlyPaymentRequest.findUnique.mockResolvedValue(
        makeEPRequest(),
      );

      const result = await service.fund(EP_ID, LP_ID);

      // Instrument beneficiary flip
      expect(mockInstrumentService.confirmFinancing).toHaveBeenCalledWith(
        expect.objectContaining({
          instrumentId: INSTRUMENT_ID,
          financingPartnerId: LP_ID,
        }),
        LP_ID,
      );
      // Settlement transfer
      expect(mockSettlement.transferAdvance).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseOrderId: PO_ID,
          earlyPaymentRequestId: EP_ID,
          lpId: LP_ID,
          amount: 97_500,
        }),
      );
      // Ledger event
      expect(mockLedger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "EARLY_PAYMENT",
          eventType: "EARLY_PAY_FUNDED",
          actorId: LP_ID,
        }),
      );

      expect(result).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════
  // getMarketplace
  // ══════════════════════════════════════════════════════════

  describe("getMarketplace", () => {
    it("should query REQUESTED requests with fundable PO statuses", async () => {
      mockPrisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      await service.getMarketplace();

      expect(mockPrisma.earlyPaymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "REQUESTED",
            purchaseOrder: {
              status: {
                in: ["ACCEPTED", "FULFILLMENT", "SHIPPED", "DELIVERED"],
              },
            },
          },
        }),
      );
    });

    it("should enrich results with risk snapshots", async () => {
      const ep = makeEPRequest();
      mockPrisma.earlyPaymentRequest.findMany.mockResolvedValue([ep]);
      const snapshot = { riskScore: 85, defaultProbability: 2 };
      mockRiskSnapshot.computeForPOs.mockResolvedValue(
        new Map([[PO_ID, snapshot]]),
      );

      const result = await service.getMarketplace();

      expect(result[0].risk).toEqual(snapshot);
      expect(mockRiskSnapshot.computeForPOs).toHaveBeenCalledWith([PO_ID]);
    });
  });
});
