# Cryptographic Verification & Immutable Ledger — Technical Design

## The Problem

A liquidity partner is about to advance £19,500 against a purchase order. They need to **know**, not just **trust**, that:

1. The buyer **really** created this PO (not fabricated by the supplier)
2. The buyer **really** locked £20,000 (not just a database flag someone set)
3. The supplier **really** accepted these exact conditions
4. None of these records have been altered since they were created
5. No events have been removed or inserted into the history

If the platform just stores rows in a database, an insider (or attacker) could modify records. The LP has no independent way to verify anything — they're trusting the platform entirely.

**The goal: make the platform's honesty mathematically verifiable, not just promised.**

---

## The Three Pillars

### Pillar 1: Passkey-Signed Events (Who did what — and provably so)

Every actor on the platform has a **passkey** (WebAuthn/FIDO2 credential):

- **Private key** — lives inside the user's device hardware (Secure Enclave on Apple, TPM on Windows/Android). It **never leaves the device**. The platform never sees it.
- **Public key** — registered on the platform during passkey creation, visible to all parties.

When a user performs a significant action (creates a PO, locks payment, accepts an order), the platform sends a **signing challenge** to the user's browser. The browser triggers a biometric prompt (Face ID, Touch ID, fingerprint, PIN). The device's hardware authenticator signs the challenge payload. The signature is returned to the platform and stored in the event log.

Anyone with the public key can verify: *"Yes, this specific user really performed this action with this exact data — and the platform couldn't have faked it even if it wanted to."*

#### Technology: WebAuthn / FIDO2 Passkeys

- **W3C standard** for hardware-bound authentication and signing
- Supported natively by all modern browsers (Chrome, Safari, Firefox, Edge)
- Private key stored in hardware security module (Secure Enclave / TPM / YubiKey)
- Crypto under the hood: **ECDSA P-256** (most common) or **Ed25519** (some authenticators)
- User authenticates with **biometrics** — no passwords, no key files
- Synced passkeys available via iCloud Keychain / Google Password Manager for multi-device
- Libraries: `@simplewebauthn/browser` (frontend) + `@simplewebauthn/server` (NestJS backend)

#### Why passkeys instead of server-managed Ed25519?

| Aspect | Server-managed Ed25519 | Passkeys (WebAuthn) |
|--------|----------------------|---------------------|
| Private key location | Encrypted in platform DB | **User's device hardware — never extractable** |
| Can platform forge signatures? | Yes — it holds the keys | **No — it never sees the private key** |
| Signing trigger | Invisible API call | **Biometric prompt** (fingerprint / face) |
| Non-repudiation | Weak (platform could have signed) | **Strong** (hardware-bound, biometric-gated) |
| Key management burden | Must encrypt, store, rotate, backup | **Zero** — device handles everything |
| UX | Password-based | Tap fingerprint / glance at camera |
| Standards compliance | Custom implementation | **W3C standard, FIDO Alliance certified** |

The previous design acknowledged: *"For the MVP, signing happens server-side (the backend signs on behalf of the user) — trust the platform to sign honestly."* Passkeys eliminate that compromise entirely, even in the MVP.

#### What gets signed

The platform constructs a **WebAuthn assertion challenge** containing the canonical event data:

```
// 1. Platform builds the canonical payload
canonical_payload = {
  event_type: "PAYMENT_LOCKED",
  entity_id: "po_abc123",
  actor_id: "user_xyz",
  data: {
    amount: 2000000,          // pennies
    currency: "GBP",
    open_banking_ref: "ob_sim_789"
  },
  timestamp: "2026-02-25T14:30:00.000Z"
}

// 2. Platform sends challenge to browser
challenge = SHA-256(canonicalize(canonical_payload))

// 3. Browser calls WebAuthn API → triggers biometric
assertion = await navigator.credentials.get({
  publicKey: {
    challenge: challenge,
    allowCredentials: [{ id: userCredentialId, type: "public-key" }],
    userVerification: "required"   // biometric MUST succeed
  }
})

// 4. Device hardware signs the challenge
//    Private key never leaves the Secure Enclave / TPM
//    Signature returned to browser → sent to platform

// 5. Platform stores in event log:
//    - assertion.signature (ECDSA P-256 signature)
//    - assertion.authenticatorData (device metadata)
//    - The registered public key for verification
```

#### Why this matters

The LP doesn't have to trust the platform's database **or the platform itself**. They can take the event, the WebAuthn signature, and the buyer's registered public key, and **independently verify** that:

1. The buyer's **physical device** produced this signature (hardware-bound)
2. The buyer **biometrically authenticated** to authorise it (user-verified)
3. The signature covers **this exact payload** (no substitution possible)
4. The platform **could not have forged this** (private key is in hardware, not the DB)

This is the difference between *"the platform says the buyer locked payment"* and *"the buyer's device cryptographically proves they locked payment."*

#### System events (no biometric)

Some events are generated by the platform itself (e.g., `PAYMENT_LOCK_CONFIRMED` from Open Banking, `DELIVERY_AUTO_VERIFIED` after window expiry, `SETTLEMENT_COMPLETED`). These are signed with the **platform's own ECDSA P-256 key pair**, stored securely server-side. This is clearly labelled as `actor_role: "SYSTEM"` in the event log — the LP knows these are platform-attested, not user-attested.

---

### Pillar 2: Hash Chain (Nothing was tampered with)

Every event includes the **hash of the previous event**, forming a chain. This is the same principle as Git commits or blockchain blocks — but without the distributed consensus overhead.

#### How it works

```
Event 1: PO_CREATED
  event_hash = SHA-256(sequence + entity_id + event_type + payload + timestamp + signature + "GENESIS")
  previous_hash = "GENESIS"

Event 2: PAYMENT_LOCKED
  event_hash = SHA-256(sequence + entity_id + event_type + payload + timestamp + signature + event_1_hash)
  previous_hash = event_1_hash

Event 3: PO_ACCEPTED
  event_hash = SHA-256(sequence + entity_id + event_type + payload + timestamp + signature + event_2_hash)
  previous_hash = event_2_hash

Event 4: EARLY_PAYMENT_REQUESTED
  event_hash = SHA-256(sequence + entity_id + event_type + payload + timestamp + signature + event_3_hash)
  previous_hash = event_3_hash
```

#### What this guarantees

- **Insert an event?** → All subsequent hashes break.
- **Remove an event?** → The chain has a gap; next event's `previous_hash` doesn't match.
- **Modify an event?** → That event's hash changes → all subsequent hashes break.
- **Reorder events?** → Sequence numbers embedded in hashes catch this.

The LP can replay the entire chain and verify every link. If even one byte was changed anywhere in history, verification fails.

---

### Pillar 3: Append-Only Event Store (Immutable Ledger)

The database is structured so events can **only be added, never updated or deleted**. This is enforced at multiple levels.

#### Level 1: Application-level enforcement

The NestJS service has no update/delete methods for events. The event repository exposes only:

```typescript
interface EventStore {
  append(event: PlatformEvent): Promise<void>;
  getChain(entityId: string): Promise<PlatformEvent[]>;
  verify(entityId: string): Promise<VerificationResult>;
  // No update(). No delete(). These methods don't exist.
}
```

#### Level 2: Database-level enforcement

The PostgreSQL application user has **restricted permissions**:

```sql
-- Application role can only INSERT and SELECT
GRANT INSERT, SELECT ON event_log TO app_user;
-- No UPDATE, no DELETE, no TRUNCATE

-- Additional safety: row-level trigger rejects any UPDATE attempt
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Event log is append-only. Mutations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_append_only
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_event_mutation();
```

#### Level 3: Hash chain integrity trigger

A database trigger validates the hash chain on every INSERT:

```sql
CREATE OR REPLACE FUNCTION validate_event_chain()
RETURNS TRIGGER AS $$
DECLARE
  last_event RECORD;
BEGIN
  -- Get the most recent event for this entity
  SELECT event_hash INTO last_event
  FROM event_log
  WHERE entity_id = NEW.entity_id
  ORDER BY sequence DESC
  LIMIT 1;

  -- Verify previous_hash matches
  IF last_event IS NOT NULL AND NEW.previous_hash != last_event.event_hash THEN
    RAISE EXCEPTION 'Hash chain violation: previous_hash does not match last event';
  END IF;

  IF last_event IS NULL AND NEW.previous_hash != 'GENESIS' THEN
    RAISE EXCEPTION 'First event must reference GENESIS';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_chain_on_insert
  BEFORE INSERT ON event_log
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_chain();
```

---

## The Event Log Schema

```sql
CREATE TABLE event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ordering
  sequence        BIGSERIAL NOT NULL,                  -- Global monotonic sequence
  entity_sequence INTEGER NOT NULL,                     -- Per-entity sequence (1, 2, 3...)
  
  -- What happened
  entity_type     VARCHAR(50) NOT NULL,                 -- PURCHASE_ORDER, PAYMENT_LOCK, EARLY_PAYMENT...
  entity_id       UUID NOT NULL,                        -- The PO, lock, or request ID
  event_type      VARCHAR(100) NOT NULL,                -- PO_CREATED, PAYMENT_LOCKED, DELIVERY_VERIFIED...
  
  -- Who did it
  actor_id        UUID NOT NULL REFERENCES users(id),
  actor_role      VARCHAR(30) NOT NULL,                 -- BUYER, SUPPLIER, LIQUIDITY_PARTNER, SYSTEM
  
  -- Event data
  payload         JSONB NOT NULL,                       -- Full event data (amount, conditions, etc.)
  
  -- Timing
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Cryptographic integrity
  actor_signature TEXT NOT NULL,                         -- WebAuthn assertion signature (ECDSA P-256) or system ECDSA signature
  authenticator_data TEXT,                               -- WebAuthn authenticator data (NULL for SYSTEM events)
  actor_public_key TEXT NOT NULL,                        -- Actor's registered passkey public key (or system public key)
  credential_id   TEXT,                                  -- WebAuthn credential ID (NULL for SYSTEM events)
  previous_hash   VARCHAR(64) NOT NULL,                 -- SHA-256 hash of previous event (or "GENESIS")
  event_hash      VARCHAR(64) NOT NULL,                 -- SHA-256 hash of this event's canonical form
  
  -- Constraints
  UNIQUE(entity_id, entity_sequence),                   -- No duplicate sequences per entity
  UNIQUE(event_hash)                                    -- No duplicate hashes
);

-- Indexes for fast chain retrieval
CREATE INDEX idx_event_log_entity ON event_log(entity_id, entity_sequence);
CREATE INDEX idx_event_log_sequence ON event_log(sequence);
CREATE INDEX idx_event_log_actor ON event_log(actor_id);
CREATE INDEX idx_event_log_type ON event_log(entity_type, event_type);
```

---

## Event Types (Complete Lifecycle)

```
PO_CREATED              — Buyer creates PO (signed by buyer)
PO_SENT                 — Buyer sends to supplier (signed by buyer)
PAYMENT_LOCK_INITIATED  — Buyer initiates fund lock (signed by buyer)
PAYMENT_LOCK_CONFIRMED  — Open Banking confirms lock (signed by system)
PO_ACCEPTED             — Supplier accepts (signed by supplier)
EARLY_PAY_REQUESTED     — Supplier requests early payment (signed by supplier)
EARLY_PAY_APPROVED      — LP approves and funds (signed by LP)
EARLY_PAY_REJECTED      — LP rejects (signed by LP)
DELIVERY_MARKED         — Supplier marks delivered (signed by supplier)
DELIVERY_VERIFIED       — Buyer confirms delivery (signed by buyer)
DELIVERY_AUTO_VERIFIED  — System auto-accepts after window (signed by system)
DELIVERY_DISPUTED       — Buyer disputes (signed by buyer)
SETTLEMENT_INITIATED    — System begins settlement (signed by system)
SETTLEMENT_COMPLETED    — Funds transferred (signed by system)
PO_CANCELLED            — PO cancelled (signed by cancelling party)
PAYMENT_LOCK_RELEASED   — Funds unlocked (signed by system)
PAYMENT_LOCK_REFUNDED   — Funds returned to buyer (signed by system)
```

---

## What the Liquidity Partner Actually Sees

When an LP is evaluating an early payment request, the platform provides a **Verification Bundle**:

```json
{
  "verification_bundle": {
    "purchase_order_id": "po_abc123",
    "generated_at": "2026-02-25T15:00:00Z",
    
    "event_chain": [
      {
        "entity_sequence": 1,
        "event_type": "PO_CREATED",
        "actor_role": "BUYER",
        "payload": {
          "supplier_id": "user_def456",
          "amount": 2000000,
          "currency": "GBP",
          "description": "Warehouse logistics support",
          "conditions": { "acceptance_type": "BUYER_CONFIRMATION", "window_hours": 48 }
        },
        "timestamp": "2026-02-24T09:00:00Z",
        "actor_signature": "base64...",
        "actor_public_key": "base64...",
        "previous_hash": "GENESIS",
        "event_hash": "a1b2c3..."
      },
      {
        "entity_sequence": 2,
        "event_type": "PAYMENT_LOCK_CONFIRMED",
        "actor_role": "SYSTEM",
        "payload": {
          "amount": 2000000,
          "open_banking_ref": "ob_sim_789",
          "bank_name": "Simulated UK Bank"
        },
        "timestamp": "2026-02-24T09:05:00Z",
        "actor_signature": "base64...",
        "actor_public_key": "base64...",
        "previous_hash": "a1b2c3...",
        "event_hash": "d4e5f6..."
      },
      {
        "entity_sequence": 3,
        "event_type": "PO_ACCEPTED",
        "actor_role": "SUPPLIER",
        "payload": { "accepted_conditions": true },
        "timestamp": "2026-02-24T10:30:00Z",
        "actor_signature": "base64...",
        "actor_public_key": "base64...",
        "previous_hash": "d4e5f6...",
        "event_hash": "g7h8i9..."
      }
    ],

    "actors": {
      "buyer": { "id": "user_xyz", "public_key": "base64...", "company": "Acme Retail Ltd" },
      "supplier": { "id": "user_def456", "public_key": "base64...", "company": "Swift Logistics Ltd" },
      "system": { "public_key": "base64..." }
    },

    "chain_integrity": {
      "total_events": 3,
      "all_signatures_valid": true,
      "all_hashes_chained": true,
      "no_gaps": true,
      "chain_root_hash": "a1b2c3...",
      "chain_head_hash": "g7h8i9..."
    },

    "risk_summary": {
      "payment_locked": true,
      "payment_amount": 2000000,
      "supplier_accepted": true,
      "conditions_explicit": true,
      "time_since_lock": "6 hours",
      "acceptance_window": "48 hours"
    }
  }
}
```

The LP can:
1. **Independently verify every signature** using the public keys
2. **Replay the hash chain** to confirm no tampering
3. **See that the buyer really locked payment** (not just a database flag)
4. **See that the supplier accepted these exact conditions**
5. **Make a risk decision** based on cryptographic proof, not trust

---

## Key Generation & Management

### User Passkeys

```
On registration:
  1. User creates account (email + basic info)
  2. Platform calls navigator.credentials.create() → browser prompts passkey creation
  3. User authenticates with biometric (Face ID / Touch ID / fingerprint)
  4. Device generates ECDSA P-256 key pair inside hardware (Secure Enclave / TPM)
  5. Public key + credential ID sent to platform → stored in user_passkeys table
  6. Private key NEVER leaves the device — platform never sees it

On signing an event:
  1. Platform builds canonical payload for the action
  2. Platform sends SHA-256(payload) as WebAuthn challenge to browser
  3. Browser calls navigator.credentials.get() → biometric prompt
  4. User authenticates (fingerprint / face / PIN)
  5. Device hardware signs the challenge with the private key
  6. Signature + authenticator data returned to platform
  7. Platform verifies signature against stored public key
  8. Platform stores signature + authenticator data in event log
```

### User Passkey Table

```sql
CREATE TABLE user_passkeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  credential_id   TEXT NOT NULL UNIQUE,                 -- WebAuthn credential ID (base64url)
  public_key      TEXT NOT NULL,                        -- ECDSA P-256 public key (COSE format, base64)
  sign_count      INTEGER NOT NULL DEFAULT 0,           -- Authenticator sign counter (replay protection)
  device_type     VARCHAR(50),                          -- 'singleDevice' or 'multiDevice' (synced passkey)
  backed_up       BOOLEAN NOT NULL DEFAULT false,       -- Whether passkey is synced (iCloud/Google)
  transports      TEXT[],                               -- ['internal', 'hybrid', 'usb', 'ble', 'nfc']
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_passkeys_user ON user_passkeys(user_id);
CREATE INDEX idx_passkeys_credential ON user_passkeys(credential_id);
```

### System Key Pair

The platform itself has an **ECDSA P-256 key pair** for system-generated events (e.g., `PAYMENT_LOCK_CONFIRMED`, `DELIVERY_AUTO_VERIFIED`, `SETTLEMENT_COMPLETED`). This is stored securely server-side (environment variable or secrets manager) and used by the NestJS backend. System events are clearly labelled `actor_role: "SYSTEM"` — the LP knows these are platform-attested, not user-attested.

### No MVP Compromise Needed

Unlike server-managed Ed25519 keys (where the MVP would require the platform to hold and sign with users' private keys), passkeys work with **full cryptographic integrity from day one**:

- ✅ Private keys are hardware-bound — even in the MVP
- ✅ Signing requires biometric — even in the MVP
- ✅ Platform cannot forge signatures — even in the MVP
- ✅ All modern browsers support WebAuthn — no extra installs
- ✅ No key management code to write — the device handles it

This means the MVP demo has the **same trust model as production**. There is no "trust the platform for now" compromise.

---

## How This Differs From "Just a Database"

| Aspect | Traditional DB | Our Append-Only Ledger |
|--------|----------------|----------------------|
| Can records be edited? | Yes — UPDATE/DELETE | No — INSERT only, enforced at DB level |
| Can you prove who did what? | Logs say so (trust the platform) | Cryptographic signatures (mathematically provable) |
| Can you detect tampering? | Only if you have backups to compare | Hash chain breaks immediately |
| Can you verify a single record? | No — you trust the whole system | Yes — any single event is independently verifiable |
| Can an insider manipulate history? | Yes — with DB access | No — would need physical access to every actor's device hardware |
| What does the LP trust? | The platform's word | Math + hardware attestation |

---

## How This Differs From Blockchain

| Aspect | Blockchain | Our Approach |
|--------|-----------|-------------|
| Consensus | Distributed (PoW/PoS) | Centralised (platform is the authority) |
| Performance | Slow (seconds to minutes) | Instant (DB insert) |
| Cost | Gas fees / infrastructure | Standard PostgreSQL |
| Complexity | Smart contracts, nodes, wallets | Standard Node.js + SQL |
| Tamper evidence | Same (hash chain) | Same (hash chain) |
| Digital signatures | Same (Ed25519/ECDSA) | Same (ECDSA P-256 via WebAuthn passkeys) |
| Sufficient for MVP? | Overkill | ✅ Yes |
| Sufficient for production? | Possible but heavy | Yes — with optional external anchoring |

> We get **blockchain-grade tamper evidence** without blockchain overhead.

---

## Optional: External Anchoring (Post-MVP)

For additional assurance beyond the platform's own ledger, you can periodically **anchor** a summary hash to an external source:

### Option A: RFC 3161 Timestamping
- Every hour, compute a Merkle root of all new events
- Submit to a trusted timestamping authority (e.g., DigiCert, FreeTSA)
- Receive a signed timestamp proof
- Proves: "This data existed at this time and hasn't changed"

### Option B: Public Blockchain Anchoring
- Publish Merkle root to Ethereum/Bitcoin (one transaction, minimal cost)
- Proves: "This data existed before block N"
- Used by: Chainpoint, OpenTimestamps

### Option C: Multi-Party Replication
- LP receives and stores their own copy of event chains
- If platform data and LP data diverge → tamper detected
- No blockchain needed

For the challenge MVP, none of these are needed. The internal hash chain + signatures are sufficient to demonstrate the principle.

---

## Implementation in the NestJS Backend

### Module Structure

```
src/
  ledger/
    ledger.module.ts          — Module registration
    ledger.service.ts         — Core append + verify logic
    ledger.controller.ts      — Verification bundle endpoint + signing challenge endpoints
    crypto.service.ts         — WebAuthn verification, SHA-256 hashing, system key signing
    hash-chain.service.ts     — Chain construction and validation
    event-types.ts            — Event type constants and payload schemas
    dto/
      verification-bundle.dto.ts
      append-event.dto.ts
      signing-challenge.dto.ts
  passkeys/
    passkeys.module.ts        — Module registration
    passkeys.service.ts       — Passkey registration + assertion handling (@simplewebauthn/server)
    passkeys.controller.ts    — WebAuthn registration + authentication endpoints
    dto/
      register-passkey.dto.ts
      verify-assertion.dto.ts
```

### Signing Flow (Two-Step)

Unlike server-managed keys where signing is a single backend call, passkey signing is a **two-step client-server flow**:

```
Step 1: Frontend requests a signing challenge from backend
  POST /ledger/challenge
  Body: { entityId, eventType, payload }
  Response: { challengeId, challenge (base64url), options (WebAuthn PublicKeyCredentialRequestOptions) }

Step 2: Frontend triggers biometric + sends assertion back
  POST /ledger/events
  Body: { challengeId, assertion (WebAuthn AuthenticatorAssertionResponse) }
  Backend: verifies assertion → appends to ledger → returns event
```

### Frontend Integration

```typescript
// In the Next.js frontend — e.g., when buyer clicks "Lock Payment"
import { startAuthentication } from '@simplewebauthn/browser';

async function signAndLockPayment(purchaseOrderId: string, amount: number) {
  // 1. Request signing challenge from backend
  const { challengeId, options } = await api.post('/ledger/challenge', {
    entityId: purchaseOrderId,
    eventType: 'PAYMENT_LOCK_INITIATED',
    payload: { amount, currency: 'GBP' },
  });

  // 2. Trigger passkey signing (biometric prompt appears)
  //    User touches fingerprint sensor or looks at Face ID
  //    Device hardware signs the challenge — private key never leaves device
  const assertion = await startAuthentication(options);

  // 3. Send signed assertion to backend
  const event = await api.post('/ledger/events', {
    challengeId,
    assertion,
  });

  return event; // Signed, hashed, chained, immutable
}
```

### Core Service (Pseudocode)

```typescript
class LedgerService {
  // Step 1: Generate a signing challenge
  async createChallenge(params: {
    entityId: string;
    eventType: string;
    actorId: string;
    actorRole: string;
    payload: Record<string, unknown>;
  }): Promise<SigningChallenge> {
    const timestamp = new Date().toISOString();
    const canonicalData = canonicalize({
      event_type: params.eventType,
      entity_id: params.entityId,
      actor_id: params.actorId,
      payload: params.payload,
      timestamp,
    });

    // Challenge = hash of canonical payload (this is what the device signs)
    const challenge = this.cryptoService.hash(canonicalData);

    // Store challenge temporarily (5 min TTL) so we can match it on return
    const challengeId = uuid();
    await this.challengeStore.set(challengeId, {
      challenge,
      canonicalData,
      timestamp,
      ...params,
    }, { ttl: 300 });

    // Build WebAuthn request options
    const userPasskeys = await this.passkeysService.getUserPasskeys(params.actorId);
    const options = generateAuthenticationOptions({
      challenge,
      allowCredentials: userPasskeys.map(pk => ({
        id: pk.credentialId,
        type: 'public-key',
        transports: pk.transports,
      })),
      userVerification: 'required', // biometric MUST succeed
    });

    return { challengeId, options };
  }

  // Step 2: Verify assertion and append event
  async appendSignedEvent(params: {
    challengeId: string;
    assertion: AuthenticatorAssertionResponse;
  }): Promise<EventLogEntry> {
    // 1. Retrieve the stored challenge
    const stored = await this.challengeStore.get(params.challengeId);
    if (!stored) throw new Error('Challenge expired or invalid');

    // 2. Get the passkey used for signing
    const passkey = await this.passkeysService.getByCredentialId(
      params.assertion.id
    );

    // 3. Verify the WebAuthn assertion (signature + authenticator data)
    const verification = await verifyAuthenticationResponse({
      response: params.assertion,
      expectedChallenge: stored.challenge,
      expectedOrigin: this.config.rpOrigin,
      expectedRPID: this.config.rpId,
      authenticator: {
        credentialPublicKey: passkey.publicKey,
        credentialID: passkey.credentialId,
        counter: passkey.signCount,
      },
    });

    if (!verification.verified) {
      throw new Error('Passkey signature verification failed');
    }

    // 4. Update sign counter (replay protection)
    await this.passkeysService.updateCounter(
      passkey.credentialId,
      verification.authenticationInfo.newCounter
    );

    // 5. Build hash chain link
    const lastEvent = await this.getLastEvent(stored.entityId);
    const previousHash = lastEvent?.eventHash ?? 'GENESIS';
    const entitySequence = (lastEvent?.entitySequence ?? 0) + 1;

    const eventHash = this.cryptoService.hash(
      `${entitySequence}|${stored.entityId}|${stored.eventType}|${stored.actorId}|${stored.canonicalData}|${stored.timestamp}|${params.assertion.signature}|${previousHash}`
    );

    // 6. Append (INSERT only — DB triggers enforce chain integrity)
    return this.eventLogRepository.insert({
      entityType: stored.entityType,
      entityId: stored.entityId,
      entitySequence,
      eventType: stored.eventType,
      actorId: stored.actorId,
      actorRole: stored.actorRole,
      payload: stored.payload,
      timestamp: stored.timestamp,
      actorSignature: base64url(params.assertion.signature),
      authenticatorData: base64url(params.assertion.authenticatorData),
      actorPublicKey: passkey.publicKey,
      credentialId: passkey.credentialId,
      previousHash,
      eventHash,
    });
  }

  // System events (no biometric — platform's own key)
  async appendSystemEvent(params: {
    entityType: string;
    entityId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<EventLogEntry> {
    const timestamp = new Date().toISOString();
    const canonicalData = canonicalize({
      event_type: params.eventType,
      entity_id: params.entityId,
      actor_id: 'SYSTEM',
      payload: params.payload,
      timestamp,
    });

    // Sign with platform's server-side ECDSA key
    const signature = this.cryptoService.signWithSystemKey(canonicalData);

    const lastEvent = await this.getLastEvent(params.entityId);
    const previousHash = lastEvent?.eventHash ?? 'GENESIS';
    const entitySequence = (lastEvent?.entitySequence ?? 0) + 1;

    const eventHash = this.cryptoService.hash(
      `${entitySequence}|${params.entityId}|${params.eventType}|SYSTEM|${canonicalData}|${timestamp}|${signature}|${previousHash}`
    );

    return this.eventLogRepository.insert({
      entityType: params.entityType,
      entityId: params.entityId,
      entitySequence,
      eventType: params.eventType,
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      payload: params.payload,
      timestamp,
      actorSignature: signature,
      authenticatorData: null,
      actorPublicKey: this.config.systemPublicKey,
      credentialId: null,
      previousHash,
      eventHash,
    });
  }

  async verifyChain(entityId: string): Promise<VerificationResult> {
    const events = await this.getChain(entityId);
    let previousHash = 'GENESIS';

    for (const event of events) {
      // Verify signature
      const canonicalData = canonicalize({
        event_type: event.eventType,
        entity_id: event.entityId,
        actor_id: event.actorId,
        payload: event.payload,
        timestamp: event.timestamp,
      });

      let sigValid: boolean;
      if (event.actorRole === 'SYSTEM') {
        // System events: verify with platform's public key
        sigValid = this.cryptoService.verifyWithSystemKey(
          canonicalData, event.actorSignature
        );
      } else {
        // User events: verify WebAuthn signature with stored public key
        sigValid = this.cryptoService.verifyWebAuthnSignature(
          canonicalData,
          event.actorSignature,
          event.authenticatorData,
          event.actorPublicKey
        );
      }

      if (!sigValid) {
        return { valid: false, error: `Invalid signature at sequence ${event.entitySequence}` };
      }

      // Verify hash chain
      if (event.previousHash !== previousHash) {
        return { valid: false, error: `Broken chain at sequence ${event.entitySequence}` };
      }

      // Verify event hash
      const expectedHash = this.cryptoService.hash(
        `${event.entitySequence}|${event.entityId}|${event.eventType}|${event.actorId}|${canonicalData}|${event.timestamp}|${event.actorSignature}|${previousHash}`
      );
      if (event.eventHash !== expectedHash) {
        return { valid: false, error: `Hash mismatch at sequence ${event.entitySequence}` };
      }

      previousHash = event.eventHash;
    }

    return { valid: true, chainLength: events.length, headHash: previousHash };
  }

  async getVerificationBundle(purchaseOrderId: string): Promise<VerificationBundle> {
    const chain = await this.getChain(purchaseOrderId);
    const integrity = await this.verifyChain(purchaseOrderId);
    const actors = await this.getActorsForEntity(purchaseOrderId);

    return { purchaseOrderId, eventChain: chain, actors, chainIntegrity: integrity };
  }
}
```

---

## Summary

| Question | Answer |
|----------|--------|
| How does the LP know the PO is real? | **Passkey signature** (ECDSA P-256, hardware-bound) — the buyer's device signed it with biometric authentication. The platform cannot forge this. |
| How does the LP know payment is locked? | **Signed system event** + simulated Open Banking reference in the chain |
| How do we know nothing was tampered with? | **SHA-256 hash chain** — modifying any event breaks all subsequent hashes |
| Where is this stored? | **PostgreSQL append-only table** — INSERT only, no UPDATE/DELETE at DB level |
| Can an insider change records? | **No** — they'd need physical access to every actor's device hardware (Secure Enclave / TPM) |
| Is this blockchain? | **No** — same cryptographic primitives, but centralised and practical |
| Can it become blockchain later? | **Yes** — the event chain can be anchored to any external ledger |
