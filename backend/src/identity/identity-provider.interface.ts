/**
 * Abstract identity verification provider interface.
 * Implementations: MockIdentityProvider (dev/test), NafathIdentityProvider (KSA production)
 */

export interface IdentityInitiateResult {
  /** Provider-assigned transaction ID for status polling */
  transactionId: string;
  /** Random number the user must confirm on their Nafath app */
  random: string;
  /** Provider name */
  provider: string;
}

export interface IdentityVerificationResult {
  verified: boolean;
  provider: string; // "NAFATH" | "MOCK"
  nationalIdMasked?: string; // "10*****890"
  fullNameAr?: string;
  fullNameEn?: string;
  dateOfBirth?: string;
  nationality?: string;
  transactionId?: string; // Nafath transaction reference
  verifiedAt?: Date;
  errorMessage?: string;
  rawResponse?: Record<string, any>;
}

export interface IdentityProvider {
  /**
   * Initiate identity verification.
   * For Nafath: sends push notification to user's phone.
   * For Mock: instantly ready for confirmation.
   */
  initiate(nationalId: string): Promise<IdentityInitiateResult>;

  /**
   * Check verification status (poll).
   * Returns the result once the user confirms on their app.
   */
  checkStatus(transactionId: string): Promise<IdentityVerificationResult>;
}

export const IDENTITY_PROVIDER = "IDENTITY_PROVIDER";
