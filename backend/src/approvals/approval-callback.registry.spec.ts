import { ApprovalCallbackRegistry } from "./approval-callback.registry";

describe("ApprovalCallbackRegistry", () => {
  let registry: ApprovalCallbackRegistry;

  beforeEach(() => {
    registry = new ApprovalCallbackRegistry();
  });

  it("should register and invoke a callback by entityType", async () => {
    const cb = jest.fn().mockResolvedValue(undefined);
    registry.register("PURCHASE_ORDER", cb);

    await registry.onApproved("PURCHASE_ORDER", "po-1", "user-1");

    expect(cb).toHaveBeenCalledWith("po-1", "user-1");
  });

  it("should support compound key (entityType:action)", async () => {
    const cbGeneric = jest.fn().mockResolvedValue(undefined);
    const cbSpecific = jest.fn().mockResolvedValue(undefined);

    registry.register("PURCHASE_ORDER", cbGeneric);
    registry.register("PURCHASE_ORDER:ESCROW_FUNDING", cbSpecific);

    await registry.onApproved(
      "PURCHASE_ORDER",
      "po-1",
      "user-1",
      "ESCROW_FUNDING",
    );

    expect(cbSpecific).toHaveBeenCalledWith("po-1", "user-1");
    expect(cbGeneric).not.toHaveBeenCalled();
  });

  it("should fall back to entityType when compound key not registered", async () => {
    const cb = jest.fn().mockResolvedValue(undefined);
    registry.register("PURCHASE_ORDER", cb);

    await registry.onApproved(
      "PURCHASE_ORDER",
      "po-1",
      "user-1",
      "UNKNOWN_ACTION",
    );

    expect(cb).toHaveBeenCalledWith("po-1", "user-1");
  });

  it("should warn when no callback is registered", async () => {
    const logSpy = jest.spyOn(console, "warn").mockImplementation();

    await registry.onApproved("UNKNOWN_TYPE", "id-1", "user-1");

    // No throw expected; just a logged warning
    logSpy.mockRestore();
  });

  it("should return registered types", () => {
    registry.register("PURCHASE_ORDER", jest.fn());
    registry.register("EARLY_PAYMENT", jest.fn());

    const types = registry.getRegisteredTypes();

    expect(types).toContain("PURCHASE_ORDER");
    expect(types).toContain("EARLY_PAYMENT");
    expect(types).toHaveLength(2);
  });
});
