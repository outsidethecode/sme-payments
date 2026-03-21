import { Injectable, Logger } from "@nestjs/common";
import {
  IdentityProvider,
  IdentityInitiateResult,
  IdentityVerificationResult,
} from "./identity-provider.interface";

/**
 * Mock identity provider for development and testing.
 * Auto-verifies all national IDs except those starting with "FAIL".
 * Simulates the Nafath two-step flow (initiate → poll status).
 *
 * State is encoded in the transaction ID itself (base64url) so it
 * survives Cloud Run cold-starts and multi-instance routing without
 * needing Redis or any external storage.
 */
@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(MockIdentityProvider.name);

  private encode(data: { nationalId: string; initiatedAt: number }): string {
    return Buffer.from(JSON.stringify(data)).toString("base64url");
  }

  private decode(
    token: string,
  ): { nationalId: string; initiatedAt: number } | null {
    try {
      return JSON.parse(Buffer.from(token, "base64url").toString());
    } catch {
      return null;
    }
  }

  async initiate(nationalId: string): Promise<IdentityInitiateResult> {
    this.logger.log(
      `[MOCK] Initiating identity verification for ${this.mask(nationalId)}`,
    );

    const payload = this.encode({ nationalId, initiatedAt: Date.now() });
    const transactionId = `mock-${payload}`;
    const random = String(Math.floor(10 + Math.random() * 89)); // 2-digit number

    return {
      transactionId,
      random,
      provider: "MOCK",
    };
  }

  async checkStatus(
    transactionId: string,
  ): Promise<IdentityVerificationResult> {
    const token = transactionId.replace(/^mock-/, "");
    const entry = this.decode(token);

    if (!entry) {
      return {
        verified: false,
        provider: "MOCK",
        errorMessage: "Transaction not found or expired",
      };
    }

    // Simulate 2-second confirmation delay
    const elapsed = Date.now() - entry.initiatedAt;
    if (elapsed < 2000) {
      return {
        verified: false,
        provider: "MOCK",
        transactionId,
        errorMessage: "WAITING — user has not confirmed yet",
      };
    }

    // Reject if national ID starts with "FAIL"
    if (entry.nationalId.startsWith("FAIL")) {
      return {
        verified: false,
        provider: "MOCK",
        transactionId,
        verifiedAt: new Date(),
        errorMessage: "Mock verification failure — national ID flagged",
      };
    }

    const masked = this.mask(entry.nationalId);

    this.logger.log(`[MOCK] Identity verified for ${masked}`);

    return {
      verified: true,
      provider: "MOCK",
      nationalIdMasked: masked,
      fullNameAr: "محمد أحمد الراشدي",
      fullNameEn: `Verified Person (${masked})`,
      dateOfBirth: "1990-01-15",
      nationality: "SA",
      transactionId,
      verifiedAt: new Date(),
      rawResponse: {
        mockVerification: true,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private mask(id: string): string {
    if (id.length <= 4) return "****";
    return id.slice(0, 2) + "*".repeat(id.length - 4) + id.slice(-2);
  }
}
