import { Inject, Injectable } from "@nestjs/common";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import { canonicalStringify } from "../crypto/canonical-stringify";
import type {
  ProofBundle,
  ProofVerificationResult,
  StepResult,
} from "./proof-bundle.schema";

/**
 * Stateless Proof Verification Service.
 *
 * Takes a ProofBundle JSON document and performs independent verification.
 * This service does NOT depend on any database — it verifies purely from
 * the materials in the bundle + optional external resolution endpoints.
 *
 * Can be deployed as a standalone microservice or used by any external party.
 */
@Injectable()
export class ProofVerifierService {
  constructor(
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
  ) {}
  /**
   * Verify a standalone proof bundle.
   *
   * Returns a detailed step-by-step result showing what passed and what failed.
   * Overall `valid = true` only if ALL steps pass.
   *
   * @param bundle The complete proof bundle JSON
   * @param resolvedPublicKey Optional: if the verifier has independently
   *   resolved the public key from the credential registry, pass it here
   *   to cross-check against the bundle.
   */
  verify(
    bundle: ProofBundle,
    resolvedPublicKey?: string,
  ): ProofVerificationResult {
    const steps: StepResult[] = [];

    // ── Step 1: Check bundle structure ─────────────────────
    steps.push(this.verifyBundleStructure(bundle));

    // ── If not cryptographically signed, only verify hash chain ──
    if (!bundle.verification.isCryptographicallySigned) {
      steps.push(this.verifyHashChain(bundle));
      return this.buildResult(steps);
    }

    // ── Step 2: Recompute intent hash ──────────────────────
    steps.push(this.verifyIntentHash(bundle));

    // ── Step 3: Verify clientDataJSON challenge binding ────
    steps.push(this.verifyChallenge(bundle));

    // ── Step 4: Verify payload hash ────────────────────────
    steps.push(this.verifyPayloadHash(bundle));

    // ── Step 5: Cross-check public key if resolved ─────────
    if (resolvedPublicKey) {
      steps.push(this.crossCheckPublicKey(bundle, resolvedPublicKey));
    }

    // ── Step 6: Verify WebAuthn signature ──────────────────
    steps.push(this.verifySignature(bundle));

    // ── Step 7: Verify hash chain ──────────────────────────
    steps.push(this.verifyHashChain(bundle));

    return this.buildResult(steps);
  }

  // ── Individual verification steps ──────────────────────────

  private verifyBundleStructure(bundle: ProofBundle): StepResult {
    const step = 1;
    const name = "Bundle structure";

    if (!bundle.version || bundle.version !== "1.0") {
      return {
        step,
        name,
        passed: false,
        detail: `Unknown bundle version: ${bundle.version}`,
      };
    }
    if (!bundle.intent || !bundle.signer || !bundle.chain) {
      return {
        step,
        name,
        passed: false,
        detail: "Missing required sections: intent, signer, or chain",
      };
    }
    if (bundle.verification.isCryptographicallySigned && !bundle.assertion) {
      return {
        step,
        name,
        passed: false,
        detail: "Bundle claims to be signed but assertion is null",
      };
    }

    return {
      step,
      name,
      passed: true,
      detail: "Bundle structure is valid (version 1.0)",
    };
  }

  private verifyIntentHash(bundle: ProofBundle): StepResult {
    const step = 2;
    const name = "Intent hash";

    if (!bundle.assertion) {
      return { step, name, passed: false, detail: "No assertion present" };
    }

    // Recompute: SHA-256(eventType|entityId|actorId) → base64url
    const intentInput = `${bundle.intent.eventType}|${bundle.intent.entityId}|${bundle.signer.userId}`;
    const recomputedHash = this.crypto.sha256Base64Url(intentInput);

    const matches = recomputedHash === bundle.assertion.intentHash;
    return {
      step,
      name,
      passed: matches,
      detail: matches
        ? `Intent hash verified: SHA-256("${intentInput}") = ${recomputedHash}`
        : `Intent hash mismatch: recomputed ${recomputedHash}, bundle has ${bundle.assertion.intentHash}`,
    };
  }

  private verifyChallenge(bundle: ProofBundle): StepResult {
    const step = 3;
    const name = "Challenge binding";

    if (!bundle.assertion?.clientDataJSON) {
      return {
        step,
        name,
        passed: false,
        detail: "No clientDataJSON in assertion",
      };
    }

    try {
      // clientDataJSON is base64url or base64 encoded
      const decoded = Buffer.from(
        bundle.assertion.clientDataJSON,
        "base64url",
      ).toString("utf-8");

      let clientData: { type?: string; challenge?: string; origin?: string };
      try {
        clientData = JSON.parse(decoded);
      } catch {
        // Try base64 if base64url didn't decode to valid JSON
        const decoded2 = Buffer.from(
          bundle.assertion.clientDataJSON,
          "base64",
        ).toString("utf-8");
        clientData = JSON.parse(decoded2);
      }

      if (clientData.type !== "webauthn.get") {
        return {
          step,
          name,
          passed: false,
          detail: `Unexpected clientData type: "${clientData.type}" (expected "webauthn.get")`,
        };
      }

      const challengeMatches =
        clientData.challenge === bundle.assertion.intentHash;

      return {
        step,
        name,
        passed: challengeMatches,
        detail: challengeMatches
          ? `Challenge in clientDataJSON matches intentHash (origin: ${clientData.origin})`
          : `Challenge mismatch: clientDataJSON.challenge = "${clientData.challenge}", intentHash = "${bundle.assertion.intentHash}"`,
      };
    } catch (err: any) {
      return {
        step,
        name,
        passed: false,
        detail: `Failed to decode clientDataJSON: ${err.message}`,
      };
    }
  }

  private verifyPayloadHash(bundle: ProofBundle): StepResult {
    const step = 4;
    const name = "Payload hash";

    const recomputedHash = this.crypto.sha256Hex(
      canonicalStringify(bundle.intent.payload),
    );

    const matches = recomputedHash === bundle.intent.payloadHash;
    return {
      step,
      name,
      passed: matches,
      detail: matches
        ? `Payload hash verified: ${recomputedHash}`
        : `Payload hash mismatch: recomputed ${recomputedHash}, bundle has ${bundle.intent.payloadHash}`,
    };
  }

  private crossCheckPublicKey(
    bundle: ProofBundle,
    resolvedPublicKey: string,
  ): StepResult {
    const step = 5;
    const name = "Public key cross-check";

    const matches = resolvedPublicKey === bundle.credential.publicKeyBase64;
    return {
      step,
      name,
      passed: matches,
      detail: matches
        ? "Public key from registry matches credential in bundle"
        : "PUBLIC KEY MISMATCH: registry key differs from bundle — possible tampering",
    };
  }

  private verifySignature(bundle: ProofBundle): StepResult {
    const step = 6;
    const name = "WebAuthn signature";

    if (!bundle.assertion) {
      return { step, name, passed: false, detail: "No assertion present" };
    }

    try {
      // ── Decode the materials ────────────────────────────
      const authenticatorData = Buffer.from(
        bundle.assertion.authenticatorData,
        "base64",
      );
      const clientDataJSON = this.decodeClientDataJSON(
        bundle.assertion.clientDataJSON,
      );
      const signature = Buffer.from(bundle.assertion.signature, "base64");
      const publicKeyBase64 = bundle.credential.publicKeyBase64;

      // ── Compute clientDataHash = SHA-256(raw clientDataJSON bytes) ──
      const clientDataHash = this.crypto.sha256Buffer(clientDataJSON);

      // ── signedData = authenticatorData || clientDataHash ──
      const signedData = Buffer.concat([authenticatorData, clientDataHash]);

      // ── Verify using CryptoService ──
      const verified = this.crypto.verifyEcdsaP256(
        signedData,
        signature,
        Buffer.from(publicKeyBase64, "base64"),
      );

      return {
        step,
        name,
        passed: verified,
        detail: verified
          ? "ECDSA P-256 signature verified successfully over authenticatorData || SHA-256(clientDataJSON)"
          : "Signature verification failed — signature does not match signed data and public key",
      };
    } catch (err: any) {
      return {
        step,
        name,
        passed: false,
        detail: `Signature verification error: ${err.message}`,
      };
    }
  }

  private verifyHashChain(bundle: ProofBundle): StepResult {
    const step = 7;
    const name = "Hash chain integrity";

    try {
      // Recompute the event hash using the documented format
      const hashInput = [
        bundle.chain.previousHash,
        bundle.intent.entityType,
        bundle.intent.entityId,
        String(bundle.chain.entitySequence),
        bundle.intent.eventType,
        bundle.signer.userId,
        bundle.signer.role,
        canonicalStringify(bundle.intent.payload),
        bundle.intent.timestamp,
      ].join("|");

      const recomputedHash = this.crypto.sha256Hex(hashInput);

      const matches = recomputedHash === bundle.chain.eventHash;

      return {
        step,
        name,
        passed: matches,
        detail: matches
          ? `Event hash verified: ${recomputedHash}`
          : `Hash mismatch: recomputed ${recomputedHash}, bundle has ${bundle.chain.eventHash}`,
      };
    } catch (err: any) {
      return {
        step,
        name,
        passed: false,
        detail: `Hash chain verification error: ${err.message}`,
      };
    }
  }

  // ── Crypto helpers ─────────────────────────────────────────

  /**
   * Decode clientDataJSON from base64url (or base64 fallback).
   * Returns the raw bytes (needed for hashing).
   */
  private decodeClientDataJSON(encoded: string): Buffer {
    try {
      const decoded = Buffer.from(encoded, "base64url");
      // Verify it's valid JSON
      JSON.parse(decoded.toString("utf-8"));
      return decoded;
    } catch {
      return Buffer.from(encoded, "base64");
    }
  }

  // ── Result builder ─────────────────────────────────────────

  private buildResult(steps: StepResult[]): ProofVerificationResult {
    const allPassed = steps.every((s) => s.passed);
    const failed = steps.filter((s) => !s.passed);

    let summary: string;
    if (allPassed) {
      summary = `VALID — All ${steps.length} verification steps passed. The proof is cryptographically sound.`;
    } else {
      summary = `INVALID — ${failed.length} of ${steps.length} steps failed: ${failed.map((f) => f.name).join(", ")}`;
    }

    return {
      valid: allPassed,
      verifiedAt: new Date().toISOString(),
      steps,
      summary,
    };
  }
}
