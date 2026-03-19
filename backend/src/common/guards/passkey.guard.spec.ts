import {
  PasskeyGuard,
  REQUIRE_PASSKEY_KEY,
  SKIP_PASSKEY_KEY,
} from "./passkey.guard";
import { Reflector } from "@nestjs/core";
import { ForbiddenException, ExecutionContext } from "@nestjs/common";

describe("PasskeyGuard", () => {
  let guard: PasskeyGuard;
  let reflector: Reflector;
  let passkeysService: { hasPasskey: jest.Mock };

  const mockContext = (
    user?: any,
    handler = "testHandler",
    cls = "TestController",
  ) => {
    const getHandler = jest.fn().mockReturnValue(handler);
    const getClass = jest.fn().mockReturnValue(cls);
    const getRequest = jest.fn().mockReturnValue({ user });
    return {
      getHandler,
      getClass,
      switchToHttp: () => ({ getRequest }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    passkeysService = { hasPasskey: jest.fn() };
    guard = new PasskeyGuard(reflector, passkeysService as any);
  });

  // ── Decorator presence ──

  it("should allow if @RequirePasskey() is NOT applied", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(false);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(passkeysService.hasPasskey).not.toHaveBeenCalled();
  });

  it("should check passkey when @RequirePasskey() IS applied", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(true);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(passkeysService.hasPasskey).toHaveBeenCalledWith("u1");
  });

  // ── Skip decorator ──

  it("should allow if @SkipPasskeyCheck() is applied on method", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(true);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(passkeysService.hasPasskey).not.toHaveBeenCalled();
  });

  // ── No user ──

  it("should allow when there is no user (unauthenticated)", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    const ctx = mockContext(undefined);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("should allow when user has no id", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    const ctx = mockContext({ role: "BUYER" });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // ── ADMIN bypass ──

  it("should allow ADMIN users regardless of passkey", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    const ctx = mockContext({ id: "admin1", role: "ADMIN" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(passkeysService.hasPasskey).not.toHaveBeenCalled();
  });

  // ── User WITH passkey ──

  it("should allow user who has a passkey registered", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(true);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // ── User WITHOUT passkey ──

  it("should throw ForbiddenException when user has no passkey", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(false);
    const ctx = mockContext({ id: "u2", role: "SUPPLIER" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("should include helpful message in the ForbiddenException", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(false);
    const ctx = mockContext({ id: "u2", role: "BUYER" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /passkey registration required/i,
    );
  });

  // ── All non-ADMIN roles are checked ──

  for (const role of ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER"]) {
    it(`should block ${role} without passkey`, async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
      jest.spyOn(reflector, "get").mockReturnValue(false);
      passkeysService.hasPasskey.mockResolvedValue(false);
      const ctx = mockContext({ id: "u3", role });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it(`should allow ${role} with passkey`, async () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
      jest.spyOn(reflector, "get").mockReturnValue(false);
      passkeysService.hasPasskey.mockResolvedValue(true);
      const ctx = mockContext({ id: "u3", role });
      expect(await guard.canActivate(ctx)).toBe(true);
    });
  }

  // ── Reflector is queried with correct metadata keys ──

  it("should check REQUIRE_PASSKEY_KEY from handler and class", async () => {
    const spy = jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(false);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    await guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(REQUIRE_PASSKEY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  it("should check SKIP_PASSKEY_KEY only from handler", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    const spy = jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(true);
    const ctx = mockContext({ id: "u1", role: "BUYER" });
    await guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(SKIP_PASSKEY_KEY, ctx.getHandler());
  });

  // ── Service is called with correct user ID ──

  it("should call passkeysService.hasPasskey with the user id", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    jest.spyOn(reflector, "get").mockReturnValue(false);
    passkeysService.hasPasskey.mockResolvedValue(true);
    const ctx = mockContext({ id: "test-user-123", role: "BUYER" });
    await guard.canActivate(ctx);
    expect(passkeysService.hasPasskey).toHaveBeenCalledWith("test-user-123");
  });
});
