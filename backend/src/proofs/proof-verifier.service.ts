import { Injectable } from "@nestjs/common";
import { createHash, createVerify } from "crypto";
import type {
  ProofBundle,
  ProofVerificationResult,
  StepResult,
} from "./proof-bundle.schema";

/**
 * Canonical JSON serialization with sorted keys — identical to ledger.service.ts.
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        JSON.stringify(key) +
        ":" +
        canonicalStringify((obj as Record<string, unknown>)[key]),
    )
    .join(",");
  return "{" + sorted + "}";
}

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
    const recomputedHash = createHash("sha256")
      .update(intentInput)
      .digest("base64url");

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

    const recomputedHash = createHash("sha256")
      .update(canonicalStringify(bundle.intent.payload))
      .digest("hex");

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
      const clientDataHash = createHash("sha256")
        .update(clientDataJSON)
        .digest();

      // ── signedData = authenticatorData || clientDataHash ──
      const signedData = Buffer.concat([authenticatorData, clientDataHash]);

      // ── Try to verify the signature using COSE key ──────
      // The publicKey can be in COSE format. We need to convert to
      // a format Node.js crypto can use. COSE EC2 keys for P-256 are
      // structured; we'll try to extract the raw EC components.
      const verified = this.verifyCoseSignature(
        signedData,
        signature,
        publicKeyBase64,
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

      const recomputedHash = createHash("sha256")
        .update(hashInput)
        .digest("hex");

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

  /**
   * Verify an ECDSA P-256 signature using a COSE-encoded public key.
   *
   * COSE EC2 key structure (map):
   *   1 (kty) = 2 (EC2)
   *   3 (alg) = -7 (ES256)
   *  -1 (crv) = 1 (P-256)
   *  -2 (x)   = 32 bytes
   *  -3 (y)   = 32 bytes
   *
   * We extract x,y and build an uncompressed SEC1 point (0x04 || x || y),
   * then wrap it in a SPKI DER envelope for Node.js crypto.
   */
  private verifyCoseSignature(
    signedData: Buffer,
    signature: Buffer,
    publicKeyBase64: string,
  ): boolean {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");

    // Try COSE decode first
    const spkiKey = this.coseToSpki(publicKeyBytes);
    if (!spkiKey) {
      // If COSE decode fails, the key might already be in SPKI format
      // Try using it directly
      try {
        const verifier = createVerify("SHA256");
        verifier.update(signedData);
        return verifier.verify(
          { key: publicKeyBytes, format: "der", type: "spki" },
          this.derEncodeSignature(signature),
        );
      } catch {
        return false;
      }
    }

    // WebAuthn signatures are in raw IEEE P1363 format (r||s, 32+32 bytes).
    // Node.js crypto expects DER-encoded signatures.
    const derSignature = this.derEncodeSignature(signature);

    try {
      const verifier = createVerify("SHA256");
      verifier.update(signedData);
      return verifier.verify(
        { key: spkiKey, format: "der", type: "spki" },
        derSignature,
      );
    } catch {
      return false;
    }
  }

  /**
   * Convert a COSE EC2 key to SPKI DER format for Node.js crypto.
   *
   * Minimal CBOR parsing for the specific COSE structure we expect.
   */
  private coseToSpki(coseKey: Buffer): Buffer | null {
    try {
      // Simple CBOR map parser for COSE EC2 keys
      const parsed = this.parseCoseKey(coseKey);
      if (!parsed) return null;

      const { x, y } = parsed;
      if (!x || !y || x.length !== 32 || y.length !== 32) return null;

      // Build uncompressed EC point: 0x04 || x || y
      const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), x, y]);

      // Wrap in SPKI DER envelope for P-256
      // SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING { point } }
      // AlgorithmIdentifier for id-ecPublicKey with prime256v1
      const algorithmId = Buffer.from(
        "301306072a8648ce3d020106082a8648ce3d030107",
        "hex",
      );

      // BIT STRING wrapping: 03 42 00 <point>
      const bitString = Buffer.concat([
        Buffer.from([0x03, 0x42, 0x00]),
        uncompressedPoint,
      ]);

      // Outer SEQUENCE
      const innerLen = algorithmId.length + bitString.length;
      const spki = Buffer.concat([
        Buffer.from([0x30, innerLen]),
        algorithmId,
        bitString,
      ]);

      return spki;
    } catch {
      return null;
    }
  }

  /**
   * Minimal CBOR parser for COSE EC2 key maps.
   * Handles the specific structure produced by WebAuthn authenticators.
   */
  private parseCoseKey(buf: Buffer): { x: Buffer; y: Buffer } | null {
    try {
      let offset = 0;

      // A COSE key is a CBOR map. The first byte indicates map type.
      const firstByte = buf[offset++];
      let mapSize: number;

      if ((firstByte & 0xe0) === 0xa0) {
        // Fixed-size map (0xa0-0xb7)
        mapSize = firstByte & 0x1f;
      } else if (firstByte === 0xb8) {
        mapSize = buf[offset++];
      } else if (firstByte === 0xbf) {
        // Indefinite-length map — scan for break code (0xff)
        mapSize = -1;
      } else {
        return null;
      }

      let x: Buffer | null = null;
      let y: Buffer | null = null;
      let count = 0;

      while (offset < buf.length) {
        if (mapSize >= 0 && count >= mapSize) break;
        if (mapSize < 0 && buf[offset] === 0xff) break;

        // Read key (negative or positive int)
        const { value: key, newOffset: keyOff } = this.readCborInt(buf, offset);
        offset = keyOff;

        // Read value
        const valueByte = buf[offset];
        if ((valueByte & 0xe0) === 0x40) {
          // Byte string
          const len = valueByte & 0x1f;
          offset++;
          const val = buf.subarray(offset, offset + len);
          offset += len;

          if (key === -2) x = Buffer.from(val);
          if (key === -3) y = Buffer.from(val);
        } else if (valueByte === 0x58) {
          // Byte string with 1-byte length
          offset++;
          const len = buf[offset++];
          const val = buf.subarray(offset, offset + len);
          offset += len;

          if (key === -2) x = Buffer.from(val);
          if (key === -3) y = Buffer.from(val);
        } else {
          // Skip other value types
          const { newOffset: valOff } = this.skipCborValue(buf, offset);
          offset = valOff;
        }

        count++;
      }

      return x && y ? { x, y } : null;
    } catch {
      return null;
    }
  }

  private readCborInt(
    buf: Buffer,
    offset: number,
  ): { value: number; newOffset: number } {
    const first = buf[offset++];
    const major = (first & 0xe0) >> 5;
    const additional = first & 0x1f;

    let rawValue: number;
    if (additional < 24) {
      rawValue = additional;
    } else if (additional === 24) {
      rawValue = buf[offset++];
    } else if (additional === 25) {
      rawValue = buf.readUInt16BE(offset);
      offset += 2;
    } else {
      rawValue = 0;
      offset++;
    }

    // Major type 1 = negative integer
    const value = major === 1 ? -(rawValue + 1) : rawValue;
    return { value, newOffset: offset };
  }

  private skipCborValue(buf: Buffer, offset: number): { newOffset: number } {
    const first = buf[offset++];
    const major = (first & 0xe0) >> 5;
    const additional = first & 0x1f;

    let len = 0;
    if (additional < 24) {
      len = additional;
    } else if (additional === 24) {
      len = buf[offset++];
    } else if (additional === 25) {
      len = buf.readUInt16BE(offset);
      offset += 2;
    }

    if (major === 2 || major === 3) {
      // byte string or text string
      offset += len;
    }
    // For integers, the value was already consumed

    return { newOffset: offset };
  }

  /**
   * Convert a raw IEEE P1363 signature (r||s) to DER format.
   *
   * WebAuthn produces P1363 format: fixed-size r (32 bytes) || s (32 bytes).
   * Node.js crypto expects DER: SEQUENCE { INTEGER r, INTEGER s }.
   */
  private derEncodeSignature(rawSig: Buffer): Buffer {
    // If it already looks like DER (starts with 0x30), return as-is
    if (rawSig[0] === 0x30) return rawSig;

    // Split into r and s (32 bytes each for P-256)
    const halfLen = rawSig.length / 2;
    let r = rawSig.subarray(0, halfLen);
    let s = rawSig.subarray(halfLen);

    // Trim leading zeros but ensure high bit doesn't make it negative
    r = this.trimAndPad(r);
    s = this.trimAndPad(s);

    // DER encode: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
    const totalLen = 2 + r.length + 2 + s.length;
    return Buffer.concat([
      Buffer.from([0x30, totalLen, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
  }

  private trimAndPad(buf: Buffer): Buffer {
    // Remove leading zeros
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0) start++;
    buf = buf.subarray(start);

    // If high bit is set, prepend a 0x00 byte (so DER treats it as positive)
    if (buf[0] & 0x80) {
      buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }

    return buf;
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
