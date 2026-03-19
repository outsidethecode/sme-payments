# Onboarding Overhaul & Nafath Identity Verification Plan

## Current State — What's Broken

### Bug: False "Onboarding Complete" Status
The seed data creates all 8 organisations with `onboardingStatus: COMPLETED`, but **none of the actual onboarding steps are fulfilled**:
- `kybVerifiedAt` is `null` — KYB never ran
- `authorizedSignatory` is `null` — nobody submitted identity
- The seed does set `bankIban` (auto-generated), so Step 2 shows as complete

The frontend checks `status.onboardingStatus === "COMPLETED"` for the green banner, while checking `steps.kyb.complete` (i.e. `!!kybVerifiedAt`) for the step circle. These two are out of sync.

### No Individual Identity Verification
- The KYB step verifies the **business** (CR number), not the **person**
- There is no national ID field on the `User` model
- There is no Nafath, Absher, or any government-ID flow
- Evidence packs bind identity as: email → passkey public key → WebAuthn signature
- An external verifier cannot confirm that a signer is a real person — only that they control an email + passkey

### Dead Feature Flags
- `REAL_KYB_PROVIDER` is defined (default `false`) but **never consumed** — `KybModule` hardcodes `MockKybProvider`
- No `WathqKybProvider` implementation exists — only interface + comments

---

## What Nafath Is

**Nafath** is Saudi Arabia's national digital identity service, operated by Elm Company (subsidiary of the Saudi Data & AI Authority — SDAIA). It provides:

| Capability | Details |
|---|---|
| **Identity verification** | Verifies Saudi national ID (for citizens) or Iqama number (for residents) against NIC (National Information Center) |
| **Authentication** | Push notification to Nafath mobile app → user confirms random number → verified |
| **Data returned** | Full name (Arabic + English), national ID / Iqama number, date of birth, nationality, ID expiry, photo (optional) |
| **Integration** | REST API via Elm's developer portal (`developer.elm.sa`) |
| **Regulation** | Required by SAMA (Saudi Central Bank) for financial services KYC |

### Nafath API Flow
```
1. Platform → Nafath API: POST /verify { nationalId, serviceId }
2. Nafath → User's phone: Push notification with random number (e.g. "47")
3. User confirms the number on Nafath app (biometric + PIN)
4. Platform → Nafath API: GET /verify/status/{transactionId}  (poll or webhook)
5. Nafath returns: { verified: true, fullNameAr, fullNameEn, nationalId, birthDate, ... }
```

**Wathq** (also by Elm) is the companion service for **business verification** — validates CR numbers against the Ministry of Commerce registry. Wathq verifies the company; Nafath verifies the person.

---

## Proposed Architecture

### Identity Verification Layers

```
┌──────────────────────────────────────────────────┐
│                  Evidence Pack                     │
│  actors[].identityVerification: {                  │
│    provider: "NAFATH",                             │
│    nationalId: "10xxxxx890" (masked),              │
│    verifiedName: "Mohammed Al-Rashidi",            │
│    verifiedAt: "2025-01-15T10:30:00Z"             │
│  }                                                 │
├──────────────────────────────────────────────────┤
│  Layer 3: Government ID  (NEW — Nafath)            │
│  ↕ binds real person to platform account           │
├──────────────────────────────────────────────────┤
│  Layer 2: Business Verification  (EXISTS — KYB)    │
│  ↕ binds org to real company (CR number)           │
├──────────────────────────────────────────────────┤
│  Layer 1: Cryptographic  (EXISTS — Passkeys)       │
│  ↕ binds actions to device key                     │
└──────────────────────────────────────────────────┘
```

### New Onboarding Flow (Buyer — KSA)

```
Step 0: Identity Verification (NEW)
  → Nafath: verify national ID / Iqama
  → Result stored on User model
  → Required before any business actions

Step 1: Business Verification (KYB-lite)  (EXISTS)
  → Wathq: verify CR number against MoC
  → Authorized signatory cross-referenced with Nafath-verified name
  → Result stored on Organisation model

Step 2: Connect Payment Method  (EXISTS)
  → IBAN submission
  → Future: IBAN ownership verification via SAMA

Step 3: Complete Onboarding  (EXISTS — fix guard logic)
  → All steps must be green before COMPLETED status
```

---

## Implementation Phases

### Phase A — Fix Onboarding Status Bug (Day 1)

**Problem:** Seed data marks all orgs as `COMPLETED` without completing any steps.

**Changes:**

1. **Update `seed.ts`** — Set `onboardingStatus: NOT_STARTED` for new orgs (or compute from actual field state)
2. **Add backend guard** — `getStatus()` should recompute `onboardingStatus` from actual step completion rather than trusting the stored value:
   ```typescript
   // If DB says COMPLETED but steps aren't actually done, downgrade
   if (org.onboardingStatus === 'COMPLETED' && !this.allStepsComplete(org)) {
     await this.prisma.organisation.update({
       where: { id: org.id },
       data: { onboardingStatus: this.computeStatus(org) }
     });
   }
   ```
3. **Run migration** on existing seed data to fix the 8 seeded orgs

**Files to modify:**
- `backend/prisma/seed.ts` — change default onboarding status
- `backend/src/onboarding/onboarding.service.ts` — add status recomputation in `getStatus()`

---

### Phase B — Identity Provider Abstraction (Day 2)

**New module: `backend/src/identity/`**

```
identity/
  identity-provider.interface.ts    ← Provider contract
  mock-identity.provider.ts         ← Auto-approves (dev/test)
  nafath-identity.provider.ts       ← Real Nafath API (KSA production)
  identity.service.ts               ← Orchestrator
  identity.module.ts                ← DI wiring with feature flag
  dto/
    verify-identity.dto.ts          ← { nationalId: string }
    identity-result.dto.ts          ← Verification result
```

**Provider interface:**
```typescript
export interface IdentityVerificationResult {
  verified: boolean;
  provider: string;              // "NAFATH" | "MOCK"
  nationalId?: string;           // Masked: "10*****890"
  fullNameAr?: string;
  fullNameEn?: string;
  dateOfBirth?: string;
  nationality?: string;
  transactionId?: string;        // Nafath transaction reference
  verifiedAt?: Date;
  errorMessage?: string;
  rawResponse?: Record<string, any>;
}

export interface IdentityProvider {
  /** Initiate verification — returns transactionId + random number */
  initiate(nationalId: string): Promise<{
    transactionId: string;
    random: string;               // The number user must confirm on Nafath app
  }>;

  /** Check verification status (poll) */
  checkStatus(transactionId: string): Promise<IdentityVerificationResult>;
}
```

**Feature flag wiring:**
```typescript
// identity.module.ts
@Module({
  providers: [
    {
      provide: 'IDENTITY_PROVIDER',
      useFactory: (flags: FeatureFlagsService) =>
        flags.isEnabled(FeatureFlag.REAL_IDENTITY_PROVIDER)
          ? new NafathIdentityProvider(configService)
          : new MockIdentityProvider(),
      inject: [FeatureFlagsService],
    },
    IdentityService,
  ],
})
```

**New feature flag:** `REAL_IDENTITY_PROVIDER` (default: `false`)

---

### Phase C — User Model Extension (Day 2)

**New Prisma fields on `User`:**
```prisma
model User {
  // ... existing fields ...

  // Identity verification (Nafath / government ID)
  nationalId              String?          // Stored encrypted or masked
  nationalIdHash          String?          // SHA-256 for uniqueness check
  identityProvider        String?          // "NAFATH" | "MOCK"
  identityVerifiedAt      DateTime?
  identityVerifiedName    String?          // Name as returned by Nafath
  identityData            Json?            // Full provider response (encrypted at rest)
}
```

**Why hash the national ID:** Prevents duplicate registrations (same person, multiple accounts) without storing the raw ID in a searchable column. The raw ID is in `identityData` (encrypted JSON) for compliance/audit.

**Migration:** Add columns with `?` (nullable) — no breaking change for existing users.

---

### Phase D — Wire REAL_KYB_PROVIDER Flag (Day 3)

**Problem:** `REAL_KYB_PROVIDER` flag exists but `KybModule` ignores it.

**Fix `kyb.module.ts`:**
```typescript
@Module({
  providers: [
    {
      provide: 'KYB_PROVIDER',
      useFactory: (flags: FeatureFlagsService) =>
        flags.isEnabled(FeatureFlag.REAL_KYB_PROVIDER)
          ? new WathqKybProvider(configService)
          : new MockKybProvider(),
      inject: [FeatureFlagsService],
    },
    KybService,
  ],
})
```

**Stub `WathqKybProvider`** (real Wathq API integration later):
```typescript
export class WathqKybProvider implements KybProvider {
  async verify(registrationNo: string, jurisdiction: string) {
    // TODO: Call Wathq API at https://api.wathq.sa/v5/commercialregistration/info/{crNumber}
    throw new NotImplementedException('Wathq API integration pending — enable REAL_KYB_PROVIDER only when configured');
  }
}
```

---

### Phase E — Onboarding Step 0: Identity Verification UI (Day 3-4)

**New step in `BuyerOnboarding` component (and mirror for Supplier/LP):**

```
┌─────────────────────────────────────────────┐
│ ○  Step 0: Identity Verification             │
│    Verify your identity using Nafath          │
│                                               │
│    National ID / Iqama Number                 │
│    ┌─────────────────────────────────┐       │
│    │ 10xxxxxxxx                       │       │
│    └─────────────────────────────────┘       │
│                                               │
│    [ Start Verification 🛡️ ]                  │
│                                               │
│    ┌─────────────────────────────────────┐   │
│    │ 🔔 Check your Nafath app             │   │
│    │    Confirm number: 47                │   │
│    │    Waiting for confirmation...       │   │
│    └─────────────────────────────────────┘   │
│                                               │
│    ✅ Verified: Mohammed Al-Rashidi           │
│       ID: 10*****890 · Verified 2025-01-15   │
└─────────────────────────────────────────────┘
```

**API endpoints:**
```
POST /onboarding/identity/initiate   → { transactionId, random }
GET  /onboarding/identity/status     → { verified, verifiedName, ... }
```

**Frontend flow:**
1. User enters national ID → clicks "Start Verification"
2. Backend calls `IdentityProvider.initiate(nationalId)` → returns random number
3. Frontend shows "Check your Nafath app — confirm number: XX"
4. Frontend polls `GET /onboarding/identity/status` every 3 seconds
5. On success → shows verified name, step turns green
6. Mock provider: auto-verifies after 2 seconds (no real Nafath app needed)

---

### Phase F — Connect Identity to Evidence Pack (Day 4-5)

**Extend `TrustEnvelopeActor`:**
```typescript
export interface TrustEnvelopeActor {
  id: string;
  role: string;
  name: string;
  email: string | null;
  companyName: string | null;
  jurisdiction: string | null;
  organisationType: string | null;
  credentials: TrustEnvelopeActorCredential[];
  identityResolutionUri: string;

  // NEW — Government ID verification
  identityVerification?: {
    provider: string;           // "NAFATH" | "MOCK"
    verified: boolean;
    verifiedName: string;       // Name as returned by government ID provider
    nationalIdMasked: string;   // "10*****890"
    verifiedAt: string;         // ISO timestamp
  };
}
```

**Extend identity registry endpoint** (`GET /proofs/identity/signers/:userId`):
```typescript
return {
  userId: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  organisation: org ? { ... } : null,
  passkeys: user.passkeys,

  // NEW
  identityVerification: user.identityVerifiedAt ? {
    provider: user.identityProvider,
    verified: true,
    verifiedName: user.identityVerifiedName,
    nationalIdMasked: maskNationalId(user.nationalId),
    verifiedAt: user.identityVerifiedAt.toISOString(),
  } : null,
};
```

**Impact on evidence verification:** The `verify-evidence-pack.mjs` script can now check that each actor has a government-verified identity, not just a passkey. This strengthens the trust model from "someone with this email owns this passkey" to "Mohammed Al-Rashidi (Saudi NIC ID 10*****890) signed this with their passkey."

---

### Phase G — Onboarding Step Progression Guards (Day 5)

**Backend: enforce step ordering**
```typescript
// Cannot do KYB until identity is verified
async buyerKyb(orgId, data) {
  const membership = await this.getOrgMembership(orgId, userId);
  if (!membership.user.identityVerifiedAt) {
    throw new BadRequestException('Identity verification required before KYB');
  }
  // ... existing KYB logic
}

// Cannot complete until ALL steps green
async completeBuyerOnboarding(orgId) {
  // ... existing checks + NEW:
  const members = await this.getOrgMembers(orgId);
  const unverified = members.filter(m => !m.user.identityVerifiedAt);
  if (unverified.length > 0) {
    throw new BadRequestException('All org members must verify their identity');
  }
}
```

**Frontend: disable later steps until previous complete**
- Step 1 (KYB) is non-interactive until Step 0 (Identity) is green
- Step 2 (Payment) is non-interactive until Step 1 (KYB) is green
- "Complete Onboarding" only appears when all steps are green

---

## New Feature Flags Summary

| Flag | Default | Purpose |
|---|---|---|
| `REAL_IDENTITY_PROVIDER` | `false` | Use Nafath API instead of mock identity verification |
| `REAL_KYB_PROVIDER` | `false` | Use Wathq API instead of mock KYB (already exists, need to wire) |

When both are `false` (dev/test): mock providers auto-approve. Onboarding flow still works end-to-end.
When enabled (KSA production): real Nafath + Wathq APIs are called.

---

## File Change Summary

| Phase | Files | Type |
|---|---|---|
| **A** | `seed.ts`, `onboarding.service.ts` | Fix |
| **B** | `identity/` (new module, 6 files) | New |
| **C** | `schema.prisma`, migration | Schema |
| **D** | `kyb.module.ts`, `wathq-kyb.provider.ts` (stub) | Fix |
| **E** | `onboarding.controller.ts`, `onboarding.service.ts`, `page.tsx` | Feature |
| **F** | `evidence.service.ts`, `proofs.controller.ts`, `proof-bundle.schema.ts` | Feature |
| **G** | `onboarding.service.ts`, `page.tsx` | Feature |

---

## Onboarding Matrix (After All Phases)

| Step | Buyer | Supplier (Tier 1) | Supplier (Tier 2) | LP |
|---|---|---|---|---|
| **Identity (Nafath)** | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| **KYB-lite (Wathq)** | ✅ CR + signatory | ✅ CR number | ✅ Full KYB + sanctions | — |
| **Payment method** | ✅ IBAN | ✅ IBAN | — (done in Tier 1) | ✅ Funding IBAN |
| **Terms / Agreement** | — | ✅ Platform terms | — | ✅ Participation agreement |
| **UBO disclosure** | — | — | ✅ Required | — |
| **Funding limits** | — | — | — | ✅ Required |

---

## Risk Considerations

1. **Nafath API availability** — Nafath has documented outages. The mock provider serves as fallback; consider a degraded-mode UX ("identity verification temporarily unavailable, try again later").

2. **National ID storage** — Saudi PDPA (implemented in our PDPA module) applies. National IDs should be encrypted at rest, access-logged, and deletable on request. Consider storing only the hash + Nafath transaction reference, not the raw ID.

3. **Non-Saudi users** — Nafath covers Saudi citizens and residents (Iqama holders). For non-Saudi, non-resident users (e.g., UK orgs), we need a different identity provider or accept passkey-only identity. The `identityProvider` field accommodates this — UK orgs may use a different provider in the future.

4. **Authorized signatory cross-reference** — When the Nafath-verified name matches the authorized signatory submitted in KYB, this creates a strong identity chain: *this specific real person (Nafath) is authorized to act for this company (Wathq) and signed with this key (passkey)*.

---

## Recommended Build Order

| Day | Phase | Deliverable |
|---|---|---|
| 1 | **A** | Onboarding status bug fixed — seeded orgs show correct status |
| 2 | **B + C** | Identity module + User model migration — mock provider works |
| 3 | **D + E** | KYB flag wired + identity verification UI step in onboarding |
| 4-5 | **F + G** | Evidence pack includes identity + step progression guards |

All phases work with mock providers. Real Nafath/Wathq integration is a configuration change (flip feature flags + add API keys) — no code changes needed.
