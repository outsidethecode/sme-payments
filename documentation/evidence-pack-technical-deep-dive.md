# Evidence Pack & Trust Ledger — Technical Deep Dive

**Version:** 2.0 (Trust Envelope format)
**Date:** 9 March 2026
**Audience:** Engineering team, auditors, integration partners
**Status:** Implemented and live-tested (244/244 tests passing)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Immutable Ledger](#2-the-immutable-ledger)
3. [How Events Are Appended](#3-how-events-are-appended)
4. [Passkey Signing Flow (WebAuthn)](#4-passkey-signing-flow-webauthn)
5. [Proof Bundles](#5-proof-bundles)
6. [Evidence Attachments](#6-evidence-attachments)
7. [Trust Envelope Generation](#7-trust-envelope-generation)
8. [Cryptographic Primitives](#8-cryptographic-primitives)
9. [Platform Signing Key](#9-platform-signing-key)
10. [Verification Pipeline](#10-verification-pipeline)
11. [Web Verification Service](#11-web-verification-service)
12. [Database Schema](#12-database-schema)
13. [Module Dependency Graph](#13-module-dependency-graph)
14. [API Reference](#14-api-reference)
15. [Security Considerations](#15-security-considerations)
16. [What We Don't Do Yet (Future Work)](#16-what-we-dont-do-yet-future-work)

---

## 1. Architecture Overview

The evidence pack system is the trust layer of the platform. It produces a **self-contained, cryptographically verifiable JSON document** (the "Trust Envelope") that proves the complete lifecycle of a purchase order — who did what, when, and that nobody tampered with the record.

### Core Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| **LedgerService** | `backend/src/ledger/` | Append-only event log with SHA-256 hash chain |
| **ProofGeneratorService** | `backend/src/proofs/` | Builds standalone proof bundles per event |
| **ProofVerifierService** | `backend/src/proofs/` | Stateless per-bundle verification |
| **EvidenceService** | `backend/src/evidence/` | File attachments + Trust Envelope assembly |
| **CryptoModule** | `backend/src/crypto/` | All hashing, signing, verification (global DI) |
| **VerifyService** | `backend/src/verify/` | Full envelope verification (14 checks) |

### Data Flow

```
User action (e.g. accept PO)
    │
    ▼
┌──────────────────────────────────────────┐
│  LedgerService.logEvent()                │
│  ┌────────────────────────────────────┐  │
│  │ 1. Get entitySequence + 1          │  │
│  │ 2. Get previousHash (global chain) │  │
│  │ 3. Hash = SHA-256(prev|type|id|    │  │
│  │    seq|event|actor|role|           │  │
│  │    canonicalPayload|timestamp)     │  │
│  │ 4. INSERT into event_log           │  │
│  └────────────────────────────────────┘  │
│  Runs in SERIALIZABLE transaction        │
└──────────────────────────────────────────┘
    │
    ▼ (when evidence pack is requested)
┌──────────────────────────────────────────┐
│  EvidenceService.buildEvidencePack()     │
│  ┌────────────────────────────────────┐  │
│  │ 1. Load PO + relations from DB     │  │
│  │ 2. Load all ledger events          │  │
│  │ 3. Generate proof bundles (each    │  │
│  │    event → standalone proof)       │  │
│  │ 4. Build actors, approvals arrays  │  │
│  │ 5. Compute integrity hashes:       │  │
│  │    - documentHash                  │  │
│  │    - ledgerRootHash                │  │
│  │    - attachmentsHash               │  │
│  │    - envelopeHash (seal)           │  │
│  │ 6. Sign envelopeHash with          │  │
│  │    platform ECDSA P-256 key        │  │
│  │ 7. Return Trust Envelope JSON      │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## 2. The Immutable Ledger

### Design Principles

- **Append-only:** Events are only ever inserted, never updated or deleted.
- **Global hash chain:** Every event links to the immediately preceding event in the global ledger (not per-entity). The very first event has `previousHash = "GENESIS"`.
- **Per-entity sequencing:** Each entity (e.g., a purchase order) also has its own monotonically increasing `entitySequence` counter for ordering within that entity.
- **Deterministic hashing:** Every hash is recomputable from the stored data — there are no hidden inputs.

### Hash Chain Algorithm

Each event's `eventHash` is computed from a pipe-delimited string:

```
SHA-256(previousHash | entityType | entityId | entitySequence | eventType | actorId | actorRole | canonicalPayload | timestamp)
```

Where:
- `previousHash` = the `eventHash` of the globally preceding event (or `"GENESIS"`)
- `canonicalPayload` = JSON serialized with **sorted keys, no whitespace** (see §8)
- `timestamp` = ISO-8601 string from `Date.toISOString()`

The resulting hex digest is stored in `event_log.event_hash`.

### Why Global Chain?

A global chain means tampering with ANY event (even in a different entity) would break the chain for ALL subsequent events. This makes the ledger collectively harder to tamper with compared to per-entity chains. An attacker would need to recompute every subsequent hash in the entire system — not just for one PO.

### Concurrency: Serializable Transactions

Because the global chain requires reading the latest `eventHash` before inserting, two concurrent writers would both read the same `previousHash` and fork the chain. We prevent this with:

```typescript
await this.prisma.$transaction(async (tx) => {
  // ... read last hash, compute new hash, insert
}, { isolationLevel: "Serializable" });
```

PostgreSQL raises a serialization failure (`40001` / Prisma `P2034`) when two transactions conflict. The `logEvent()` method retries up to **5 times with exponential backoff** (10ms × 2^attempt + random jitter).

---

## 3. How Events Are Appended

Every significant business action produces a ledger event. The caller provides the business payload; the ledger service handles hashing and chaining.

### Callers

Events are logged from many service methods across the codebase. For example:

| Event Type | Trigger | Caller |
|------------|---------|--------|
| `PO_CREATED` | Buyer creates a PO | `PurchaseOrdersService` |
| `PO_ACCEPTED` | Supplier accepts | `PurchaseOrdersService` |
| `PO_REJECTED` | Supplier rejects | `PurchaseOrdersService` |
| `COUNTER_PROPOSED` | Supplier counter-proposes | `PurchaseOrdersService` |
| `REVISION_ACCEPTED` | Buyer accepts counter | `PurchaseOrdersService` |
| `PAYMENT_LOCKED` | Buyer locks funds | `PaymentLocksService` |
| `PAYMENT_RELEASED` | Payment released | `PaymentLocksService` |
| `EARLY_PAYMENT_REQUESTED` | Supplier requests early pay | `EarlyPaymentsService` |
| `EARLY_PAYMENT_FUNDED` | LP funds request | `EarlyPaymentsService` |
| `EVIDENCE_UPLOADED` | File evidence attached | `EvidenceService` |
| `SETTLEMENT_COMPLETED` | Settlement finalised | `SettlementsService` |

### logEvent Input

```typescript
interface LogEventInput {
  entityType: string;       // e.g., "PURCHASE_ORDER"
  entityId: string;         // the PO ID
  eventType: string;        // e.g., "PO_ACCEPTED"
  actorId: string;          // user ID who performed the action
  actorRole: string;        // "BUYER", "SUPPLIER", etc.
  payload: Record<string, unknown>;  // snapshot of the business data

  // Passkey signature fields (optional — omitted for system events):
  signature?: string;        // ECDSA signature (base64)
  authenticatorData?: string; // WebAuthn authenticator data (base64)
  publicKey?: string;        // COSE public key (base64)
  credentialId?: string;     // WebAuthn credential ID
  intentHash?: string;       // SHA-256 of business intent (base64url)
  clientDataJSON?: string;   // Raw WebAuthn clientDataJSON
}
```

### What Gets Stored in `event_log`

| Column | Description |
|--------|-------------|
| `id` | UUID primary key |
| `sequence` | Auto-incrementing global sequence |
| `entity_sequence` | Per-entity sequence (1, 2, 3… for each PO) |
| `entity_type` | `"PURCHASE_ORDER"` etc. |
| `entity_id` | The PO or entity ID |
| `event_type` | `"PO_ACCEPTED"` etc. |
| `actor_id` | User who performed the action |
| `actor_role` | Role at the time |
| `payload` | JSONB — full snapshot of business data |
| `timestamp` | When the event was recorded |
| `previous_hash` | Hash of the globally preceding event |
| `event_hash` | SHA-256 of this event (unique constraint) |
| `actor_signature` | ECDSA signature or `"SYSTEM"` |
| `authenticator_data` | WebAuthn authenticator data (nullable) |
| `actor_public_key` | COSE public key or `"SYSTEM"` |
| `credential_id` | WebAuthn credential ID (nullable) |
| `intent_hash` | SHA-256 of business intent (nullable) |
| `client_data_json` | Raw clientDataJSON from browser (nullable) |

### System Events vs. Passkey-Signed Events

- **System events** (`actorSignature = "SYSTEM"`): Logged automatically by the platform when a business action occurs without explicit passkey signing (e.g., PO creation before the user has registered a passkey).
- **Passkey-signed events**: The user's biometric/passkey produces a real ECDSA P-256 signature over an intent hash. All the raw WebAuthn materials are stored alongside the event so any external party can independently verify the signature.

---

## 4. Passkey Signing Flow (WebAuthn)

For high-trust actions (e.g., accepting a PO, funding an early payment), the user's passkey signs the business intent. This is a two-step flow:

### Step 1: Request Challenge

```
POST /api/ledger/challenge
Body: { entityId: "po-uuid", eventType: "PO_ACCEPTED" }
```

The backend computes a **deterministic intent hash**:

```
intentHash = SHA-256("PO_ACCEPTED|po-uuid|user-uuid") → base64url
```

This becomes the WebAuthn challenge. Unlike random nonces, this binds the biometric signature to the exact business action.

### Step 2: Submit Signed Event

The frontend presents the WebAuthn challenge to the user's authenticator (Touch ID, Face ID, Windows Hello). The authenticator produces:

- `clientDataJSON` — browser-produced JSON containing `{ type: "webauthn.get", challenge: "<intentHash>", origin: "..." }`
- `authenticatorData` — RP ID hash + flags + counter
- `signature` — ECDSA P-256 over `authenticatorData || SHA-256(clientDataJSON)`

```
POST /api/ledger/events
Body: {
  entityType: "PURCHASE_ORDER",
  entityId: "po-uuid",
  eventType: "PO_ACCEPTED",
  payload: { amount: 50000, ... },
  intentHash: "...",
  assertion: { id, rawId, response: { authenticatorData, clientDataJSON, signature }, ... }
}
```

The backend:
1. Verifies the WebAuthn assertion using `@simplewebauthn/server`
2. Extracts the raw signature, authenticator data, and public key
3. Calls `LedgerService.logEvent()` with all the cryptographic materials

### Why This Matters

The result is that the ledger event contains everything needed for an external party to verify:
- **What** was authorised (intent hash = hash of the business action)
- **Who** authorised it (public key, credential ID)
- **That they really did it** (ECDSA signature verifiable with the public key)
- **No platform trust required** — the materials are standard WebAuthn, verifiable with any FIDO2 library

---

## 5. Proof Bundles

A **proof bundle** is a self-contained JSON document for a single event. It contains everything needed to verify that event independently.

### Structure

```typescript
interface ProofBundle {
  version: "1.0";
  proofId: string;            // event log ID
  generatedAt: string;

  intent: {
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    timestamp: string;
    payloadHash: string;      // SHA-256(canonical(payload))
  };

  signer: {
    userId: string;
    name: string;
    email: string;
    role: string;
    organisation: { id, name, type, jurisdiction } | null;
  };

  credential: {
    credentialId: string;     // or "SYSTEM"
    publicKeyBase64: string;  // COSE key (base64)
    deviceType: string | null;
    backedUp: boolean;
    registeredAt: string;
    publicKeyResolutionUri: string;  // GET this to independently resolve the key
  };

  assertion: {                // null for system events
    intentHash: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  } | null;

  issuer: {
    name: string;
    rpId: string;
    origin: string;
    registryUri: string;      // credential lookup endpoint
    identityUri: string;      // signer identity endpoint
  };

  chain: {
    eventHash: string;
    previousHash: string;
    entitySequence: number;
    hashAlgorithm: "SHA-256";
    hashInputFormat: string;  // pipe-delimited format string
  };

  evidence: ProofEvidenceRef[];  // attached files

  verification: {
    isCryptographicallySigned: boolean;
    algorithm: "WebAuthn-FIDO2-ES256" | "none";
    steps: VerificationStep[];   // machine-readable verification recipe
  };
}
```

### Generation

`ProofGeneratorService.generateProof(eventId)` builds a proof bundle by:

1. Loading the event from `event_log`
2. Resolving the signer's identity from the `users` table (+ their organisation)
3. Resolving the credential from the `user_passkeys` table
4. Computing `payloadHash = SHA-256(canonical(payload))`
5. Including step-by-step verification instructions

For a full entity, `generateEntityProofs(entityId)` generates one proof bundle per event and verifies the hash chain in-process.

### Public Registries

The proof bundle includes URIs for independent resolution:

- `GET /api/proofs/registry/credentials/:credentialId` — returns the public key (no auth required)
- `GET /api/proofs/identity/signers/:userId` — returns the signer's identity and organisation (no auth required)

These allow an external verifier to independently confirm that the credential belongs to the claimed user.

---

## 6. Evidence Attachments

Physical evidence files (PDFs, images, spreadsheets) can be uploaded and linked to a PO.

### Upload Flow

```
POST /api/evidence/upload (multipart/form-data)
Fields: file, purchaseOrderId, type, description
```

1. Validate file (max 10 MB, allowed MIME types: PDF, JPEG, PNG, WebP, CSV, XLSX)
2. Compute `SHA-256(file buffer)` → stored as `sha256_hash`
3. Write file to disk (`uploads/` directory, UUID filename)
4. Create `evidence_attachments` DB record
5. Log `EVIDENCE_UPLOADED` ledger event with file metadata (attachment ID, type, filename, size, hash)

### Integrity Verification

```
GET /api/evidence/:id/verify
```

Re-reads the file from disk, recomputes SHA-256, and compares to the stored hash. Returns `{ valid: true/false, storedHash, computedHash }`.

### Types

| Type | Description |
|------|-------------|
| `DELIVERY_NOTE` | Proof of delivery |
| `SIGNED_RECEIPT` | Signed acceptance |
| `PHOTO_PROOF` | Photographic evidence |
| `INVOICE` | Commercial invoice |
| `INSPECTION_REPORT` | Quality inspection |
| `SHIPPING_DOCUMENT` | Bill of lading, etc. |
| `PO_DOCUMENT` | The PO itself |
| `OTHER` | Catch-all |

---

## 7. Trust Envelope Generation

The Trust Envelope is the bank-grade output document. It's generated on-demand via:

```
GET /api/evidence/po/:poId/pack
```

### Sections

The envelope has this structure:

```json
{
  "metadata": {
    "envelopeId": "tenv_uuid",
    "packVersion": "2.0",
    "schemaVersion": "trust-envelope-v1",
    "generatedAt": "ISO-8601",
    "generator": "sme-payments-trust-ledger",
    "hashAlgorithm": "SHA-256",
    "signatureAlgorithm": "WebAuthn-FIDO2-ES256 (ECDSA P-256)",
    "canonicalization": {
      "algorithm": "Recursive key-sorted JSON, no whitespace, dates as ISO-8601",
      "implementation": "Object.keys(obj).sort() applied recursively; arrays preserve order"
    }
  },
  "actors": [ ... ],          // all participants with credentials
  "document": { ... },        // PO snapshot + documentHash
  "attachments": [ ... ],     // file evidence
  "ledger": {
    "chainAlgorithm": "SHA-256",
    "hashInputFormat": "previousHash|entityType|...",
    "events": [ ... ]
  },
  "approvals": [ ... ],       // explicit passkey-signed approvals
  "proofBundles": [ ... ],    // one per event
  "integrity": {
    "documentHash": "...",     // SHA-256(canonical(document))
    "ledgerRootHash": "...",   // SHA-256(event1Hash|event2Hash|...)
    "attachmentsHash": "...", // SHA-256(file1Hash|file2Hash|...) or SHA-256("NONE")
    "envelopeHash": "...",    // SHA-256(docHash|ledgerRoot|attachHash)
    "eventCount": N,
    "attachmentCount": N,
    "signedEventCount": N,
    "unsignedEventCount": N,
    "fileIntegrity": [ ... ]
  },
  "verification": {
    "instructions": "Download verify-evidence-pack.mjs and run: node verify-evidence-pack.mjs <this-file.json>",
    "checksToPerform": [ ... ]
  },
  "platformSignature": {
    "algorithm": "ECDSA-P256-SHA256",
    "signature": "base64...",
    "publicKey": "base64 SPKI DER...",
    "signedAt": "ISO-8601",
    "signedFields": "envelopeHash"
  },
  "notarization": null         // reserved for RFC 3161 TSA tokens
}
```

### Integrity Hash Hierarchy

```
envelopeHash = SHA-256(documentHash | ledgerRootHash | attachmentsHash)
     │
     ├── documentHash = SHA-256(canonical(document without documentHash field))
     │
     ├── ledgerRootHash = SHA-256(event1.eventHash | event2.eventHash | ...)
     │                    or SHA-256("EMPTY") if no events
     │
     └── attachmentsHash = SHA-256(file1.sha256Hash | file2.sha256Hash | ...)
                           or SHA-256("NONE") if no attachments
```

This hierarchy means:
- Changing any field in the PO document → `documentHash` changes → `envelopeHash` changes → platform signature breaks
- Changing any ledger event → `eventHash` changes → `ledgerRootHash` changes → `envelopeHash` changes
- Adding/removing/modifying any attachment → `attachmentsHash` changes → `envelopeHash` changes

### Actors Array

All participants are extracted from proof bundles and PO data, deduplicated by user ID. Each actor includes their registered passkey credentials (public keys) and an identity resolution URI.

### Approvals Array

Explicitly extracts passkey-signed events as "approvals" — making it easy for a bank to see which human approvals occurred:

```json
{
  "eventId": "proof-bundle-id",
  "eventType": "PO_ACCEPTED",
  "actorId": "user-uuid",
  "actorRole": "SUPPLIER",
  "method": "passkey",
  "credentialId": "base64url...",
  "intentHash": "base64url...",
  "signature": "base64url...",
  "timestamp": "ISO-8601"
}
```

---

## 8. Cryptographic Primitives

All cryptography is centralized in a single service behind the `ICryptoService` interface (DI token: `CRYPTO_SERVICE`). The current implementation is `NodeCryptoService` using Node.js `crypto` (C++ binding to OpenSSL).

### Interface

```typescript
interface ICryptoService {
  sha256Hex(input: string | Buffer): string;
  sha256Base64Url(input: string | Buffer): string;
  sha256Buffer(input: Buffer): Buffer;
  verifyEcdsaP256(signedData: Buffer, signature: Buffer, publicKey: Buffer): boolean;
  randomUUID(): string;
  signWithPlatformKey(data: string): { signature: string; publicKey: string };
  getPlatformPublicKey(): string;
}
```

### Canonical JSON Serialization

**File:** `backend/src/crypto/canonical-stringify.ts`

PostgreSQL's JSONB type does not preserve key order. When we store a payload and later read it back, the keys may be in a different order. If we hash the raw JSON string, the hash would differ. So we use **canonical serialization**:

```typescript
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const sorted = Object.keys(obj)
    .sort()
    .map(key => JSON.stringify(key) + ':' + canonicalStringify(obj[key]))
    .join(',');
  return '{' + sorted + '}';
}
```

Rules:
- Object keys are sorted lexicographically at every nesting level
- Array element order is preserved
- No whitespace
- Dates become ISO-8601 strings
- `null` and `undefined` serialize to `"null"`

This is used everywhere: hash chain computation, payload hashing, integrity hashing, and in the standalone verifier script.

### COSE Key Parsing

WebAuthn stores public keys in COSE format (CBOR-encoded). Node.js `crypto.createVerify()` expects SPKI DER. The `NodeCryptoService` includes a hand-written CBOR parser that:

1. Parses the COSE map to extract `x` and `y` coordinates (EC P-256)
2. Constructs the uncompressed EC point: `0x04 || x || y`
3. Wraps it in ASN.1 DER: `SEQUENCE { AlgorithmIdentifier(ecPublicKey, prime256v1), BIT STRING(point) }`

This allows us to verify WebAuthn signatures without any CBOR/COSE library dependency.

### DER Signature Encoding

WebAuthn produces signatures in IEEE P1363 format (`r || s`, 64 bytes for P-256). OpenSSL expects DER-encoded signatures. The `derEncodeSignature()` method converts between formats, handling leading-zero padding for negative-looking integers.

---

## 9. Platform Signing Key

The platform has its own ECDSA P-256 key pair used to seal Trust Envelopes.

### Key Management

- **Production:** Set `PLATFORM_SIGNING_KEY` env var to a base64-encoded PKCS8 DER private key
- **Development:** If the env var is not set, a key pair is auto-generated at startup (different each restart)

The public key is exported as SPKI DER (base64) and embedded in every Trust Envelope's `platformSignature` section.

### What Gets Signed

The `envelopeHash` (the top-level integrity seal) is signed:

```typescript
const signer = createSign('SHA256');
signer.update(envelopeHash);  // hex string of the envelope hash
const signature = signer.sign({ key: privateKey, format: 'der', type: 'pkcs8' });
```

### Verification

Any party with the platform's public key can verify:

```typescript
const verifier = createVerify('SHA256');
verifier.update(envelopeHash);
const valid = verifier.verify({ key: publicKeyBuf, format: 'der', type: 'spki' }, signatureBuf);
```

The public key is embedded in the envelope itself, so the pack is self-verifying. For stronger assurance, the public key could be pinned or distributed via a separate trust channel.

---

## 10. Verification Pipeline

### Three Layers of Verification

| Layer | What | How |
|-------|------|-----|
| **Per-event** | Individual proof bundle | `POST /api/proofs/verify` (stateless, no auth) |
| **Per-entity chain** | Hash chain for one PO | `GET /api/ledger/verify/:entityId` |
| **Full envelope** | All 14 checks on the Trust Envelope | `POST /api/verify` (no auth) or `verify-evidence-pack.mjs` CLI |

### Full Envelope Verification (14 Sections)

The `VerifyService` (and the equivalent CLI script) runs these checks:

| # | Section | What it verifies |
|---|---------|-----------------|
| 0 | Pack Structure & Version | Metadata fields, schema version, section presence |
| 1 | Hash Chain Integrity | Recompute every `eventHash` from its inputs |
| 2 | Entity Chain Continuity | Each event's `previousHash` = prior event's `eventHash` |
| 3 | Payload Hash Verification | `SHA-256(canonical(payload))` matches stored `payloadHash` |
| 4 | Intent Hash Verification | `SHA-256(eventType\|entityId\|actorId)` matches `intentHash` |
| 5 | WebAuthn Challenge Binding | `clientDataJSON.challenge` matches `intentHash` |
| 6 | ECDSA P-256 Signature | Verify signature over `authenticatorData \|\| SHA-256(clientDataJSON)` |
| 7 | Integrity Root Hashes | `documentHash`, `ledgerRootHash`, `attachmentsHash`, `envelopeHash` |
| 8 | Actors & Approvals | Cross-reference signers ↔ actors, approval ↔ proof bundles |
| 9 | Cross-Consistency | PO amount = accepted payload amount, buyer ≠ supplier, status match |
| 10 | Credential Uniqueness | Each credential bound to exactly one user |
| 11 | Timestamp Ordering | Events in chronological order |
| 12 | External URIs | Registry/identity URIs are present (warn if localhost) |
| 13 | Platform Signature | Verify ECDSA signature over `envelopeHash` |

### Report Format

```json
{
  "version": "2.0",
  "generatedAt": "ISO-8601",
  "envelopeId": "tenv_...",
  "verdict": "PASSED" | "PASSED_WITH_WARNINGS" | "FAILED",
  "totalPass": 19,
  "totalFail": 0,
  "totalWarn": 0,
  "sections": [
    {
      "title": "Hash Chain Integrity",
      "results": [
        { "status": "pass", "message": "[seq 1] PO_CREATED — hash verified" },
        { "status": "pass", "message": "[seq 2] PO_ACCEPTED — hash verified" }
      ]
    }
  ]
}
```

---

## 11. Web Verification Service

### Backend Endpoint

```
POST /api/verify
Content-Type: application/json
Body: <Trust Envelope JSON>
Response: VerifyReport (see above)
```

- **No authentication required** — this is a public service
- Accepts arbitrary JSON (validation pipe bypassed)
- Body size limit: 5 MB (evidence packs can be large)
- Uses the same `ICryptoService` as the rest of the platform

### Frontend Page

**URL:** `/verify` (standalone, outside the dashboard layout — no login required)

Features:
- Drag-and-drop file upload for `.json` files
- Sends file contents to `POST /api/verify`
- Displays verdict banner (green/yellow/red)
- Per-section result cards with pass/fail/warn/info icons
- "Verify Another Pack" reset button

Also accessible from the LP dashboard sidebar ("Verify Evidence" link).

### CLI Verifier

**File:** `scripts/verify-evidence-pack.mjs`

A standalone, zero-dependency Node.js script (~1200 lines) that performs the same 14 checks. It includes its own:
- `canonicalStringify()` implementation
- `sha256Hex()` / `sha256Base64Url()` / `sha256Buffer()`
- COSE→SPKI key parser
- DER signature encoder
- ECDSA P-256 verification

Usage:
```bash
node scripts/verify-evidence-pack.mjs evidence-pack.json
```

---

## 12. Database Schema

### `event_log` Table

```sql
CREATE TABLE event_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence         SERIAL,
  entity_sequence  INTEGER NOT NULL,
  entity_type      VARCHAR NOT NULL,
  entity_id        UUID NOT NULL,
  event_type       VARCHAR NOT NULL,
  actor_id         UUID NOT NULL REFERENCES users(id),
  actor_role       VARCHAR NOT NULL,
  payload          JSONB NOT NULL,
  timestamp        TIMESTAMP DEFAULT NOW(),
  actor_signature  VARCHAR NOT NULL,       -- ECDSA sig or "SYSTEM"
  authenticator_data VARCHAR,              -- WebAuthn authData (base64)
  actor_public_key VARCHAR NOT NULL,       -- COSE key or "SYSTEM"
  credential_id    VARCHAR,                -- WebAuthn credential ID
  intent_hash      VARCHAR,                -- SHA-256(intent) base64url
  client_data_json TEXT,                   -- Raw clientDataJSON
  previous_hash    VARCHAR NOT NULL,       -- Link to prior event
  event_hash       VARCHAR NOT NULL UNIQUE,-- This event's hash
  created_at       TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX ON event_log(entity_id, entity_sequence);
CREATE INDEX ON event_log(entity_id, entity_sequence);
CREATE INDEX ON event_log(sequence);
CREATE INDEX ON event_log(actor_id);
CREATE INDEX ON event_log(entity_type, event_type);
```

### `evidence_attachments` Table

```sql
CREATE TABLE evidence_attachments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  uploader_id       UUID NOT NULL REFERENCES users(id),
  type              evidence_type NOT NULL,
  filename          VARCHAR NOT NULL,
  mime_type         VARCHAR NOT NULL,
  size_bytes        INTEGER NOT NULL,
  storage_path      VARCHAR NOT NULL,
  sha256_hash       VARCHAR NOT NULL,
  event_log_id      UUID,
  description       TEXT,
  metadata          JSONB,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON evidence_attachments(purchase_order_id);
CREATE INDEX ON evidence_attachments(sha256_hash);
```

---

## 13. Module Dependency Graph

```
AppModule
 ├── CryptoModule (global — provides CRYPTO_SERVICE to all modules)
 ├── LedgerModule
 │    ├── LedgerService (uses: PrismaService, ICryptoService)
 │    ├── LedgerController
 │    └── imports: PasskeysModule
 ├── ProofsModule
 │    ├── ProofGeneratorService (uses: PrismaService, ICryptoService, ConfigService)
 │    ├── ProofVerifierService (uses: ICryptoService)
 │    └── ProofsController
 ├── EvidenceModule
 │    ├── EvidenceService (uses: PrismaService, LedgerService, ProofGeneratorService, ICryptoService, ConfigService)
 │    ├── EvidenceController
 │    └── imports: LedgerModule, ProofsModule, MulterModule
 └── VerifyModule
      ├── VerifyService (uses: ICryptoService)
      └── VerifyController
```

Key design decisions:
- `CryptoModule` is `@Global()` — no need to import it anywhere; `CRYPTO_SERVICE` is available platform-wide
- `LedgerModule` exports `LedgerService` so `EvidenceModule` can call `logEvent()`
- `ProofsModule` exports both `ProofGeneratorService` and `ProofVerifierService`
- `VerifyModule` has no imports beyond the global `CryptoModule` — it's fully stateless

---

## 14. API Reference

### Ledger Endpoints (all require JWT auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ledger` | List events (optional `?entityId=`) |
| `GET` | `/api/ledger/verify` | Verify entire global hash chain |
| `GET` | `/api/ledger/verify/:entityId` | Verify chain for one entity |
| `GET` | `/api/ledger/proof/:eventId` | Get proof bundle for one event |
| `POST` | `/api/ledger/challenge` | Request WebAuthn challenge for signing |
| `POST` | `/api/ledger/events` | Submit passkey-signed event |

### Evidence Endpoints (all require JWT auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/evidence/upload` | Upload evidence file (multipart) |
| `GET` | `/api/evidence/po/:poId` | List attachments for a PO |
| `GET` | `/api/evidence/:id/download` | Download attachment file |
| `GET` | `/api/evidence/:id/verify` | Verify file integrity (hash check) |
| `GET` | `/api/evidence/po/:poId/pack` | Generate Trust Envelope |

### Proofs Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/proofs/event/:eventId` | JWT | Generate proof bundle |
| `GET` | `/api/proofs/entity/:entityId` | JWT | Generate all proof bundles for entity |
| `POST` | `/api/proofs/verify` | None | Verify a proof bundle (with registry lookup) |
| `POST` | `/api/proofs/verify/offline` | None | Verify a proof bundle (offline) |
| `GET` | `/api/proofs/registry/credentials/:id` | None | Lookup credential public key |
| `GET` | `/api/proofs/identity/signers/:userId` | None | Lookup signer identity |

### Verification Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/verify` | None | Verify a Trust Envelope (14 checks) |
| `GET` | `/api/verify/health` | None | Health check |

---

## 15. Security Considerations

### What We Protect Against

| Threat | Mitigation |
|--------|------------|
| **Event tampering** | SHA-256 hash chain — changing any event breaks all subsequent hashes |
| **Event deletion** | Global chain linkage + `envelopeHash` integrity seal |
| **Event reordering** | Per-entity sequence + timestamp ordering checks |
| **Payload modification** | `payloadHash` per event + `documentHash` in integrity section |
| **Forged approvals** | ECDSA P-256 signatures verified against embedded public keys |
| **Action repudiation** | Intent hash binds biometric signature to exact business action |
| **Envelope tampering** | Platform ECDSA signature over `envelopeHash` |
| **Credential misuse** | Credential uniqueness check (each credential → one user) |
| **File tampering** | SHA-256 hash per attachment, verified at download time |

### What We Do NOT Protect Against (Yet)

| Gap | Description |
|-----|-------------|
| **Platform compromise** | If the platform database is fully controlled by an attacker, they could recompute the entire hash chain. The platform signature uses a key the platform controls- no external TSA. |
| **Key rotation** | No key rotation mechanism for the platform signing key |
| **Certificate pinning** | Platform public key is self-attested in the envelope; no PKI chain |
| **RFC 3161 timestamps** | No external Time Stamping Authority integration |
| **Selective disclosure** | Cannot redact fields while preserving integrity (no Merkle tree) |

---

## 16. What We Don't Do Yet (Future Work)

1. **RFC 3161 Notarization** — Add external TSA timestamping to prove the envelope existed at a specific time, independent of our platform.

2. **Merkle Tree for Ledger** — Replace `ledgerRootHash = SHA-256(h1|h2|...)` with a proper Merkle tree for efficient subset proofs.

3. **Key Rotation & Versioning** — Platform signing key rotation with key ID in the envelope, so old envelopes remain verifiable.

4. **PKI / Certificate Chain** — Have the platform key signed by a CA so verifiers don't have to trust the self-attested public key.

5. **Content-Addressed Attachments** — Move from local file storage to content-addressed storage (e.g., IPFS CIDs) for distributed verification.

6. **Webhook / ERP Integration** — Push evidence packs to external systems on finalization.

7. **Selective Disclosure** — Allow redacting sensitive fields (e.g., line item details) while preserving envelope integrity via Merkle proofs.

---

## Appendix: Example Live Verification Output

```
$ curl -s localhost:3001/api/evidence/po/<poId>/pack | \
  curl -s -X POST localhost:3001/api/verify -H "Content-Type: application/json" -d @-

Verdict: PASSED  Pass:19 Fail:0 Warn:0
```

Sections verified:
- Pack Structure & Version (7 pass)
- Hash Chain Integrity (2 pass — PO_CREATED, PO_ACCEPTED)
- Entity Chain Continuity (1 pass — linked)
- Payload Hash Verification (2 pass)
- Intent Hash Verification (info only — 0 signed, 2 system in demo seed)
- Integrity Root Hashes (5 pass — docHash, ledgerRoot, attachmentsHash, envelopeHash, eventCount)
- Actors & Approvals (3 pass — actors, signer cross-refs)
- Cross-Consistency (2 pass — amount match, buyer≠supplier)
- Timestamp Ordering (1 pass — chronological)
- Platform Signature (1 pass — VALID)
