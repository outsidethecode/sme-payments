import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyService } from "./idempotency.service";
import { Reflector } from "@nestjs/core";
import { CallHandler, ExecutionContext, HttpStatus } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";
import { IDEMPOTENT_KEY } from "./idempotent.decorator";

describe("IdempotencyInterceptor", () => {
  let interceptor: IdempotencyInterceptor;
  let idempotencyService: jest.Mocked<IdempotencyService>;
  let reflector: jest.Mocked<Reflector>;

  // ── Helpers ───────────────────────────────────────────────

  function makeContext(overrides: {
    headers?: Record<string, string>;
    method?: string;
    url?: string;
    routePath?: string;
    statusFn?: jest.Mock;
  }): ExecutionContext {
    const headers = overrides.headers ?? {};
    const statusFn = overrides.statusFn ?? jest.fn();
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          method: overrides.method ?? "PATCH",
          url: overrides.url ?? "/purchase-orders/123/fund",
          route: overrides.routePath
            ? { path: overrides.routePath }
            : undefined,
        }),
        getResponse: () => ({
          status: statusFn,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function makeNext(responseBody: unknown = { id: "po-1" }): CallHandler {
    return { handle: () => of(responseBody) };
  }

  // ── Setup ─────────────────────────────────────────────────

  beforeEach(() => {
    idempotencyService = {
      check: jest.fn(),
      record: jest.fn(),
      cleanup: jest.fn(),
    } as any;

    reflector = {
      get: jest.fn(),
    } as any;

    interceptor = new IdempotencyInterceptor(idempotencyService, reflector);
  });

  // ── Tests ─────────────────────────────────────────────────

  it("should pass through when handler is NOT marked @Idempotent()", async () => {
    reflector.get.mockReturnValue(false);
    const nextBody = { id: "po-1", status: "ACCEPTED" };
    const next = makeNext(nextBody);
    const ctx = makeContext({});

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual(nextBody);
    expect(idempotencyService.check).not.toHaveBeenCalled();
    expect(idempotencyService.record).not.toHaveBeenCalled();
  });

  it("should pass through when @Idempotent() but no Idempotency-Key header", async () => {
    reflector.get.mockReturnValue(true);
    const nextBody = { id: "po-1", status: "FULFILLMENT" };
    const next = makeNext(nextBody);
    const ctx = makeContext({ headers: {} });

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual(nextBody);
    expect(idempotencyService.check).not.toHaveBeenCalled();
  });

  it("should return cached response on cache hit", async () => {
    reflector.get.mockReturnValue(true);
    const cachedBody = { id: "po-1", status: "FULFILLMENT" };
    idempotencyService.check.mockResolvedValue({
      statusCode: 200,
      body: cachedBody,
    });
    const statusFn = jest.fn();
    const ctx = makeContext({
      headers: { "idempotency-key": "key-123" },
      statusFn,
    });
    const next = makeNext({ id: "should-not-see-this" });

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual(cachedBody);
    expect(statusFn).toHaveBeenCalledWith(200);
    expect(idempotencyService.check).toHaveBeenCalledWith("key-123");
    // Handler should NOT have been called — record should NOT be called
    expect(idempotencyService.record).not.toHaveBeenCalled();
  });

  it("should execute handler and cache response on cache miss", async () => {
    reflector.get.mockReturnValue(true);
    idempotencyService.check.mockResolvedValue(null);
    idempotencyService.record.mockResolvedValue(undefined);
    const nextBody = { id: "po-1", status: "FULFILLMENT" };
    const next = makeNext(nextBody);
    const ctx = makeContext({
      headers: { "idempotency-key": "key-456" },
      method: "PATCH",
      routePath: "/purchase-orders/:id/fund",
    });

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual(nextBody);
    expect(idempotencyService.check).toHaveBeenCalledWith("key-456");
    // Wait for the async tap to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(idempotencyService.record).toHaveBeenCalledWith(
      "key-456",
      "PATCH /purchase-orders/:id/fund",
      HttpStatus.OK,
      nextBody,
    );
  });

  it("should not fail the request if caching fails", async () => {
    reflector.get.mockReturnValue(true);
    idempotencyService.check.mockResolvedValue(null);
    idempotencyService.record.mockRejectedValue(
      new Error("DB connection lost"),
    );
    const nextBody = { ok: true };
    const next = makeNext(nextBody);
    const ctx = makeContext({
      headers: { "idempotency-key": "key-fail" },
    });

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    // Response still returned despite cache failure
    expect(result).toEqual(nextBody);
    await new Promise((r) => setTimeout(r, 10));
    expect(idempotencyService.record).toHaveBeenCalled();
  });

  it("should use request.url when route.path is unavailable", async () => {
    reflector.get.mockReturnValue(true);
    idempotencyService.check.mockResolvedValue(null);
    idempotencyService.record.mockResolvedValue(undefined);
    const nextBody = { ok: true };
    const ctx = makeContext({
      headers: { "idempotency-key": "key-url" },
      method: "POST",
      url: "/early-payments",
      routePath: undefined,
    });
    const next = makeNext(nextBody);

    const result$ = await interceptor.intercept(ctx, next);
    await lastValueFrom(result$);
    await new Promise((r) => setTimeout(r, 10));

    expect(idempotencyService.record).toHaveBeenCalledWith(
      "key-url",
      "POST /early-payments",
      HttpStatus.OK,
      nextBody,
    );
  });

  it("should restore cached statusCode on replay", async () => {
    reflector.get.mockReturnValue(true);
    const cachedBody = { id: "ep-1" };
    idempotencyService.check.mockResolvedValue({
      statusCode: 201,
      body: cachedBody,
    });
    const statusFn = jest.fn();
    const ctx = makeContext({
      headers: { "idempotency-key": "key-201" },
      statusFn,
    });
    const next = makeNext();

    const result$ = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(result$);

    expect(statusFn).toHaveBeenCalledWith(201);
    expect(result).toEqual(cachedBody);
  });
});
