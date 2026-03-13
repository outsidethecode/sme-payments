# Multi-Currency Implementation Plan

**Date:** 12 March 2026  
**Status:** Draft  
**Prerequisite:** 431 tests passing (25 suites) — baseline before changes  
**Reference:** `documentation/multi-currecny.md`

---

## Executive Summary

The platform already stores amounts as integer minor units (correct) and has a `Currency` enum with `GBP` and `SAR`. However, currency is **inconsistently typed, incompletely propagated, and frequently hardcoded to GBP** across both backend and frontend. This plan fixes all currency handling so that every monetary value is always paired with its currency and rendered correctly, following the principle:

> **One currency per transaction. Currency defined at organisation level. Propagated immutably to all downstream records.**

---

## Current State — Audit Summary

### What's Already Right
- All monetary amounts stored as `Int` (smallest unit — pence/halalah) ✅
- `Organisation` model has `currency: Currency` (Prisma enum) ✅
- `PurchaseOrder`, `PaymentInstrument`, `Settlement` each have a `currency` field ✅
- `formatCurrency()` exists in both shared package and frontend, supporting GBP + SAR ✅
- Seed data creates both UK/GBP and KSA/SAR organisations ✅
- `CURRENCY_META` maps currencies to minor unit info ✅

### What's Wrong

| # | Severity | Issue |
|---|----------|-------|
| 1 | **Critical** | 15+ frontend pages call `formatCurrency()` without passing currency → always renders as GBP (£) even for SAR transactions |
| 2 | **Critical** | Admin aggregate views (`totalVolumePennies`, `totalFeesPennies`) mix currencies into one sum → meaningless number |
| 3 | **Critical** | Fraud thresholds (`maxDailyValuePerBuyer: 50_000_000`) are currency-agnostic — 500k GBP ≠ 500k SAR |
| 4 | **High** | Missing `currency` field on: `PaymentLock`, `EarlyPaymentRequest`, `PlatformFee`, `Dispute.refundAmount`, `LpExposureSnapshot`, `ReconciliationReport` |
| 4b | **High** | No `EscrowAccount` model — escrow is implicit (`PaymentInstrument.escrowReference` is a free-text string); no first-class entity linking POs to a bank-held escrow account by currency/country; `PaymentLock` has no `escrowAccountId`; reconciliation aggregates all instruments regardless of currency |
| 5 | **High** | `PurchaseOrder.currency`, `PaymentInstrument.currency`, `Settlement.currency` are `String @default("GBP")` — should use Prisma `Currency` enum for type safety |
| 6 | **High** | Shared package `PO_LIMITS` is GBP-only; Zod error messages hardcode `£` symbol |
| 7 | **Medium** | SimulatedAdapter debits/credits a single `User.balance` field with no currency distinction |
| 8 | **Medium** | Settlement adapters don't validate that `request.currency` is in their `supportedCurrencies` |
| 9 | **Medium** | `"Pennies"` naming convention throughout API responses and frontend types (`amountPennies`, `totalAmountPennies`, `faceValuePennies`) — misleading for SAR |
| 10 | **Low** | `packages/shared/src/constants/config.ts` exports dead `CURRENCY = "GBP"` constant |
| 11 | **Low** | Hardcoded `£500 – £250,000` string literal in admin page |

---

## Design Principles

1. **One currency per transaction** — PO currency is authoritative; all downstream records inherit it
2. **Currency is immutable** — once a PO is created, its currency cannot change
3. **Organisation default currency** — derived from jurisdiction (`UK→GBP`, `KSA→SAR`); user never picks currency manually
4. **Every monetary amount must have a currency** — no orphan `Int` fields without a companion `currency` column
5. **Currency-specific formatting** — frontend always passes currency to `formatCurrency()`
6. **Currency-specific limits & thresholds** — PO limits and fraud thresholds vary per currency
7. **Currency-neutral naming** — replace "pennies" with "minor units" in API types (or use generic `amountMinor`)
8. **No FX in v1** — each transaction uses one currency end-to-end; no cross-currency operations

---

## Implementation Steps

### Step 1 — Schema: Unify Currency Type & Add Missing Fields

**Goal:** Every model that stores a monetary amount also stores its currency using the Prisma `Currency` enum.

#### 1a. Migrate `PurchaseOrder.currency`, `PaymentInstrument.currency`, `Settlement.currency` from `String` → `Currency` enum

```prisma
// Before
currency  String  @default("GBP")

// After
currency  Currency  @default(GBP)
```

#### 1b. Add `currency` field to models missing it

| Model | New Field | Derivation |
|-------|-----------|------------|
| `PaymentLock` | `currency Currency @default(GBP)` | Copied from PO at lock creation |
| `EarlyPaymentRequest` | `currency Currency @default(GBP)` | Copied from PO at request creation |
| `PlatformFee` | `currency Currency @default(GBP)` | Copied from PO at fee creation |
| `Dispute` | `currency Currency @default(GBP)` | Copied from PO at dispute creation |
| `LpExposureSnapshot` | `currency Currency @default(GBP)` | Per-currency snapshot (one row per LP per currency) |
| `ReconciliationReport` | `currency Currency @default(GBP)` | Per-currency reconciliation |

#### 1c. Prisma migration

Generate migration `add_currency_fields_and_unify_type`. The migration SQL must:
1. Add new `currency` columns with default `'GBP'`
2. Back-fill existing rows: `UPDATE payment_locks SET currency = (SELECT currency FROM purchase_orders WHERE id = payment_locks.purchase_order_id)`
3. Convert `String` columns to enum references where needed

#### Files Changed
- `backend/prisma/schema.prisma`
- New migration in `backend/prisma/migrations/`

---

### Step 2 — Shared Package: Currency-Aware Constants & Schemas

**Goal:** Make all shared constants, limits, and Zod schemas currency-aware.

#### 2a. Replace single `PO_LIMITS` with per-currency limits

```typescript
// packages/shared/src/constants/config.ts

export const PO_LIMITS: Record<string, { MIN_AMOUNT: number; MAX_AMOUNT: number }> = {
  GBP: { MIN_AMOUNT: 500_00, MAX_AMOUNT: 250_000_00 },       // £500 – £250,000
  SAR: { MIN_AMOUNT: 1_875_00, MAX_AMOUNT: 937_500_00 },     // SAR 1,875 – SAR 937,500 (~equivalent)
};
```

#### 2b. Remove dead `CURRENCY = "GBP"` constant

#### 2c. Update `CURRENCY_META` to be the single source of truth

```typescript
// packages/shared/src/utils/index.ts
export const CURRENCY_META: Record<string, {
  subUnit: string;
  subUnitsPerUnit: number;
  symbol: string;
  locale: string;
}> = {
  GBP: { subUnit: "pence",   subUnitsPerUnit: 100, symbol: "£",   locale: "en-GB" },
  SAR: { subUnit: "halalah", subUnitsPerUnit: 100, symbol: "SAR", locale: "en-SA" },
};
```

#### 2d. Make `createPOSchema` currency-aware

Replace hardcoded `£` error messages with dynamic messages. The schema should accept a `currency` parameter or use `.superRefine()` to validate amount against currency-specific limits.

```typescript
export function createPOSchema(currency: string = "GBP") {
  const limits = PO_LIMITS[currency] || PO_LIMITS["GBP"];
  const meta = CURRENCY_META[currency] || CURRENCY_META["GBP"];

  return z.object({
    // ... existing fields ...
    amount: z
      .number()
      .int(`Amount must be in whole ${meta.subUnit}`)
      .min(limits.MIN_AMOUNT, `Minimum amount is ${meta.symbol}${limits.MIN_AMOUNT / meta.subUnitsPerUnit}`)
      .max(limits.MAX_AMOUNT, `Maximum amount is ${meta.symbol}${limits.MAX_AMOUNT / meta.subUnitsPerUnit}`),
  });
}
```

#### 2e. Rename "pennies" references in comments

Update JSDoc/comments to say "minor units" instead of "pennies".

#### Files Changed
- `packages/shared/src/constants/config.ts`
- `packages/shared/src/utils/index.ts`
- `packages/shared/src/schemas/purchase-order.schema.ts`

---

### Step 3 — Backend Services: Currency Propagation

**Goal:** Every backend service that creates a monetary record must copy `currency` from the PO (or organisation).

#### 3a. `purchase-orders.service.ts` — PO creation

Already resolves `buyerOrg?.currency || "GBP"`. Tighten the fallback:
- If buyer org has no currency, throw an error (don't silently default to GBP)
- Use currency-specific PO limits from the shared package
- Pass currency to Zod schema validation

#### 3b. `payment-locks.service.ts` — Lock creation

When creating a `PaymentLock`, copy `currency` from the PO:

```typescript
await prisma.paymentLock.create({
  data: {
    ...existingFields,
    currency: po.currency,   // NEW
  },
});
```

#### 3c. `early-payments.service.ts` — Early payment request creation

Copy `currency` from the PO into the `EarlyPaymentRequest`.

#### 3d. `settlements/instrument.service.ts` — Payment instrument creation

Already stores `currency` — ensure it comes from PO, not hardcoded.

#### 3e. `settlements/settlement.service.ts` — Settlement creation

Already stores `currency` — verify it's sourced from PO/instrument.

#### 3f. Platform fee creation

Any service creating `PlatformFee` records must include `currency` from the PO.

#### 3g. Disputes service

When creating a `Dispute`, copy `currency` from the PO.

#### 3h. Settlement adapter validation

Add a `validateCurrency()` check at the top of each adapter's `settle()` / `lockFunds()` method:

```typescript
if (!this.supportedCurrencies.includes(currency)) {
  throw new BadRequestException(`Adapter does not support currency: ${currency}`);
}
```

#### Files Changed
- `backend/src/purchase-orders/purchase-orders.service.ts`
- `backend/src/payment-locks/payment-locks.service.ts`
- `backend/src/early-payments/early-payments.service.ts`
- `backend/src/settlements/instrument.service.ts`
- `backend/src/settlements/settlement.service.ts`
- `backend/src/settlements/simulated.adapter.ts`
- `backend/src/settlements/ksa-bank.adapter.ts`
- Other services that create PlatformFee / Dispute records

---

### Step 4 — Backend Services: Currency-Aware Aggregations

**Goal:** Any backend endpoint that aggregates monetary values must group by currency.

#### 4a. `admin.service.ts` — Dashboard stats

Replace single `totalVolumePennies` with per-currency breakdown:

```typescript
// Before
{ totalVolumePennies: 12345678 }

// After
{
  volumeByCurrency: {
    GBP: 8000000,
    SAR: 4345678,
  },
  feesByCurrency: {
    GBP: 40000,
    SAR: 21728,
  },
}
```

Implementation: `GROUP BY currency` in the aggregation queries.

#### 4b. `payment-locks.service.ts` — Total locked display

Group locked amounts by currency. Update `totalAmountPennies` → `totalByCurrency`.

#### 4c. Reconciliation reports

Each `ReconciliationReport` row should represent one currency. Change the reconciliation cron/service to run per-currency.

#### 4d. LP exposure snapshots

`LpExposureSnapshot` should be per-currency. An LP funding SAR instruments and GBP instruments gets separate exposure rows.

#### Files Changed
- `backend/src/admin/admin.service.ts`
- `backend/src/payment-locks/payment-locks.service.ts`
- `backend/src/settlements/reconciliation.service.ts`
- LP exposure service (if exists)

---

### Step 5 — Backend: Currency-Aware Fraud Thresholds

**Goal:** Fraud / risk thresholds must differ by currency since SAR and GBP have different real-world values.

#### 5a. Make fraud control thresholds per-currency

```typescript
// Before
const FRAUD_LIMITS = {
  maxDailyValuePerBuyer: 50_000_000,           // 500k in minor units
  mandatoryEvidenceThreshold: 10_000_000,       // 100k in minor units
};

// After
const FRAUD_LIMITS: Record<string, { maxDailyValue: number; evidenceThreshold: number }> = {
  GBP: { maxDailyValue: 50_000_000, evidenceThreshold: 10_000_000 },    // £500k / £100k
  SAR: { maxDailyValue: 187_500_000, evidenceThreshold: 37_500_000 },   // SAR 1.875M / SAR 375k (~equivalent)
};
```

#### 5b. Policy limit defaults per currency

Already partially done in `policies.service.ts` with `DEFAULT_LIMITS`. Verify the SAR limits are sensible and the fallback doesn't silently use GBP limits for SAR transactions.

#### Files Changed
- `backend/src/risk/fraud-controls.service.ts`
- `backend/src/policies/policies.service.ts`
- `backend/src/policies/policies.controller.ts`

---

### Step 6 — API Response Naming: "Pennies" → "Minor"

**Goal:** Replace GBP-specific naming with currency-neutral naming in API responses.

This is a **breaking API change** for the frontend, so both must change together.

#### 6a. Backend controller response mapping

| Old Name | New Name |
|----------|----------|
| `amountPennies` | `amountMinor` |
| `totalAmountPennies` | `totalAmountMinor` |
| `unitPricePennies` | `unitPriceMinor` |
| `faceValuePennies` | `faceValueMinor` |
| `serviceFeePennies` | `serviceFeeMinor` |
| `netAdvancePennies` | `netAdvanceMinor` |
| `totalVolumePennies` | `totalVolumeMinor` |
| `totalFeesPennies` | `totalFeesMinor` |
| `totalLockedPennies` | `totalLockedMinor` |

Every response that includes a monetary `*Minor` field must also include a `currency` field at the same level (or at parent level if shared).

#### 6b. Frontend types in `api.ts`

Update all `*Pennies` type properties to `*Minor`.

#### 6c. Ensure every API response that returns a monetary amount also returns `currency`

Example additions:
- Payment lock response: add `currency`
- Early payment response: add `currency`
- Admin stats: replace single amounts with `volumeByCurrency` / `feesByCurrency`

#### Files Changed
- All backend controllers that return monetary values
- `frontend/src/lib/api.ts` (types)
- All frontend pages referencing `*Pennies` properties

---

### Step 7 — Frontend: Pass Currency to Every `formatCurrency()` Call

**Goal:** Every `formatCurrency()` call on every page must receive the actual currency, never relying on the GBP default.

#### 7a. Pages that already pass currency (verify & keep)
- `dashboard/page.tsx` — uses `user.currency` ✅
- `approvals/page.tsx` — uses `user?.currency` ✅
- `disputes/page.tsx` — uses `d.purchaseOrder.currency` ✅
- `settlements/page.tsx` (regular view) — uses `s.currency` ✅
- `purchase-orders/new/page.tsx` — uses `user?.currency` ✅

#### 7b. Pages that need fixing (pass currency from API response)

| Page | Fix |
|------|-----|
| `admin/page.tsx` | Switch to per-currency stats; format each separately |
| `payment-locks/page.tsx` | Use `lock.currency` (new field); per-currency totals |
| `early-payments/page.tsx` | Use `ep.currency` (new field) for all `formatCurrency()` calls |
| `purchase-orders/page.tsx` | Use `po.currency` (already in response) |
| `purchase-orders/[id]/page.tsx` | Use `po.currency` for all amount displays |
| `settlements/page.tsx` (admin view) | Per-currency aggregation |
| `ledger/page.tsx` | Use event-level currency from payload |
| `risk/page.tsx` | Use appropriate currency from context |
| `admin/reconciliation/page.tsx` | Per-currency reports |

#### 7c. Remove hardcoded `£` strings
- `admin/page.tsx`: `£500 – £250,000` → dynamic from `PO_LIMITS` + `CURRENCY_META`

#### Files Changed
- Every frontend page listed above (~12 files)

---

### Step 8 — Frontend: Currency Display Component (Optional Enhancement)

**Goal:** Create a reusable `<Money>` component that eliminates the possibility of forgetting to pass currency.

```tsx
// frontend/src/components/ui/money.tsx
interface MoneyProps {
  amount: number;           // minor units
  currency: "GBP" | "SAR";
  className?: string;
}

export function Money({ amount, currency, className }: MoneyProps) {
  return <span className={className}>{formatCurrency(amount, currency)}</span>;
}
```

Usage:
```tsx
<Money amount={po.totalAmountMinor} currency={po.currency} />
```

This makes it **impossible** to format money without specifying currency.

#### Files Changed
- New: `frontend/src/components/ui/money.tsx`
- Optionally migrate all `formatCurrency()` calls in JSX to use `<Money />`

---

### Step 9 — Seed Data & Tests

**Goal:** Update seed data and all tests to handle multi-currency correctly.

#### 9a. Seed data

Already seeds both GBP and SAR organisations — verify POs, locks, and early payments for KSA orgs use `SAR`.

#### 9b. Test updates

- Update all test expectations that reference `*Pennies` → `*Minor`
- Add test cases for SAR transactions (PO creation, lock, settlement)
- Add test case: reject PO creation if currency doesn't match org's currency
- Add test case: adapter rejects unsupported currency
- Add test case: admin stats return per-currency breakdown
- Verify fraud thresholds trigger correctly per-currency

#### Files Changed
- `backend/prisma/seed.ts`
- All `*.spec.ts` test files

---

### Step 10 — Evidence Pack & Ledger Events

**Goal:** Ensure currency is included in all ledger events and evidence packs.

#### 10a. Event payloads

Every ledger event that records a monetary value must include `currency`:

```json
{
  "eventType": "PAYMENT_LOCKED",
  "payload": {
    "amount": 70000000,
    "currency": "SAR"
  }
}
```

Review all `EventLog` creation sites and ensure `currency` is in the payload.

#### 10b. Evidence pack / trust envelope

The evidence service should include `currency` in the payment instrument section and settlement section of the trust envelope.

Already partially done — verify and fill gaps.

#### Files Changed
- `backend/src/ledger/ledger.service.ts`
- `backend/src/evidence/evidence.service.ts`
- Any service that creates EventLog entries with monetary values

---

### Step 11 — Escrow Account Model & Routing

**Goal:** Introduce a first-class `EscrowAccount` entity so the platform explicitly tracks which bank-held account secures funds for each transaction, per currency and per country. This replaces the implicit `PaymentInstrument.escrowReference` string with a proper foreign-key relationship and enables per-currency reconciliation against real bank balances.

**Reference:** `documentation/escrow-account.md`

#### 11a. New `EscrowAccount` Prisma model

```prisma
model EscrowAccount {
  id              String    @id @default(uuid())
  label           String                               // e.g. "KSA SAR Escrow"
  bank            String                               // bank name / BIC
  country         String                               // ISO 3166-1 alpha-2 ("SA", "GB")
  currency        Currency                             // must match the account's bank currency
  iban            String?                              // bank IBAN (nullable for simulated)
  balanceMinor    Int       @default(0) @map("balance_minor")  // shadow balance from adapter (informational)
  isActive        Boolean   @default(true) @map("is_active")
  metadata        Json?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  paymentInstruments PaymentInstrument[]
  reconciliationReports ReconciliationReport[]

  @@unique([country, currency])               // one active account per country+currency
  @@index([currency, isActive])
  @@map("escrow_accounts")
}
```

Key design decisions:
- **One account per country+currency** (`@@unique([country, currency])`) — the doc's "one escrow account per country" rule
- **Virtual sub-accounts via ledger** — individual PO amounts are tracked by `PaymentLock` / `PaymentInstrument`, not by bank sub-accounts
- **`balanceMinor`** is a shadow copy updated from the adapter's `getBalance()` (when supported); reconciliation compares this against the sum of locked instruments

#### 11b. Link `PaymentInstrument` → `EscrowAccount`

```prisma
model PaymentInstrument {
  // ... existing fields ...
  escrowAccountId     String?               @map("escrow_account_id")
  escrowAccount       EscrowAccount?        @relation(fields: [escrowAccountId], references: [id])
}
```

Replace the free-text `escrowReference` with a proper FK. Keep `escrowReference` as a secondary field for the bank's own reference number (e.g., SARIE transaction ref).

#### 11c. Link `ReconciliationReport` → `EscrowAccount`

```prisma
model ReconciliationReport {
  // ... existing fields ...
  escrowAccountId   String?               @map("escrow_account_id")
  escrowAccount     EscrowAccount?        @relation(fields: [escrowAccountId], references: [id])
}
```

Each reconciliation run produces one report **per escrow account** (= per currency).

#### 11d. Escrow routing service

New `EscrowRoutingService` resolves the correct escrow account for a transaction:

```typescript
// backend/src/settlements/escrow-routing.service.ts

@Injectable()
export class EscrowRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the active escrow account for the given currency.
   * Throws if no active account exists for that currency.
   */
  async resolveAccount(currency: Currency): Promise<EscrowAccount> {
    const account = await this.prisma.escrowAccount.findFirst({
      where: { currency, isActive: true },
    });
    if (!account) {
      throw new BadRequestException(
        `No active escrow account for currency: ${currency}`,
      );
    }
    return account;
  }
}
```

This is called by `InstrumentService` when creating or locking an instrument:

```typescript
// In InstrumentService.create() or confirmLock()
const escrowAccount = await this.escrowRouting.resolveAccount(po.currency);
await prisma.paymentInstrument.update({
  where: { id: instrument.id },
  data: { escrowAccountId: escrowAccount.id },
});
```

#### 11e. Per-escrow-account reconciliation

Update `ReconciliationService.runReconciliation()` to:

1. Iterate over all **active** escrow accounts
2. For each account, aggregate LOCKED instruments where `escrowAccountId = account.id`
3. Compare against `account.balanceMinor` (from adapter) or `null` if not available
4. Create one `ReconciliationReport` per account

```typescript
const accounts = await this.prisma.escrowAccount.findMany({
  where: { isActive: true },
});

for (const account of accounts) {
  const lockedAgg = await this.prisma.paymentInstrument.aggregate({
    where: { escrowAccountId: account.id, status: "LOCKED" },
    _sum: { amount: true },
  });
  const ledgerBalance = lockedAgg._sum.amount ?? 0;
  const bankBalance = account.balanceMinor; // from adapter shadow
  const variance = bankBalance !== null ? ledgerBalance - bankBalance : null;

  await this.prisma.reconciliationReport.create({
    data: {
      escrowAccountId: account.id,
      currency: account.currency,
      // ... rest of report fields
    },
  });
}
```

This satisfies the doc's reconciliation rule: `Sum(paymentLocks.amount) = Bank escrow account balance`.

#### 11f. Seed escrow accounts

```typescript
// In seed.ts
await prisma.escrowAccount.createMany({
  data: [
    {
      label: "UK GBP Escrow (Simulated)",
      bank: "Simulated Bank",
      country: "GB",
      currency: "GBP",
      balanceMinor: 0,
    },
    {
      label: "KSA SAR Escrow (Simulated)",
      bank: "Simulated Bank",
      country: "SA",
      currency: "SAR",
      balanceMinor: 0,
    },
  ],
});
```

#### 11g. Evidence pack — include escrow account

Add escrow account details to the Trust Envelope's `paymentInstrument` section:

```json
{
  "paymentInstrument": {
    "id": "instrument-uuid",
    "amount": 700000,
    "currency": "SAR",
    "escrowAccount": {
      "id": "escrow-uuid",
      "bank": "Saudi Bank",
      "country": "SA",
      "currency": "SAR"
    }
  }
}
```

This proves to auditors exactly **which bank account** secured the funds.

#### Files Changed
- `backend/prisma/schema.prisma` — new `EscrowAccount` model + FK on `PaymentInstrument` + FK on `ReconciliationReport`
- New migration in `backend/prisma/migrations/`
- New: `backend/src/settlements/escrow-routing.service.ts`
- `backend/src/settlements/instrument.service.ts` — call escrow routing on create/lock
- `backend/src/settlements/reconciliation.service.ts` — per-account reconciliation loop
- `backend/src/settlements/settlements.module.ts` — register `EscrowRoutingService`
- `backend/src/evidence/evidence.service.ts` — include escrow account in envelope
- `backend/prisma/seed.ts` — seed escrow accounts

---

### Step 12 — Admin Escrow UI

**Goal:** Give platform admins full visibility into escrow accounts — balances, linked instruments, reconciliation status — directly from the admin dashboard and a dedicated admin page.

**Depends on:** Steps 4 (currency-aware aggregation), 7 (frontend formatCurrency), 11 (EscrowAccount model)

#### 12a. Backend — Escrow admin endpoints

Add endpoints to `AdminController` / `AdminService`:

```typescript
// GET /api/admin/escrow-accounts
// Returns all escrow accounts with summary stats
interface EscrowAccountSummary {
  id: string;
  label: string;
  bank: string;
  country: string;
  currency: Currency;
  balanceMinor: number;
  lockedInstrumentsCount: number;
  lockedAmountMinor: number;
  lastReconciledAt: string | null;
  reconStatus: 'BALANCED' | 'DISCREPANCY' | 'NEVER_RUN';
}

// GET /api/admin/escrow-accounts/:id
// Returns single account with linked instruments + recent reconciliation reports
```

Build the queries using Prisma `include` to pull `_count` of linked instruments and latest `ReconciliationReport`.

#### 12b. Admin dashboard — Escrow summary card

Add an "Escrow Accounts" card to the existing admin dashboard (`/dashboard/admin`):

- Show **number of active escrow accounts** (e.g. "2 Active")
- Show **total balance per currency** (e.g. "GBP: £80,000.00 · SAR: ﷼45,000.00")
- Show a **warning badge** if any account has `reconStatus === 'DISCREPANCY'`
- Card links to the full Escrow Accounts page

```tsx
<Card>
  <CardHeader>
    <CardTitle>Escrow Accounts</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-2xl font-bold">{accounts.length} Active</p>
    {accounts.map(a => (
      <div key={a.id} className="flex justify-between">
        <span>{a.label}</span>
        <span>{formatCurrency(a.balanceMinor, a.currency)}</span>
      </div>
    ))}
    {hasDiscrepancy && <Badge variant="destructive">Discrepancy</Badge>}
  </CardContent>
</Card>
```

#### 12c. Escrow Accounts admin page

Create a new page at `/dashboard/admin/escrow-accounts`:

| Column | Description |
|--------|-------------|
| Label | Human-readable name (e.g. "UK GBP Escrow") |
| Bank | Bank name |
| Country | ISO country code |
| Currency | GBP / SAR |
| Shadow Balance | `formatCurrency(balanceMinor, currency)` |
| Locked Instruments | Count of `PaymentInstrument` rows linked to this account |
| Locked Amount | Sum of locked instrument amounts |
| Last Reconciled | Timestamp of latest reconciliation run |
| Recon Status | Badge: Balanced (green) / Discrepancy (red) / Never Run (grey) |

Clicking a row opens a detail view showing:
- Account metadata
- Linked instruments table (paginated)
- Recent reconciliation reports with `expectedBalance`, `actualBalance`, `discrepancy`

#### 12d. Per-account reconciliation view

Update the existing reconciliation page (`/dashboard/admin/reconciliation`) to:

1. **Add an escrow account filter** — dropdown to select an escrow account (or "All")
2. **Show per-account reconciliation rows** — each row tagged with the escrow account label and currency
3. **Per-account balance comparison** — expected (sum of locked) vs actual (shadow balance from `EscrowAccount.balanceMinor`)
4. **Currency-aware formatting** — all amounts use `formatCurrency(amount, currency)` instead of defaulting to GBP

```tsx
// Reconciliation row
<TableRow>
  <TableCell>{report.escrowAccount.label}</TableCell>
  <TableCell>{report.escrowAccount.currency}</TableCell>
  <TableCell>{formatCurrency(report.expectedBalanceMinor, report.currency)}</TableCell>
  <TableCell>{formatCurrency(report.actualBalanceMinor, report.currency)}</TableCell>
  <TableCell>
    <Badge variant={report.discrepancy === 0 ? 'default' : 'destructive'}>
      {formatCurrency(report.discrepancy, report.currency)}
    </Badge>
  </TableCell>
</TableRow>
```

#### 12e. Admin dashboard — Volume by Currency

Replace the single "Total Volume" card with a per-currency breakdown:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Volume by Currency</CardTitle>
  </CardHeader>
  <CardContent>
    {Object.entries(stats.volumeByCurrency).map(([currency, amount]) => (
      <div key={currency} className="flex justify-between">
        <span>{currency}</span>
        <span className="text-2xl font-bold">{formatCurrency(amount, currency)}</span>
      </div>
    ))}
  </CardContent>
</Card>
```

Same treatment for the "Platform Fees" card → show `feesByCurrency` breakdown.

#### 12f. Add admin nav link

Add "Escrow Accounts" to the admin sidebar navigation (alongside existing "Reconciliation" link).

#### Files Changed
- `backend/src/admin/admin.controller.ts` — new escrow endpoints
- `backend/src/admin/admin.service.ts` — escrow queries + per-currency stats
- `backend/src/admin/admin.module.ts` — import PrismaModule if not already
- New: `frontend/src/app/dashboard/admin/escrow-accounts/page.tsx`
- `frontend/src/app/dashboard/admin/page.tsx` — escrow summary card + volume by currency
- `frontend/src/app/dashboard/admin/reconciliation/page.tsx` — per-account filter + currency formatting
- `frontend/src/app/dashboard/layout.tsx` — admin nav link for escrow accounts
- `frontend/src/lib/api.ts` — `EscrowAccountSummary` type + fetch functions

---

## Step Dependency Graph

```
Step 1 (Schema)
  ├── Step 2 (Shared package) — independent, can run in parallel
  │
  ├── Step 3 (Backend propagation) — depends on Step 1
  │     ├── Step 4 (Aggregations) — depends on Step 3
  │     ├── Step 5 (Fraud thresholds) — depends on Step 3
  │     └── Step 10 (Evidence/Ledger) — depends on Step 3
  │
  ├── Step 11 (Escrow Account) — depends on Step 1; can run in parallel with Steps 2–5
  │     └── Step 4c (Reconciliation per-account) — depends on Step 11
  │
  ├── Step 6 (API naming) — depends on Steps 1 + 2
  │     └── Step 7 (Frontend formatCurrency) — depends on Step 6
  │           └── Step 8 (Money component) — depends on Step 7
  │
  └── Step 12 (Admin Escrow UI) — depends on Steps 4, 7, 11
        ├── 12a–12b (Backend endpoints + dashboard card)
        ├── 12c (Escrow Accounts page)
        ├── 12d (Per-account reconciliation view)
        └── 12e–12f (Volume by currency + nav link)

Step 9 (Tests) — runs after all other steps
```

**Recommended execution order:** 1 → 2 → 3 → 11 → 6 → 4 → 5 → 10 → 7 → 8 → 12 → 9

---

## File Impact Summary

| Layer | Files Modified | Files Created |
|-------|---------------|---------------|
| Schema/Migration | 1 | 2 migrations |
| Shared Package | 3 | 0 |
| Backend Services | ~15 | 1 (`escrow-routing.service.ts`) |
| Backend Controllers | ~9 | 0 |
| Frontend Types | 1 (`api.ts`) | 0 |
| Frontend Pages | ~14 | 2 (`money.tsx`, `escrow-accounts/page.tsx`) |
| Tests | ~17 | 0 |
| **Total** | **~60** | **5** |

---

## Out of Scope (Future Work)

| Item | Reason |
|------|--------|
| **FX conversion** | No cross-currency trades in v1 |
| **Currency selection by user** | Currency is derived from org jurisdiction, not user-chosen |
| **Onboarding currency setup** | Onboarding flow to be addressed separately; for now org currency is set at registration based on jurisdiction |
| **Additional currencies (AED, USD, EUR)** | Add to `Currency` enum when expanding to those markets |
| **User.balance per-currency** | Currently `User.balance` is simulated; would need `UserBalance` join table for multi-currency wallets |
| **Real bank balance sync** | `EscrowAccount.balanceMinor` is a shadow balance; real-time sync from bank APIs deferred until production bank integration |
| **Multiple escrow accounts per currency** | Schema uses `@@unique([country, currency])`; if multiple bank accounts per currency are needed, relax the constraint later |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| API breaking change (`*Pennies` → `*Minor`) | Deploy backend + frontend simultaneously; both controlled by us |
| Migration on production data | Migration uses `@default(GBP)` + back-fill SQL; safe for existing rows |
| Test count may temporarily drop | Run tests after each step; fix before proceeding |
| Admin stats format change | Admin UI is internal-only; coordinate with any dashboards/exports |

---

## Success Criteria

- [ ] Every `Int` monetary column in the schema has a companion `Currency` column
- [ ] All `currency` columns use the Prisma `Currency` enum (not `String`)
- [ ] No `formatCurrency()` call exists without an explicit currency argument
- [ ] No hardcoded `£` or `GBP` in user-facing strings
- [ ] Admin aggregates display per-currency breakdowns
- [ ] Fraud thresholds and PO limits are currency-specific
- [ ] All 431+ tests pass with multi-currency support
- [ ] SAR transactions render correctly end-to-end (PO → lock → settlement → UI)
- [ ] API field names use `*Minor` (not `*Pennies`)
- [ ] `EscrowAccount` model exists with one active account per country+currency
- [ ] Every `PaymentInstrument` links to an `EscrowAccount` via `escrowAccountId`
- [ ] Reconciliation runs per escrow account, not globally
- [ ] Trust Envelope includes escrow account details (bank, country, currency)
- [ ] Seed data creates escrow accounts for GB/GBP and SA/SAR
- [ ] Admin dashboard shows escrow accounts summary card with per-currency balances
- [ ] Dedicated `/dashboard/admin/escrow-accounts` page lists all escrow accounts with balance, instrument count, and recon status
- [ ] Reconciliation page supports per-escrow-account filtering with currency-aware formatting
- [ ] Admin "Total Volume" and "Platform Fees" cards show per-currency breakdowns (no hardcoded £ or GBP)
