# Evidence Pack → Trust Envelope: Implementation Plan

## Deep Gap Analysis

### What the Feedback Asks For vs What We Already Have

| # | Requirement | Status | What We Have | What's Missing |
|---|------------|--------|--------------|----------------|
| 1 | **Event Hash** (`eventHash` per event) | ✅ **Done** | `EventLog.eventHash` = SHA-256 of 9 fields joined by `\|`. Included in evidence pack's `ledgerEvents[]` and proof bundles' `chain.eventHash`. | Nothing |
| 2 | **Hash Chain** (`previousHash` linking events) | ✅ **Done** | Full global chain. `previousHash` → `eventHash`. First event = `"GENESIS"`. SERIALIZABLE Postgres transactions with retry prevent forks. | Nothing |
| 3 | **Actor Public Keys** (top-level actors array) | ⚠️ **Buried** | Public keys exist inside each `proofBundle.credential.publicKeyBase64` (COSE format). Signer identity exists inside `proofBundle.signer`. Public registry at `GET /proofs/registry/credentials/:id` and `GET /proofs/identity/signers/:id`. | **No top-level `actors[]` array** in the pack. A bank must dig through individual proof bundles to find keys. |
| 4 | **Event Signatures** (per critical event) | ✅ **Done** | WebAuthn ECDSA P-256 signatures stored in `EventLog.actorSignature`. Full assertion (clientDataJSON, authenticatorData, signature) in proof bundles. Intent hash binds signature to business action. | Nothing — we actually exceed the requirement (WebAuthn intent binding is stronger than plain EdDSA signatures) |
| 5 | **Integrity Section** (root hashes) | ❌ **Wrong shape** | Current `integrity` is an array of per-file attachment checksums `[{ attachmentId, valid, sha256 }]`. | Missing: `eventsRootHash`, `documentHash`, `attachmentsHash`, `packHash`, `eventCount`, `algorithm`, `generatedBy` |
| 6 | **Verification Script** | ✅ **Done** | `scripts/verify-evidence-pack.mjs` — 911 lines, zero dependencies, 10 verification sections, full COSE/CBOR/DER crypto stack reimplemented. | Nothing — this exceeds the requirement |
| 7 | **Verification Instructions** | ⚠️ **Partial** | Each proof bundle has `verification.steps[]` (7 steps). | Pack-level verification instructions (how to run the script) not in the pack JSON itself |
| 8 | **`metadata` section** | ❌ **Missing** | Only `packVersion: "1.1"` and `generatedAt` exist as top-level fields. | No `packId`, `generator`, `algorithm`, or `schemaVersion` |
| 9 | **`actors[]` top-level** | ❌ **Missing** | Actor info scattered across proof bundles. | Need deduplicated array with `id, role, legalName, publicKey, jurisdiction` |
| 10 | **`approvals[]` separated** | ❌ **Missing** | Signatures exist inside proof bundles. | Bank-grade format wants explicit approval records separate from raw events |
| 11 | **Trust Envelope structure** | ❌ **Missing** | Flat structure with `purchaseOrder, attachments, ledgerEvents, proofBundles, integrity` | Need restructured: `metadata, actors, document, ledger, approvals, attachments, integrity, verification` |
| 12 | **RFC 3161 Timestamp** | ❌ **Missing** | No external timestamp authority. | Future phase — requires TSA integration |
| 13 | **Pack-level signature** | ❌ **Missing** | Pack is unsigned JSON. | Platform key should sign the pack hash for tamper evidence |

### What We Have That EXCEEDS the Feedback

The feedback underestimates what we already built. These are **strengths to preserve**:

| Feature | Detail |
|---------|--------|
| **WebAuthn intent binding** | Challenge = `SHA-256(eventType\|entityId\|actorId)` — cryptographically binds the biometric action to the exact business intent. Much stronger than simple "sign this hash" |
| **Proof bundles** | Self-contained per-event cryptographic proofs with all data needed for offline verification |
| **Public credential/identity registry** | `GET /proofs/registry/credentials/:id` and `GET /proofs/identity/signers/:id` — public, unauthenticated endpoints for independent verification |
| **7-step verification protocol** | Each proof bundle embeds machine-readable verification instructions |
| **COSE key format** | Standard WebAuthn key encoding, not proprietary |
| **Canonical JSON** | Deterministic stringification with documented algorithm, not ad-hoc |
| **Per-entity + global sequence** | Both `entitySequence` and `sequence` (global) tracked |
| **Standalone verifier** | 911-line zero-dep script that reimplements the entire crypto stack |

---

## Architecture Decision

The feedback proposes three progressively sophisticated models:
1. **Bank-grade evidence pack** — adds integrity, actors, approvals
2. **Stripe-style event sourcing** — architectural pattern (we already follow this)
3. **Trust Envelope** — the final form

**Decision**: Implement the **Trust Envelope** model directly. Our current system already has all the raw data — we just need to restructure the output format and add computed integrity.

**Key principle**: The Trust Envelope is a **read-side projection** — we don't change the data model, event store, or crypto. We only change how `buildEvidencePack()` shapes the output.

---

## Phased Implementation Plan

### Phase 1 — Trust Envelope Structure (evidence.service.ts)
**Scope**: Restructure `buildEvidencePack()` output to Trust Envelope format  
**Risk**: Low — read-side only, no data model changes  
**Effort**: Medium

Changes:
1. Add `metadata` section:
   ```json
   {
     "envelopeId": "tenv_{uuid}",
     "packVersion": "2.0",
     "schemaVersion": "trust-envelope-v1",
     "generatedAt": "ISO-8601",
     "generator": "sme-payments-trust-ledger",
     "hashAlgorithm": "SHA-256",
     "signatureAlgorithm": "WebAuthn-FIDO2-ES256 (ECDSA P-256)"
   }
   ```

2. Add top-level `actors[]` array:
   - Deduplicate from proof bundles + PO buyer/supplier
   - Include: `id, role, legalName, companyName, jurisdiction, publicKeys[]` (can have multiple passkeys)
   - Include `publicKeyResolutionUri` for each credential
   - Include `identityResolutionUri` for each actor

3. Rename `purchaseOrder` → `document` with type discriminator:
   ```json
   {
     "type": "PURCHASE_ORDER",
     "id": "...",
     "documentHash": "SHA-256 of canonical document",
     ...all existing PO fields...
   }
   ```

4. Restructure `ledgerEvents` → `ledger.events[]`:
   - Wrap in `ledger: { chainAlgorithm, hashInputFormat, events[] }`
   - Add explicit `ledger.chainAlgorithm` and `ledger.hashInputFormat` documentation

5. Add `approvals[]` top-level:
   - Extract from proof bundles where `assertion !== null`
   - Each: `{ eventId, eventType, actorId, actorRole, method: "passkey", credentialId, signature, intentHash, timestamp }`

6. Keep `attachments[]` as-is (already correct shape)

7. Keep `proofBundles[]` as-is (already correct — these are the deep crypto proofs)

8. Add `canonicalization` into metadata (move from top-level)

### Phase 2 — Computed Integrity Hashes
**Scope**: Add integrity root hashes to evidence pack  
**Risk**: Low — hashing existing data  
**Effort**: Low

Changes to `buildEvidencePack()`:

1. Compute `documentHash`:
   ```
   SHA-256(canonicalStringify(document_section))
   ```

2. Compute `ledgerRootHash`:
   ```
   SHA-256(eventHash_1 | eventHash_2 | ... | eventHash_N)
   ```

3. Compute `attachmentsHash`:
   ```
   SHA-256(sha256_1 | sha256_2 | ... | sha256_N)
   ```
   (or `SHA-256("NONE")` if no attachments)

4. Compute `fileIntegrity[]`:
   - Keep existing per-file verification results

5. Compute `envelopeHash`:
   ```
   SHA-256(documentHash | ledgerRootHash | attachmentsHash)
   ```
   This is the **pack-level fingerprint**. If anything changes, it breaks.

6. Final `integrity` section:
   ```json
   {
     "integrity": {
       "documentHash": "hex",
       "ledgerRootHash": "hex",
       "attachmentsHash": "hex",
       "envelopeHash": "hex",
       "eventCount": 12,
       "attachmentCount": 2,
       "signedEventCount": 4,
       "unsignedEventCount": 8,
       "fileIntegrity": [
         { "attachmentId": "...", "filename": "...", "valid": true, "sha256": "..." }
       ]
     }
   }
   ```

### Phase 3 — Verification Instructions + Updated Script
**Scope**: Embed verification instructions in pack + update standalone script  
**Risk**: Low  
**Effort**: Medium

1. Add `verification` section to pack:
   ```json
   {
     "verification": {
       "instructions": "Download verify-evidence-pack.mjs and run: node verify-evidence-pack.mjs <pack.json>",
       "scriptHash": "SHA-256 of the verification script",
       "repository": "https://github.com/{org}/sme-payments/tree/main/scripts",
       "checksToPerform": [
         "Verify ledger hash chain integrity",
         "Verify event hash recomputation",
         "Verify payload hash matches canonical payload",
         "Verify WebAuthn intent hash binding",
         "Verify ECDSA P-256 signatures against embedded public keys",
         "Verify integrity root hashes (documentHash, ledgerRootHash, envelopeHash)",
         "Verify attachment content hashes",
         "Cross-check actor identities via public registry URIs"
       ]
     }
   }
   ```

2. Update `verify-evidence-pack.mjs`:
   - Support new Trust Envelope structure (section names changed)
   - Add integrity root hash verification (recompute and compare)
   - Add `envelopeHash` verification
   - Maintain backward compatibility with v1.1 packs
   - Add `actors[]` validation (keys match proof bundles)
   - Add `approvals[]` cross-reference validation

3. Create `documentation/verify-evidence-pack.md`:
   - Step-by-step instructions for banks/auditors
   - What each section proves
   - Expected output examples

### Phase 4 — Pack-Level Signature (Platform Key)
**Scope**: Sign the evidence pack with a platform-held key  
**Risk**: Medium — introduces key management  
**Effort**: Medium

1. Generate a platform ECDSA P-256 key pair (stored securely, e.g. env var or KMS)
2. After computing `envelopeHash`, sign it with the platform key
3. Add `platformSignature` section:
   ```json
   {
     "platformSignature": {
       "algorithm": "ECDSA-P256-SHA256",
       "signature": "base64",
       "publicKey": "base64 (SPKI DER)",
       "signedAt": "ISO-8601",
       "signedFields": "envelopeHash"
     }
   }
   ```
4. This proves the pack was generated by the platform and not tampered with after generation
5. Update verification script to verify platform signature

### Phase 5 — RFC 3161 Timestamping (Future / Production)
**Scope**: External timestamp authority integration  
**Risk**: Medium — external dependency  
**Effort**: Medium-High

1. After computing `envelopeHash`, submit to RFC 3161 TSA (e.g. FreeTSA, DigiCert)
2. Store TSA response token
3. Add `notarization` section:
   ```json
   {
     "notarization": {
       "timestampAuthority": "RFC3161",
       "tsaUrl": "https://freetsa.org/tsr",
       "timestamp": "ISO-8601",
       "tsaToken": "base64 (DER-encoded TimeStampToken)",
       "algorithm": "SHA-256"
     }
   }
   ```
4. This proves the evidence pack existed at a specific time — critical for disputes
5. Update verification script to verify TSA token

---

## Files to Modify

| Phase | File | Change |
|-------|------|--------|
| 1-2 | `backend/src/evidence/evidence.service.ts` | Restructure `buildEvidencePack()` return shape |
| 1 | `backend/src/evidence/evidence.controller.ts` | May need updated return type annotations |
| 3 | `scripts/verify-evidence-pack.mjs` | Support new structure + integrity verification |
| 3 | `documentation/verify-evidence-pack.md` | NEW — bank-facing verification instructions |
| 4 | `backend/src/crypto/node-crypto.service.ts` | Add `signWithPlatformKey()` method |
| 4 | `backend/src/evidence/evidence.service.ts` | Sign pack after generation |
| 5 | New service: `backend/src/crypto/tsa.service.ts` | RFC 3161 TSA client |

## Files NOT Modified

| File | Why |
|------|-----|
| `prisma/schema.prisma` | No data model changes — Trust Envelope is a read projection |
| `ledger.service.ts` | Hash chain is already correct |
| `proof-generator.service.ts` | Proof bundles are already correct and complete |
| `proof-verifier.service.ts` | Stateless verifier already works perfectly |
| `proofs.controller.ts` | Proof APIs don't change |

---

## Final Trust Envelope Structure (Target)

```json
{
  "metadata": {
    "envelopeId": "tenv_92ac1d...",
    "packVersion": "2.0",
    "schemaVersion": "trust-envelope-v1",
    "generatedAt": "2026-03-09T16:11:02.000Z",
    "generator": "sme-payments-trust-ledger",
    "hashAlgorithm": "SHA-256",
    "signatureAlgorithm": "WebAuthn-FIDO2-ES256 (ECDSA P-256)",
    "canonicalization": {
      "algorithm": "Recursive key-sorted JSON, no whitespace, dates as ISO-8601",
      "implementation": "Object.keys(obj).sort() applied recursively; arrays preserve order"
    }
  },

  "actors": [
    {
      "id": "user-uuid",
      "role": "BUYER",
      "name": "Alice Smith",
      "companyName": "ACME Procurement Ltd",
      "jurisdiction": "UK",
      "credentials": [
        {
          "credentialId": "base64url",
          "publicKeyBase64": "base64 (COSE)",
          "deviceType": "multiDevice",
          "backedUp": true,
          "registeredAt": "ISO-8601",
          "resolutionUri": "GET /proofs/registry/credentials/:id"
        }
      ],
      "identityResolutionUri": "GET /proofs/identity/signers/:id"
    }
  ],

  "document": {
    "type": "PURCHASE_ORDER",
    "id": "po-uuid",
    "reference": "PO-2026-0042",
    "documentHash": "SHA-256 hex of canonical document",
    "...all existing PO fields..."
  },

  "attachments": [
    {
      "id": "att-uuid",
      "type": "DELIVERY_NOTE",
      "filename": "receipt.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 12345,
      "sha256Hash": "hex",
      "uploadedBy": { "id": "...", "name": "...", "role": "..." },
      "createdAt": "ISO-8601"
    }
  ],

  "ledger": {
    "chainAlgorithm": "SHA-256",
    "hashInputFormat": "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp",
    "events": [
      {
        "id": "event-uuid",
        "sequence": 42,
        "entitySequence": 5,
        "eventType": "PO_CREATED",
        "actorId": "user-uuid",
        "actorRole": "BUYER",
        "payload": {},
        "timestamp": "ISO-8601",
        "eventHash": "hex",
        "previousHash": "hex | GENESIS",
        "actorSignature": "base64 | SYSTEM",
        "intentHash": "base64url | null"
      }
    ]
  },

  "approvals": [
    {
      "eventId": "event-uuid",
      "eventType": "PO_ACCEPTED",
      "actorId": "user-uuid",
      "actorRole": "SUPPLIER",
      "method": "passkey",
      "credentialId": "base64url",
      "intentHash": "base64url",
      "signature": "base64",
      "timestamp": "ISO-8601"
    }
  ],

  "proofBundles": [ "...existing proof bundle structure (unchanged)..." ],

  "integrity": {
    "documentHash": "hex",
    "ledgerRootHash": "hex",
    "attachmentsHash": "hex",
    "envelopeHash": "hex",
    "eventCount": 12,
    "attachmentCount": 2,
    "signedEventCount": 4,
    "unsignedEventCount": 8,
    "fileIntegrity": [
      { "attachmentId": "...", "filename": "...", "valid": true, "sha256": "hex" }
    ]
  },

  "verification": {
    "instructions": "node verify-evidence-pack.mjs <this-file.json>",
    "scriptHash": "SHA-256 of verify-evidence-pack.mjs",
    "checksToPerform": [ "..." ]
  },

  "platformSignature": {
    "algorithm": "ECDSA-P256-SHA256",
    "signature": "base64",
    "publicKey": "base64 (SPKI DER)",
    "signedAt": "ISO-8601",
    "signedFields": "envelopeHash"
  },

  "notarization": null
}
```

---

## Implementation Order

```
Phase 1 (Structure)   →  Phase 2 (Integrity)   →  Phase 3 (Verification)
      ↓                         ↓                         ↓
  evidence.service.ts    evidence.service.ts     verify-evidence-pack.mjs
  (reshape output)       (add hash computation)  (support new format)
                                                  verify-evidence-pack.md

                          Phase 4 (Platform Sig)  →  Phase 5 (TSA)
                                ↓                         ↓
                         node-crypto.service.ts    tsa.service.ts
                         evidence.service.ts       evidence.service.ts
```

Phases 1–3 can be done now. Phase 4 requires a key management decision. Phase 5 is production-only.
