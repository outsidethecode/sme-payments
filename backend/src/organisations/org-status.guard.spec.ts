import { OrgStatusGuard, REQUIRE_ACTIVE_ORG_KEY } from "./org-status.guard";
import { Reflector } from "@nestjs/core";
import { ForbiddenException, ExecutionContext } from "@nestjs/common";

describe("OrgStatusGuard", () => {
  let guard: OrgStatusGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: Record<string, any>;

  const mockContext = (user: Record<string, any> = {}) => {
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
    return ctx;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true), // decorator applied by default
    };
    prisma = {
      organisation: {
        findUnique: jest.fn().mockResolvedValue({
          status: "ACTIVE",
          name: "Acme Ltd",
        }),
      },
    };
    guard = new OrgStatusGuard(reflector as any, prisma as any);
  });

  it("should allow when decorator is not applied", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = mockContext({ organisationId: "org-1" });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("should allow when user has no org", async () => {
    const ctx = mockContext({ id: "user-1" }); // no organisationId

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
  });

  it("should allow when org is ACTIVE", async () => {
    const ctx = mockContext({ id: "user-1", organisationId: "org-1" });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("should throw ForbiddenException when org is SUSPENDED", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      status: "SUSPENDED",
      name: "Blocked Corp",
    });
    const ctx = mockContext({ id: "user-1", organisationId: "org-1" });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/SUSPENDED/);
  });

  it("should throw ForbiddenException when org is PENDING", async () => {
    prisma.organisation.findUnique.mockResolvedValue({
      status: "PENDING",
      name: "New Corp",
    });
    const ctx = mockContext({ id: "user-1", organisationId: "org-1" });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/PENDING/);
  });

  it("should allow when org is not found (let other guards handle)", async () => {
    prisma.organisation.findUnique.mockResolvedValue(null);
    const ctx = mockContext({ id: "user-1", organisationId: "org-1" });

    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
