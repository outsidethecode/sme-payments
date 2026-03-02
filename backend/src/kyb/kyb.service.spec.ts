import { Test, TestingModule } from "@nestjs/testing";
import { KybService } from "./kyb.service";
import { MockKybProvider } from "./mock-kyb.provider";
import { KYB_PROVIDER } from "./kyb-provider.interface";

describe("KybService", () => {
  let service: KybService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KybService,
        { provide: KYB_PROVIDER, useClass: MockKybProvider },
      ],
    }).compile();

    service = module.get<KybService>(KybService);
  });

  describe("verify", () => {
    it("should verify a valid registration number", async () => {
      const result = await service.verify("1010123456", "KSA", {
        companyName: "Test Corp",
      });

      expect(result.verified).toBe(true);
      expect(result.provider).toBe("MOCK");
      expect(result.registrationNo).toBe("1010123456");
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it("should reject registration numbers starting with FAIL", async () => {
      const result = await service.verify("FAIL999", "KSA");

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("flagged");
    });

    it("should include company name from metadata", async () => {
      const result = await service.verify("1010123456", "UK", {
        companyName: "Acme Ltd",
      });

      expect(result.companyName).toBe("Acme Ltd");
    });
  });

  describe("checkSanctions", () => {
    it("should pass clean entities", async () => {
      const result = await service.checkSanctions("Normal Company", "KSA");

      expect(result.clean).toBe(true);
    });

    it("should flag sanctioned entities", async () => {
      const result = await service.checkSanctions(
        "SANCTIONED Entity Corp",
        "KSA",
      );

      expect(result.clean).toBe(false);
      expect(result.details).toContain("flagged");
    });
  });
});
