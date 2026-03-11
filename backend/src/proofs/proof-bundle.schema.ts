/**
 * Standalone Cryptographic Proof Bundle — Schema & Types
 *
 * A proof bundle is a self-contained JSON document that allows ANY external
 * party to independently verify that a specific person authorised a specific
 * business action — without trusting the platform.
 *
 * Trust chain:
 *   1. The signer's device (passkey) produced a WebAuthn assertion
 *   2. The assertion was over a challenge = SHA-256(business intent)
 *   3. The platform attests the binding between credential and user identity
 *   4. The public key is independently resolvable via a registry endpoint
 *
 * Verification:
 *   Feed this bundle to POST /api/proofs/verify (stateless) or use any
 *   WebAuthn assertion verifier with the embedded materials.
 */

// ── Top-level proof bundle ───────────────────────────────────

export interface ProofBundle {
  /** Schema version for forward-compatibility */
  version: "1.0";

  /** Unique proof identifier (event log ID) */
  proofId: string;

  /** When this proof bundle was generated */
  generatedAt: string;

  /** The business action that was authorised */
  intent: ProofIntent;

  /** The person who performed the action */
  signer: ProofSigner;

  /** The credential used to sign */
  credential: ProofCredential;

  /** The WebAuthn assertion (the actual cryptographic proof) */
  assertion: ProofAssertion | null;

  /** The relying party that issued the credential binding */
  issuer: ProofIssuer;

  /** Hash chain context (optional — for chain verification) */
  chain: ProofChainContext;

  /** Evidence file references (if any are attached to this event) */
  evidence: ProofEvidenceRef[];

  /** Machine-readable verification instructions */
  verification: ProofVerificationSpec;
}

// ── Sub-schemas ──────────────────────────────────────────────

export interface ProofIntent {
  /** What happened (e.g., "PO_ACCEPTED", "PAYMENT_LOCKED") */
  eventType: string;
  /** Entity type (e.g., "PurchaseOrder", "EarlyPaymentRequest") */
  entityType: string;
  /** Entity identifier */
  entityId: string;
  /** The full payload snapshot at the time of the action */
  payload: Record<string, unknown>;
  /** When the action was recorded */
  timestamp: string;
  /**
   * SHA-256 hex hash of the canonical payload.
   * Recomputable by any verifier: SHA-256(canonicalStringify(payload))
   */
  payloadHash: string;
}

export interface ProofSigner {
  /** Platform user ID */
  userId: string;
  /** Human-readable name */
  name: string;
  /** Email address (for identity binding) */
  email: string;
  /** Platform role at the time of signing */
  role: string;
  /** Organisation the signer belongs to */
  organisation: {
    id: string;
    name: string;
    type: string;
    jurisdiction: string;
  } | null;
}

export interface ProofCredential {
  /** WebAuthn credential ID (base64url) */
  credentialId: string;
  /** COSE public key (base64) — the raw key bytes stored at registration */
  publicKeyBase64: string;
  /** Device type: singleDevice or multiDevice */
  deviceType: string | null;
  /** Whether the credential is backed up (e.g. iCloud Keychain) */
  backedUp: boolean;
  /** When the credential was registered on the platform */
  registeredAt: string;
  /**
   * URI to independently resolve/verify this credential's public key.
   * An external verifier can GET this URL and confirm the public key matches.
   */
  publicKeyResolutionUri: string;
}

export interface ProofAssertion {
  /**
   * The intent hash that was used as the WebAuthn challenge.
   * = SHA-256(eventType + "|" + entityId + "|" + actorId) in base64url.
   * This cryptographically binds the signature to the business action.
   */
  intentHash: string;
  /**
   * Raw WebAuthn clientDataJSON (base64).
   * When decoded, contains { type, challenge, origin, crossOrigin }.
   * The `challenge` field MUST equal the intentHash — this is what makes
   * the proof self-contained.
   */
  clientDataJSON: string;
  /**
   * WebAuthn authenticator data (base64).
   * Contains RP ID hash, flags (user present, user verified), sign counter.
   */
  authenticatorData: string;
  /**
   * The ECDSA signature (base64) over:
   *   signedData = authenticatorData || SHA-256(clientDataJSON)
   * Produced by the passkey's private key (never leaves the device).
   */
  signature: string;
}

export interface ProofIssuer {
  /** Platform name (the Relying Party that binds credential → identity) */
  name: string;
  /** The RP ID used in WebAuthn registration (e.g., "localhost", "platform.example.com") */
  rpId: string;
  /** The expected origin for WebAuthn ceremonies */
  origin: string;
  /**
   * Base URI for the credential registry.
   * GET {registryUri}/credentials/{credentialId} returns the public key.
   */
  registryUri: string;
  /**
   * Base URI for signer identity lookup.
   * GET {identityUri}/signers/{userId} returns the signer's verified identity.
   */
  identityUri: string;
}

export interface ProofChainContext {
  /** SHA-256 hash of this event (includes all event data + previous hash) */
  eventHash: string;
  /** Hash of the previous event for the same entity (or "GENESIS" for first event) */
  previousHash: string;
  /** Sequence number within the entity's event chain */
  entitySequence: number;
  /** How to recompute the event hash for independent verification */
  hashAlgorithm: string;
  hashInputFormat: string;
}

export interface ProofEvidenceRef {
  /** Evidence attachment ID */
  attachmentId: string;
  /** Filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** SHA-256 hash of the file content (hex) */
  contentHash: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Who uploaded it */
  uploaderId: string;
  /** When it was uploaded */
  uploadedAt: string;
}

export interface ProofVerificationSpec {
  /** Whether this event has a real cryptographic signature */
  isCryptographicallySigned: boolean;
  /** The signature algorithm used */
  algorithm: "WebAuthn-FIDO2-ES256" | "none";
  /**
   * Step-by-step verification procedure.
   * Each step is machine-readable with a human-readable description.
   */
  steps: VerificationStep[];
}

export interface VerificationStep {
  /** Step number */
  step: number;
  /** What this step does */
  description: string;
  /** The operation to perform */
  operation: string;
  /** Expected result */
  expected: string;
}

// ── Verification result ──────────────────────────────────────

export interface ProofVerificationResult {
  /** Overall verdict */
  valid: boolean;
  /** When verification was performed */
  verifiedAt: string;
  /** Per-step results */
  steps: StepResult[];
  /** Human-readable summary */
  summary: string;
}

export interface StepResult {
  step: number;
  name: string;
  passed: boolean;
  detail: string;
}
