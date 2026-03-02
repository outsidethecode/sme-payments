/**
 * Abstract KYB (Know Your Business) provider interface.
 * Implementations: MockKybProvider (pilot), WathqKybProvider (KSA production)
 */
export interface KybVerificationResult {
  verified: boolean;
  provider: string;
  registrationNo: string;
  companyName?: string;
  authorizedSignatory?: string;
  jurisdiction: string;
  sanctionsClean?: boolean;
  rawResponse?: Record<string, any>;
  verifiedAt: Date;
  errorMessage?: string;
}

export interface KybProvider {
  /**
   * Verify a business registration number for a given jurisdiction.
   */
  verify(
    registrationNo: string,
    jurisdiction: string,
    metadata?: Record<string, any>,
  ): Promise<KybVerificationResult>;

  /**
   * Run sanctions screening against a business or individual.
   */
  checkSanctions(
    entityName: string,
    jurisdiction: string,
  ): Promise<{ clean: boolean; details?: string }>;
}

export const KYB_PROVIDER = "KYB_PROVIDER";
