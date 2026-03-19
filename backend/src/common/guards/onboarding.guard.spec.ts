import {
  OnboardingGuard,
  REQUIRE_ONBOARDING_KEY,
  SKIP_ONBOARDING_KEY,
} from "./onboarding.guard";
import { Reflector } from "@nestjs/core";
import { ForbiddenException, ExecutionContext } from "@nestjs/common";

describe("OnboardingGuard", () => {
  let guard: OnboardingGuard;
  let reflector: {
    getAllAndOverride: jest.Mock;
    get: jest.Mock;
  };
  let prisma: Record<string, any>;

  const mockContext = (user: Record<string, any> = {}) => {
    const handler = jest.fn();
    const cls = jest.fn();
    const ctx = {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
    return ctx;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true), // @RequireOnboarding() applied
      get: jest.fn().mockReturnValue(false), // @SkipOnboardingCheck() NOT applied
    };
    prisma = {
      organisation: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingStatus: "COMPLETED",
          name: "Acme Ltd",
        }),
      },
    };
    guard = new OnboardingGuard(reflector as any, prisma as any);
  });

  // ── Decorator not applied ──────────────────────────────────

  it("should allow when @RequireOnboarding() is not applied", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = mockContext({ organisationId: "org-1", role: "BUYER" });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  // ── Skip decorator ────────────────────────────────────────

  it("should allow when @SkipOnboardingCheck() is applied on method", async () => {
    reflector.get.mockReturnValue(true); // skip = true
    prisma.organisation.findUnique.mockResolvedValue({
      onboardingStatus: "NOT_STARTED",
      name: "Lazy Corp",
    });
    const ctx = mockContext({
      organisationId: "org-1",
      role: "BUYER",
    });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  // ── No user / no org ──────────────────────────────────────

  it("should allow when user has no organisationId", async () => {
    const ctx = mockContext({ id: "user-1", role: "BUYER" });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  it("should allow when no user on request", async () => {
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({}), // no user
      }),
    } as unknown as ExecutionContext;

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  // ── Admin bypass ──────────────────────────────────────────

  it("should allow ADMIN users regardless of onboarding status", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      onboardingStatus: "NOT_STARTED",
      name: "Admin Corp",
    });
    const ctx = mockContext({
      organisationId: "org-1",
      role: "ADMIN",
    });

    expect(await guard.canActivate(ctx)).toBe(true);
    // Should not even query the org
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  // ── Org not found ─────────────────────────────────────────

  it("should allow when organisation is not found in DB", async () => {
    prisma.organisation.findUnique.mockResolvedValue(null);
    const ctx = mockContext({
      organisationId: "org-missing",
      role: "BUYER",
    });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // ── COMPLETED → allow ─────────────────────────────────────

  it("should allow when onboardingStatus is COMPLETED", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      onboardingStatus: "COMPLETED",
      name: "Good Corp",
    });
    const ctx = mockContext({
      organisationId: "org-1",
      role: "BUYER",
    });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // ── Non-COMPLETED statuses → block ─────────────────────────

  const blockedStatuses = [
    "NOT_STARTED",
    "IN_PROGRESS",
    "KYB_PENDING",
    "KYB_VERIFIED",
    "KYB_FAILED",
  ];

  blockedStatuses.forEach((status) => {
    it(`should throw ForbiddenException when onboardingStatus is ${status}`, async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        onboardingStatus: status,
        name: "Blocked Corp",
      });
      const ctx = mockContext({
        organisationId: "org-1",
        role: "BUYER",
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        /has not completed onboarding/,
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(new RegExp(status));
    });
  });

  // ── Same for SUPPLIER and LIQUIDITY_PARTNER roles ──────────

  it("should block SUPPLIER with incomplete onboarding", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      onboardingStatus: "IN_PROGRESS",
      name: "Supplier Inc",
    });
    const ctx = mockContext({
      organisationId: "org-2",
      role: "SUPPLIER",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Supplier Inc/);
  });

  it("should block LIQUIDITY_PARTNER with incomplete onboarding", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      onboardingStatus: "KYB_PENDING",
      name: "LP Fund",
    });
    const ctx = mockContext({
      organisationId: "org-3",
      role: "LIQUIDITY_PARTNER",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/LP Fund/);
  });

  // ── Reflector calls ────────────────────────────────────────

  it("should check REQUIRE_ONBOARDING_KEY on handler and class", async () => {
    const ctx = mockContext({ organisationId: "org-1", role: "BUYER" });
    await guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRE_ONBOARDING_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
  });

  it("should check SKIP_ONBOARDING_KEY on handler only", async () => {
    const ctx = mockContext({ organisationId: "org-1", role: "BUYER" });
    await guard.canActivate(ctx);

    expect(reflector.get).toHaveBeenCalledWith(
      SKIP_ONBOARDING_KEY,
      ctx.getHandler(),
    );
  });

  // ── DB query correctness ──────────────────────────────────

  it("should query the correct orgId with correct select fields", async () => {
    const ctx = mockContext({
      organisationId: "org-42",
      role: "SUPPLIER",
    });
    await guard.canActivate(ctx);

    expect(prisma.organisation.findUnique).toHaveBeenCalledWith({
      where: { id: "org-42" },
      select: { onboardingStatus: true, name: true },
    });
  });
});
