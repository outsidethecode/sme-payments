import { KSABankTransferAdapter } from "./ksa-bank.adapter";
import { TransferStatus } from "./settlement-adapter.interface";

describe("KSABankTransferAdapter", () => {
  let adapter: KSABankTransferAdapter;

  beforeEach(() => {
    adapter = new KSABankTransferAdapter();
  });

  it("should have name KSA_BANK", () => {
    expect(adapter.name).toBe("KSA_BANK");
  });

  it("should support SAR only", () => {
    expect(adapter.supportedCurrencies).toEqual(["SAR"]);
  });

  describe("reserveFunds", () => {
    it("should reserve funds successfully", async () => {
      const result = await adapter.reserveFunds({
        purchaseOrderId: "po-1",
        payerId: "buyer-1",
        payerAccountRef: "SA0380000000608010167520",
        amount: 500_000,
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.RESERVED);
      expect(result.externalRef).toMatch(/^SARIE-RSV-/);
      expect(result.rawResponse).toEqual(
        expect.objectContaining({ rail: expect.any(String) }),
      );
    });

    it("should fail with SA00FAIL account", async () => {
      const result = await adapter.reserveFunds({
        purchaseOrderId: "po-1",
        payerId: "buyer-1",
        payerAccountRef: "SA00FAIL000000000000",
        amount: 500_000,
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.FAILED);
      expect(result.failureReason).toContain("invalid account");
    });

    it("should select SARIE rail for large amounts", async () => {
      const result = await adapter.reserveFunds({
        purchaseOrderId: "po-1",
        payerId: "buyer-1",
        payerAccountRef: "SA0380000000608010167520",
        amount: 2_000_000, // 20,000 SAR
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.RESERVED);
      expect(result.rawResponse?.rail).toBe("SARIE");
    });

    it("should select ACH rail for small amounts", async () => {
      const result = await adapter.reserveFunds({
        purchaseOrderId: "po-1",
        payerId: "buyer-1",
        payerAccountRef: "SA0380000000608010167520",
        amount: 100_000, // 1,000 SAR
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.RESERVED);
      expect(result.rawResponse?.rail).toBe("ACH");
    });
  });

  describe("releaseFunds", () => {
    it("should release funds successfully", async () => {
      const result = await adapter.releaseFunds({
        reservationRef: "SARIE-RSV-TEST",
        purchaseOrderId: "po-1",
        recipientId: "supplier-1",
        recipientAccountRef: "SA0380000000608010167521",
        amount: 500_000,
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.COMPLETED);
      expect(result.externalRef).toMatch(/^SARIE-REL-/);
    });

    it("should fail with SA00FAIL recipient", async () => {
      const result = await adapter.releaseFunds({
        reservationRef: "SARIE-RSV-TEST",
        purchaseOrderId: "po-1",
        recipientId: "supplier-1",
        recipientAccountRef: "SA00FAIL000000000001",
        amount: 500_000,
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.FAILED);
      expect(result.failureReason).toContain("invalid recipient");
    });
  });

  describe("transferFunds", () => {
    it("should complete direct transfer", async () => {
      const result = await adapter.transferFunds({
        purchaseOrderId: "po-1",
        fromId: "lp-1",
        fromAccountRef: "SA0380000000608010167522",
        toId: "supplier-1",
        toAccountRef: "SA0380000000608010167523",
        amount: 475_000,
        currency: "SAR",
      });

      expect(result.status).toBe(TransferStatus.COMPLETED);
      expect(result.externalRef).toMatch(/^SARIE-TRF-/);
    });
  });

  describe("refund", () => {
    it("should process refund", async () => {
      const result = await adapter.refund({
        reservationRef: "SARIE-RSV-TEST",
        purchaseOrderId: "po-1",
        recipientId: "buyer-1",
        recipientAccountRef: "SA0380000000608010167520",
        amount: 500_000,
        currency: "SAR",
        reason: "PO cancelled",
      });

      expect(result.status).toBe(TransferStatus.REFUNDED);
      expect(result.externalRef).toMatch(/^SARIE-RFD-/);
    });
  });

  describe("reconcile", () => {
    it("should return status for a known ref", async () => {
      // Reserve first to create a known ref
      const reserve = await adapter.reserveFunds({
        purchaseOrderId: "po-1",
        payerId: "buyer-1",
        amount: 100_000,
        currency: "SAR",
      });

      const result = await adapter.reconcile({
        externalRef: reserve.externalRef,
      });

      expect(result.status).toBe(TransferStatus.RESERVED);
      expect(result.confirmedAt).toBeDefined();
    });

    it("should return FAILED for unknown ref", async () => {
      const result = await adapter.reconcile({
        externalRef: "UNKNOWN-REF",
      });

      expect(result.status).toBe(TransferStatus.FAILED);
      expect(result.failureReason).toContain("not found");
    });
  });
});
