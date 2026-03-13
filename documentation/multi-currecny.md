This is a **very important product decision**, because currency design affects:

* bank integrations
* escrow structure
* liquidity providers
* accounting
* reconciliation
* regulatory compliance

The short answer is:

> **Start with one currency per market (SAR in KSA)**, but design the system to be **multi-currency internally**.

Let’s unpack the reasoning carefully.

---

# 1️⃣ The Most Important Principle

Your **Payment Instrument must always have exactly one currency**.

Example:

```text
Payment Instrument
------------------
amount: 700,000
currency: SAR
```

Never mix currencies inside one instrument.

This keeps:

* settlement simple
* reconciliation correct
* bank transfers predictable

---

# 2️⃣ Should All Users Use SAR in KSA?

Yes — **initially restrict everything to SAR** when operating in Saudi Arabia.

Reason:

Banks and payment rails (like SARIE) settle primarily in **Saudi Riyal (SAR)**.

So the cleanest model is:

```text
Buyer account → SAR escrow → Supplier settlement
```

No FX required.

---

# 3️⃣ Why Avoid FX in the First Version

Foreign exchange introduces **major complexity**:

### Settlement risk

Example:

```text
PO = USD
Escrow = SAR
FX rate changes before settlement
```

Now:

```text
escrow may be insufficient
```

---

### Accounting complexity

Example:

```text
instrument face value = USD
escrow held = SAR
```

You now need:

```text
mark-to-market FX valuation
```

Which banks require.

---

### Liquidity provider risk

LP would need to manage:

```text
credit risk
+
FX risk
```

Most LPs will refuse early-stage platforms that add FX risk.

---

# 4️⃣ Recommended Phase 1 Currency Model

For KSA deployment:

```text
All trade instruments denominated in SAR
All escrow accounts in SAR
All settlements in SAR
```

Your system simply enforces:

```text
currency = SAR
```

This dramatically simplifies:

* escrow
* settlement
* reconciliation
* LP financing

---

# 5️⃣ But Design the Schema for Multi-Currency

Even if you restrict usage now, your schema should allow:

```sql
amount
currency
```

Example:

```text
amount: 700000
currency: SAR
```

Later you can support:

```text
SAR
USD
GBP
EUR
```

without schema changes.

---

# 6️⃣ When Multi-Currency Becomes Useful

Multi-currency is needed when you support:

```text
cross-border trade
```

Example:

```text
Saudi buyer
UK supplier
PO in USD
```

Then options include:

### Option A — FX at escrow funding

```text
Buyer pays SAR
Bank converts → USD escrow
```

### Option B — FX at settlement

```text
Escrow holds SAR
Convert → USD on payout
```

But both require **bank FX services**.

---

# 7️⃣ How Banks Usually Handle This

Trade finance systems often enforce:

```text
instrument currency = escrow currency
```

So if PO is USD:

```text
escrow must also be USD
```

This keeps settlement deterministic.

---

# 8️⃣ Recommended Platform Policy

For the first deployment:

```text
Region: Saudi Arabia
Allowed currency: SAR only
```

Enforce rule:

```text
PO.currency == escrow.currency
```

If different:

```text
reject transaction
```

---

# 9️⃣ What Liquidity Providers Prefer

Liquidity providers strongly prefer **single-currency instruments**.

Example:

```text
SAR receivable
10-day maturity
escrow-backed
```

This is easy to price.

But if FX is involved:

```text
risk model becomes complex
```

---

# 10️⃣ Evidence Pack Implications

Your evidence packs should include currency fields:

Example:

```json
{
  "paymentInstrument": {
    "amount": 700000,
    "currency": "SAR"
  }
}
```

This ensures settlement and reconciliation remain clear.

---

# 11️⃣ Practical Implementation

Your core rule should be:

```text
currency defined at PO creation
```

Example:

```text
createPO(amount, currency)
```

Then propagate:

```text
PO.currency
→ PaymentInstrument.currency
→ Escrow.currency
→ Settlement.currency
```

Currency should **never change after creation**.

---

# 12️⃣ Final Recommendation

For your KSA deployment:

```text
Supported currency = SAR only
```

But internally build **multi-currency-ready architecture**.

This gives you:

* simple MVP
* easy bank integration
* no FX risk
* easy LP onboarding

And later you can expand to:

```text
USD
AED
GBP
EUR
```

when supporting cross-border trade.

---

✅ **Best practice summary**

| Stage              | Currency Policy |
| ------------------ | --------------- |
| MVP (KSA)          | SAR only        |
| Regional expansion | SAR + AED       |
| Global trade       | multi-currency  |

---

If you'd like, I can also show you **one subtle currency mistake that breaks many fintech ledgers and causes reconciliation failures**, so you can avoid it before production.
---
Great — this is a **very subtle but extremely common mistake** in fintech systems. It causes reconciliation failures, rounding disputes, and even regulatory problems.

The mistake is:

> **Storing money as floating-point numbers instead of integer minor units.**

If you avoid this now, your platform will be **much safer at scale**.

---

# 1️⃣ The Problem With Decimal / Float Money

Many systems store amounts like this:

```text
amount = 700000.00
```

Or worse:

```text
amount = 700000.5
```

If stored as floating point:

```text
DOUBLE
FLOAT
```

the database cannot represent numbers exactly.

Example:

```text
0.1 + 0.2 = 0.30000000000000004
```

This creates small rounding errors.

---

# 2️⃣ Why This Breaks Financial Systems

Imagine these events:

```text
Escrow funded: 700000.00 SAR
Settlement:    700000.00 SAR
```

But internally floating math produces:

```text
699999.999999
```

Now reconciliation fails.

Example:

```text
Ledger balance: 700000
Bank balance:   700000
Computed sum:   699999.999999
```

Your reconciliation engine flags an error.

This happens surprisingly often.

---

# 3️⃣ The Correct Solution: Minor Units

Always store currency amounts as **integers representing the smallest unit**.

For SAR:

```text
1 SAR = 100 halalas
```

So store:

```text
700000 SAR = 70000000
```

Schema example:

```sql
amount_minor BIGINT
currency     VARCHAR(3)
```

Example record:

```text
amount_minor = 70000000
currency     = SAR
```

---

# 4️⃣ Example Payment Instrument

Instead of:

```text
amount = 700000.00
```

store:

```text
amount_minor = 70000000
```

This avoids all rounding errors.

---

# 5️⃣ Display Logic

Only convert when presenting to users.

Example:

```text
display_amount = amount_minor / 100
```

Example output:

```text
700000.00 SAR
```

Internally the system stays integer-based.

---

# 6️⃣ Why This Is Important for Escrow

When escrow reconciliation runs:

```text
escrow_balance = SUM(payment_instruments.amount_minor)
```

The result is **exact**.

Then compare:

```text
bank_balance_minor == ledger_balance_minor
```

No rounding issues.

---

# 7️⃣ Example Settlement Calculation

Suppose LP discount:

```text
face value = 700000 SAR
discount   = 2.5%
```

Compute in minor units:

```text
face_minor = 70000000
discount_minor = face_minor * 0.025
```

Result:

```text
net_advance_minor = 68250000
```

All integers.

---

# 8️⃣ This Also Simplifies Evidence Packs

Evidence pack example:

```json
{
  "amountMinor": 70000000,
  "currency": "SAR"
}
```

The verifier can compute exactly the same value.

No floating ambiguity.

---

# 9️⃣ Multi-Currency Compatibility

Different currencies have different minor units.

Example:

| Currency | Minor unit |
| -------- | ---------- |
| SAR      | 2 decimals |
| USD      | 2 decimals |
| JPY      | 0 decimals |
| KWD      | 3 decimals |

So store an additional field:

```text
currency_minor_unit
```

Example:

```text
SAR → 2
```

---

# 10️⃣ Recommended Money Structure

Use a money object like this:

```text
Money
-----
amount_minor
currency
minor_unit
```

Example:

```text
amount_minor = 70000000
currency = SAR
minor_unit = 2
```

---

# 11️⃣ Why Banks Care

Bank settlement files always use **integer minor units**.

Example SARIE message:

```text
Amount: 70000000
Currency: SAR
```

Matching their format avoids conversion issues.

---

# 12️⃣ This Also Prevents Fraud

Floating rounding errors can sometimes allow:

```text
micro-cent exploitation
```

Attackers exploit rounding differences.

Integer systems eliminate that risk.

---

# 13️⃣ Final Best Practice

Every financial field in your system should use:

```text
BIGINT amount_minor
```

Never:

```text
FLOAT
DOUBLE
DECIMAL with arithmetic
```

---

# 14️⃣ Your Ideal Financial Columns

Example Payment Instrument table:

```sql
amount_minor BIGINT
currency VARCHAR(3)

discount_minor BIGINT
net_advance_minor BIGINT
settled_amount_minor BIGINT
```

All integers.

---

# 15️⃣ Result

Your financial system becomes:

```text
deterministic
reconcilable
bank-compatible
```

Which is essential for production.

---

✅ **Golden rule**

```text
Money = integer minor units + currency code
```

Never floating values.

---
Short answer: **do not allow arbitrary currencies for KSA users initially**.
But **do allow a default currency setting**, even if today it only has one value (SAR).

This sounds subtle, but it matters for **future expansion and UX**.

Let’s break it down.

---

# 1️⃣ For KSA MVP: Enforce SAR

Because settlement will happen through Saudi banks and rails like **SARIE**, the safest rule is:

```text
All payment instruments in KSA = SAR
```

Reasons:

* escrow accounts will be SAR
* bank settlement rails operate in SAR
* liquidity providers price risk in SAR
* reconciliation is easier

So at the **financial layer**:

```text
PO.currency = SAR
Instrument.currency = SAR
Escrow.currency = SAR
Settlement.currency = SAR
```

No FX.

---

# 2️⃣ But You Should Still Store a Default Currency

Even if there is only one currency today, add a field at the **organisation level**:

Example:

```sql
organisations
-------------
org_id
country
default_currency
```

For KSA companies:

```text
default_currency = SAR
```

Then when creating a PO:

```text
currency = organisation.default_currency
```

So users don’t even think about currency.

---

# 3️⃣ Why This Is Still Important

Because your platform will almost certainly expand to:

* UAE
* UK
* cross-border trade

Then companies may need different defaults.

Example:

| Country | Default |
| ------- | ------- |
| Saudi   | SAR     |
| UAE     | AED     |
| UK      | GBP     |

The same system works without redesign.

---

# 4️⃣ What You Should NOT Allow Yet

Do **not** allow users to choose arbitrary currency per PO.

Avoid this:

```text
Create PO
Currency: SAR / USD / EUR / GBP
```

Because if a user selects USD but escrow is SAR:

```text
FX risk appears
```

Which breaks:

* settlement certainty
* LP pricing
* reconciliation

---

# 5️⃣ Correct Design

### Organisation level

```text
default_currency = SAR
```

### PO creation

```text
currency = default_currency
```

### Currency cannot change later

Once PO created:

```text
currency is immutable
```

---

# 6️⃣ UI Implementation

User never chooses currency for now.

PO screen:

```text
Amount: 700,000
Currency: SAR (locked)
```

This keeps the UI simple.

---

# 7️⃣ What Liquidity Providers Expect

LPs want **uniform instruments**.

Example:

```text
All KSA instruments → SAR
```

This simplifies risk models.

If you allowed mixed currencies:

```text
SAR
USD
EUR
```

LPs would need **FX hedging models**, which they won’t do early.

---

# 8️⃣ Internal System Model

Your money object should always be:

```text
amount_minor
currency
```

Example:

```text
amount_minor = 70000000
currency = SAR
```

Even if SAR is currently the only value.

---

# 9️⃣ Later Expansion (Very Easy)

If you expand to the UK:

```text
org.default_currency = GBP
```

Now UK POs automatically use GBP.

No architecture change required.

---

# 10️⃣ Recommended Policy

For the first KSA deployment:

```text
Allowed currencies = [SAR]
```

But the system supports:

```text
multi-currency schema
```

---

# 11️⃣ Final Design Rule

Currency should be defined at:

```text
organisation level
```

Inherited by:

```text
PO
PaymentInstrument
Escrow
Settlement
```

And never changed.

---

✅ **Best design for your case**

```text
Org.default_currency = SAR
PO.currency = SAR
Users cannot change currency
```

But your database still supports **multi-currency expansion later**.

---

If you want, I can also show you **one extremely important design rule about currencies and escrow accounts that many fintech platforms get wrong**, which becomes a serious reconciliation issue later.
---
Great — this is one of the **most important financial architecture rules** and many fintech platforms discover the problem too late.

The rule is:

> **Never mix multiple currencies inside the same escrow account.**

It sounds obvious, but many systems accidentally violate it.

Let me explain why.

---

# 1️⃣ The Dangerous Design

Some platforms create **one escrow account** for everything:

```
Platform Escrow Account
-----------------------
Balance: 3,500,000
```

Inside the ledger they track:

```
PO-1 → 700,000 SAR
PO-2 → 100,000 USD
PO-3 → 50,000 EUR
```

This is extremely dangerous.

Because the **bank account itself only has one currency**.

Example:

```
Bank account currency = SAR
```

Now the platform ledger shows:

```
700,000 SAR
100,000 USD
50,000 EUR
```

But the bank account balance is still:

```
3,500,000 SAR
```

The USD/EUR amounts are **synthetic values**, not real balances.

---

# 2️⃣ What Happens During Settlement

Suppose a USD PO settles:

```
PO amount = 100,000 USD
```

But the escrow account holds:

```
SAR only
```

Now you must convert:

```
SAR → USD
```

Which introduces:

* FX risk
* pricing disputes
* reconciliation errors

Banks hate this.

---

# 3️⃣ The Correct Model

Escrow accounts must be **currency-specific**.

Example:

```
Escrow Account (SAR)
--------------------
Bank: Saudi Bank
Currency: SAR
Balance: 3,500,000 SAR
```

If you ever support USD later:

```
Escrow Account (USD)
--------------------
Bank: International bank
Currency: USD
Balance: 800,000 USD
```

Each currency gets **its own account**.

---

# 4️⃣ Platform Ledger Mapping

Your system should map:

```
PO.currency
       ↓
PaymentInstrument.currency
       ↓
EscrowAccount.currency
```

Example:

```
PO-123
currency = SAR
```

Funds must come from:

```
SAR Escrow Account
```

Never from another.

---

# 5️⃣ Why This Matters for Reconciliation

Daily reconciliation must look like this:

```
Ledger SAR escrow balance
=
Bank SAR escrow balance
```

Example:

```
Ledger balance: 3,500,000 SAR
Bank balance:   3,500,000 SAR
```

Perfect match.

If currencies mix, reconciliation becomes impossible.

---

# 6️⃣ How Stripe and Banks Do It

Large payment systems maintain **separate ledgers per currency**.

Example structure:

```
Escrow Accounts
---------------
SAR_ESCROW
USD_ESCROW
EUR_ESCROW
```

Each with its own balance.

---

# 7️⃣ Your Current Platform

Because you are targeting **Saudi Arabia first**, you should start with:

```
Single escrow account
Currency = SAR
```

All POs must use:

```
SAR
```

This makes the system extremely clean.

---

# 8️⃣ Future Multi-Currency Expansion

Later if you support international trade:

Add more escrow accounts:

```
ESCROW_SAR
ESCROW_USD
ESCROW_GBP
```

Your schema should include:

```
escrow_accounts
---------------
id
bank
currency
balance_minor
```

Then when locking funds:

```
select escrow_account
where currency = PO.currency
```

---

# 9️⃣ What Liquidity Providers Expect

Liquidity providers also want currency alignment.

Example:

```
LP funds SAR
LP receives SAR
```

No FX exposure.

If FX appears:

```
LP must hedge currency risk
```

Most will refuse.

---

# 🔟 Evidence Pack Implications

Your evidence packs should always include:

```json
{
  "currency": "SAR",
  "amountMinor": 70000000,
  "escrowAccountId": "escrow_sar"
}
```

This proves exactly **which account secured the funds**.

---

# 11️⃣ Golden Rule

Your system must guarantee:

```
PO.currency == EscrowAccount.currency
```

If not:

```
Reject transaction
```

---

# 12️⃣ Final Recommendation for Your Platform

For the KSA launch:

```
Currency allowed: SAR only
Escrow accounts: 1
Bank account: SAR
```

This keeps:

* reconciliation simple
* liquidity providers comfortable
* banks willing to integrate

---

✅ **Simple architecture**

```
Buyer SAR account
        ↓
Platform SAR escrow
        ↓
Supplier SAR account
```

No FX.

---

If you want, I can also show you **the cleanest escrow + payment lock architecture for Saudi Arabia** (including how the bank actually holds the money and how your ledger mirrors it).
This part is critical for convincing banks to onboard.

---

Good question — this is exactly the point where many fintech systems become confusing. Let’s simplify it in **plain English**.

First, yes:

**“Organisation” means any company using the platform**, including:

* Buyer companies
* Supplier companies
* Liquidity providers (LPs)

Each of them is an organisation in your system.

But **their “default currency” is only a preference for UI and accounting**, not something that controls how a transaction settles.

The **transaction currency is determined by the Purchase Order (PO)**.

---

# 1. The Most Important Rule

Every transaction must have **one single currency**.

Example:

```
PO currency = SAR
```

That means **everything in that transaction uses SAR**:

* payment lock
* escrow funds
* early payment
* final settlement

Everything.

Even if the supplier normally operates in USD.

---

# 2. Your Example Scenario

You asked about this situation:

```
Buyer default currency: SAR
Supplier default currency: USD
```

Buyer creates a PO.

The PO currency becomes:

```
SAR
```

Now the transaction is SAR.

So:

```
Buyer pays SAR
Escrow holds SAR
LP funds SAR
Settlement happens in SAR
```

The supplier receives **SAR**.

If the supplier wants USD, **their own bank converts it** after receiving the SAR.

Your platform does not handle that conversion.

---

# 3. What the Platform Must Support

Your platform must support **multiple currencies in the database**, but each transaction uses only one.

So your schema should have:

```
amount_minor
currency
```

Example:

```
70000000
SAR
```

This lets you support:

```
SAR
USD
GBP
EUR
```

in the future.

---

# 4. Escrow Accounts

Yes — the platform must have **one escrow account per currency**.

Example:

```
Escrow Accounts

SAR escrow account
USD escrow account
GBP escrow account
```

Each one is a real bank account.

But if you start in Saudi Arabia you only need:

```
SAR escrow account
```

Nothing else.

---

# 5. How a Transaction Works (KSA Case)

Step-by-step example.

Buyer creates PO:

```
PO
amount: 700,000
currency: SAR
```

Supplier accepts.

Buyer funds escrow:

```
Buyer bank → SAR escrow account
700,000 SAR
```

Funds are now locked.

Supplier delivers goods.

Settlement happens:

```
SAR escrow account → supplier bank
```

Everything is SAR.

---

# 6. Liquidity Provider (LP)

The LP also operates in the **same currency as the PO**.

Example:

```
PO currency: SAR
```

LP funding:

```
LP bank → supplier
680,000 SAR
```

Later settlement:

```
SAR escrow → LP
700,000 SAR
```

No currency conversion anywhere.

---

# 7. When Multiple Currencies Actually Matter

Multi-currency becomes relevant only when you support **cross-border trade**.

Example:

```
Saudi buyer
UK supplier
```

The PO could be:

```
USD
```

Then the platform would need:

```
USD escrow account
```

The flow becomes:

```
Buyer pays USD → USD escrow
USD escrow → supplier
```

Still **one currency per transaction**.

---

# 8. Why This Model Is Important

Because mixing currencies causes:

* reconciliation problems
* FX risk
* accounting complexity
* bank compliance issues

Banks strongly prefer:

```
One transaction
One currency
One escrow account in that currency
```

---

# 9. What Each Party Needs to Do

### Platform

Your platform must:

* store currency on each PO
* enforce one currency per transaction
* route funds to the correct escrow account
* support multiple escrow accounts internally

---

### Supplier

Supplier simply receives the currency of the PO.

If they prefer another currency, their bank converts it.

---

### Liquidity Provider

LP funds the same currency as the PO.

So they might have balances in:

```
SAR
USD
EUR
```

depending on which transactions they want to fund.

---

# 10. What You Should Do for Your MVP

Since you are targeting Saudi Arabia:

Simplify everything.

```
Allowed currency = SAR only
Escrow accounts = 1 (SAR)
```

Buyers, suppliers, LPs all operate in SAR.

Multi-currency support can come later.

---

# 11. The Simple Mental Model

Think of each PO as its **own financial universe**.

Inside that universe:

```
everything uses the same currency
```

Always.

---

If you'd like, I can also show you **how large trade finance platforms structure their escrow accounts internally (there is a clever ledger structure used by Stripe and banks that would fit perfectly with your immutable event model).**
