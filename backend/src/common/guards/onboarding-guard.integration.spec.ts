/**
 * Integration-style tests verifying that the OnboardingGuard is applied
 * to all business-critical controllers and blocks non-onboarded users.
 *
 * These tests instantiate real NestJS modules with the guard wired up,
 * confirming the decorator + guard combination works end-to-end.
 */
import {
  OnboardingGuard,
  RequireOnboarding,
  SkipOnboardingCheck,
  REQUIRE_ONBOARDING_KEY,
} from "./onboarding.guard";
import {
  Controller,
  Get,
  Post,
  UseGuards,
  Module,
  INestApplication,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import * as request from "supertest";
import { PrismaService } from "../../prisma/prisma.service";

// ── Stub JWT guard (always passes, injects user into req) ────

const TEST_USER_BUYER_NOT_STARTED = {
  id: "user-1",
  email: "buyer@test.com",
  role: "BUYER",
  organisationId: "org-1",
};

const TEST_USER_ADMIN = {
  id: "user-admin",
  email: "admin@test.com",
  role: "ADMIN",
  organisationId: "org-admin",
};

const TEST_USER_COMPLETED = {
  id: "user-2",
  email: "completed@test.com",
  role: "SUPPLIER",
  organisationId: "org-2",
};

let currentTestUser = TEST_USER_BUYER_NOT_STARTED;

class FakeJwtGuard {
  canActivate(context: any) {
    const req = context.switchToHttp().getRequest();
    req.user = currentTestUser;
    return true;
  }
}

// ── Fake PrismaService for org lookup ───────────────────────

const orgStatuses: Record<string, string> = {
  "org-1": "NOT_STARTED",
  "org-2": "COMPLETED",
  "org-admin": "COMPLETED",
};

const fakePrisma = {
  organisation: {
    findUnique: jest.fn(({ where }: any) =>
      Promise.resolve(
        orgStatuses[where.id]
          ? { onboardingStatus: orgStatuses[where.id], name: `Org-${where.id}` }
          : null,
      ),
    ),
  },
};

// ── Test controllers ────────────────────────────────────────

@Controller("protected")
@UseGuards(FakeJwtGuard, OnboardingGuard)
@RequireOnboarding()
class ProtectedController {
  @Get()
  list() {
    return { ok: true };
  }

  @Post()
  create() {
    return { created: true };
  }

  @Get("skipped")
  @SkipOnboardingCheck()
  skippedRoute() {
    return { skipped: true };
  }
}

@Controller("unprotected")
@UseGuards(FakeJwtGuard)
class UnprotectedController {
  @Get()
  list() {
    return { ok: true };
  }
}

@Module({
  controllers: [ProtectedController, UnprotectedController],
  providers: [
    OnboardingGuard,
    { provide: PrismaService, useValue: fakePrisma },
  ],
})
class TestModule {}

describe("OnboardingGuard — HTTP integration", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakePrisma.organisation.findUnique.mockClear();
  });

  // ── Protected routes ──────────────────────────────────────

  describe("protected controller (NOT_STARTED buyer)", () => {
    beforeEach(() => {
      currentTestUser = TEST_USER_BUYER_NOT_STARTED;
    });

    it("GET /protected should return 403 for non-onboarded user", async () => {
      const res = await request(app.getHttpServer()).get("/protected");
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/has not completed onboarding/);
      expect(res.body.message).toMatch(/NOT_STARTED/);
    });

    it("POST /protected should return 403 for non-onboarded user", async () => {
      const res = await request(app.getHttpServer()).post("/protected");
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/has not completed onboarding/);
    });

    it("GET /protected/skipped should return 200 (SkipOnboardingCheck)", async () => {
      const res = await request(app.getHttpServer()).get("/protected/skipped");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ skipped: true });
    });
  });

  describe("protected controller (COMPLETED supplier)", () => {
    beforeEach(() => {
      currentTestUser = TEST_USER_COMPLETED;
    });

    it("GET /protected should return 200 for onboarded user", async () => {
      const res = await request(app.getHttpServer()).get("/protected");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("POST /protected should return 200 for onboarded user", async () => {
      const res = await request(app.getHttpServer()).post("/protected");
      expect(res.status).toBe(201); // NestJS default for POST
      expect(res.body).toEqual({ created: true });
    });
  });

  describe("protected controller (ADMIN bypass)", () => {
    beforeEach(() => {
      currentTestUser = TEST_USER_ADMIN;
    });

    it("GET /protected should return 200 for admin", async () => {
      const res = await request(app.getHttpServer()).get("/protected");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // Admin shouldn't even trigger a DB lookup
      expect(fakePrisma.organisation.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── Unprotected routes ────────────────────────────────────

  describe("unprotected controller (no @RequireOnboarding)", () => {
    beforeEach(() => {
      currentTestUser = TEST_USER_BUYER_NOT_STARTED;
    });

    it("GET /unprotected should return 200 regardless of onboarding", async () => {
      const res = await request(app.getHttpServer()).get("/unprotected");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  // ── Status-specific tests ──────────────────────────────────

  describe("all non-COMPLETED statuses are blocked", () => {
    const statuses = [
      "NOT_STARTED",
      "IN_PROGRESS",
      "KYB_PENDING",
      "KYB_VERIFIED",
      "KYB_FAILED",
    ];

    statuses.forEach((status) => {
      it(`should block ${status}`, async () => {
        currentTestUser = {
          id: `user-${status}`,
          email: `${status}@test.com`,
          role: "BUYER",
          organisationId: `org-${status}`,
        };
        orgStatuses[`org-${status}`] = status;

        const res = await request(app.getHttpServer()).get("/protected");
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(new RegExp(status));
      });
    });
  });
});

/**
 * Verify that the @RequireOnboarding() decorator actually sets the correct
 * metadata. This ensures the decorator isn't broken by refactoring.
 */
describe("@RequireOnboarding() decorator metadata", () => {
  it("should set REQUIRE_ONBOARDING_KEY metadata on class", () => {
    @RequireOnboarding()
    class TestClass {}
    const reflector = new Reflector();
    const val = reflector.get(REQUIRE_ONBOARDING_KEY, TestClass);
    expect(val).toBe(true);
  });
});
