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
 */
@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(MockIdentityProvider.name);

  /** In-memory store for pending verifications */
  private pending = new Map<
    string,
    { nationalId: string; initiatedAt: number }
  >();

  async initiate(nationalId: string): Promise<IdentityInitiateResult> {
    this.logger.log(
      `[MOCK] Initiating identity verification for ${this.mask(nationalId)}`,
    );

    const transactionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const random = String(Math.floor(10 + Math.random() * 89)); // 2-digit number

    this.pending.set(transactionId, {
      nationalId,
      initiatedAt: Date.now(),
    });

    return {
      transactionId,
      random,
      provider: "MOCK",
    };
  }

  async checkStatus(
    transactionId: string,
  ): Promise<IdentityVerificationResult> {
    const entry = this.pending.get(transactionId);

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

    // Clean up
    this.pending.delete(transactionId);

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
