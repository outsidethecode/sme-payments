import { Injectable, Logger } from "@nestjs/common";
import { KybProvider, KybVerificationResult } from "./kyb-provider.interface";

/**
 * Mock KYB provider for pilot/development.
 * Auto-approves all verification requests.
 * Replace with WathqKybProvider for KSA production.
 */
@Injectable()
export class MockKybProvider implements KybProvider {
  private readonly logger = new Logger(MockKybProvider.name);

  async verify(
    registrationNo: string,
    jurisdiction: string,
    metadata?: Record<string, any>,
  ): Promise<KybVerificationResult> {
    this.logger.log(
      `[MOCK] Verifying registration ${registrationNo} in ${jurisdiction}`,
    );

    // Simulate a brief verification delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock: reject if registration number starts with "FAIL"
    if (registrationNo.startsWith("FAIL")) {
      return {
        verified: false,
        provider: "MOCK",
        registrationNo,
        jurisdiction,
        verifiedAt: new Date(),
        errorMessage: "Mock verification failure — registration number flagged",
      };
    }

    return {
      verified: true,
      provider: "MOCK",
      registrationNo,
      companyName:
        metadata?.companyName || `Verified Company (${registrationNo})`,
      authorizedSignatory: metadata?.authorizedSignatory,
      jurisdiction,
      sanctionsClean: true,
      rawResponse: {
        mockVerification: true,
        timestamp: new Date().toISOString(),
      },
      verifiedAt: new Date(),
    };
  }

  async checkSanctions(
    entityName: string,
    jurisdiction: string,
  ): Promise<{ clean: boolean; details?: string }> {
    this.logger.log(
      `[MOCK] Sanctions check for "${entityName}" in ${jurisdiction}`,
    );

    // Mock: flag if entity name contains "SANCTIONED"
    if (entityName.toUpperCase().includes("SANCTIONED")) {
      return {
        clean: false,
        details: "Mock sanctions hit — entity name flagged",
      };
    }

    return { clean: true };
  }
}
