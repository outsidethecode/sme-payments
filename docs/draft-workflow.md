# The **Exact Workflow** in the Proposed Approach

Think of this as **procurement-to-pay with optional instant liquidity**, not “investment”.

Below is the **canonical workflow** you should describe — this is what reviewers need to clearly “see”.

---

## 1. Buyer creates a Digital Purchase Order (PO)

**Who:** SME Buyer
**In the app:**

* Buyer selects supplier
* Defines:

  * Item / service
  * Amount (£5k–£250k typical)
  * Delivery or milestone conditions
  * Acceptance window (e.g. 48 hours)

**What’s new vs today**

* Payment conditions are defined *before* work starts
* No invoice guessing later

**Output**

* A **digitally verifiable PO** (this is the root object)

---

## 2. Buyer pre-authorises payment (but does NOT pay yet)

**Who:** SME Buyer
**In the app:**

* Buyer authorises funds via Open Banking / Faster Payments
* Funds are:

  * Ring-fenced / escrowed
  * Cannot be withdrawn
  * Cannot be delayed once conditions are met

**Key innovation**

* This is **not a deposit**
* It is a **binding payment commitment**

**Output**

* A **locked payment promise** tied to the PO

---

## 3. Supplier accepts the PO and starts work

**Who:** SME Supplier
**In the app:**

* Supplier sees:

  * Guaranteed payment
  * Clear acceptance conditions
  * Optional “Get paid early” option

At this point:

* No invoice
* No credit risk
* No chasing finance teams

---

## 4. Optional: Supplier requests early payment (liquidity)

This is the *only* branching point in the flow.

### Option A – No early payment

* Supplier waits
* Gets paid automatically on acceptance
* End of story

### Option B – Supplier requests early payment

* Supplier clicks **“Get paid now”**
* System shows:

  * Amount
  * Fee (e.g. 1.5–3%)
  * Net received today

This is **not a loan**
This is **not factoring**
This is **a sale of a pre-verified receivable**

---

## 5. Liquidity provider funds the supplier

**Who:** Liquidity partner (initially simulated / institutional)

Mechanically:

* Platform advances cash to supplier
* In return:

  * Liquidity provider receives the locked payment right
  * Buyer still pays full amount later
  * Platform orchestrates settlement

**Why this is safe**

* Payment is already authorised
* Conditions are explicit
* Dispute surface is tiny
* No SME credit underwriting required

---

## 6. Delivery / milestone verification

**Who:** Supplier + Buyer (or delivery agent)

Verification can be:

* Buyer confirmation
* QR scan
* Timestamped acceptance
* Milestone approval click

This triggers:

* Automatic release of funds

---

## 7. Final settlement

### If no early payment

* Funds move:

  * Buyer → Supplier
* Automatically
* Same day

### If early payment occurred

* Funds move:

  * Buyer → Liquidity provider
* Supplier already paid
* Transaction closes cleanly

---

## 8. Platform fees & audit trail

**Platform earns via:**

* Transaction fee
* Optional early-pay facilitation fee

**Everyone gets:**

* Immutable audit trail
* Clear compliance artefacts
* Payment certainty

---

# Now the critical question:

## ❓ Do we have **crowdfunding investors**?

### Short answer: **NO — not in this challenge**

### Longer, strategic answer: **Not initially, and you should not mention it**

---

## Why crowdfunding investors are a BAD idea for this challenge

### 1. Regulatory red flags 🚩

The moment you say:

* “Crowdfunding”
* “Retail investors”
* “Marketplace returns”

Reviewers will think:

* FCA authorisation
* Consumer protection
* Suitability checks
* Risk disclosures
* Delays

That’s fatal for a £50k innovation challenge.

---

### 2. SMEs do NOT want “investors” involved

From an SME user perspective:

* They want to:

  * Get paid
  * Move on
* They do **not** want:

  * Their invoices “auctioned”
  * Random investors touching their cashflow

Embedded finance must feel **boring and invisible**.

---

### 3. The challenge wants **liquidity**, not an investment platform

The wording is very deliberate:

> “embedded low-cost liquidity products such as trade finance”

Not:

* Investment opportunities
* Yield platforms
* Crowd returns

They want:

* Faster payment
* Lower cost
* Less friction

---

## So who provides liquidity instead?

### Phase 1 (Challenge MVP)

* **Single liquidity partner (simulated or institutional)**
* Could be:

  * Bank
  * Fintech lender
  * Balance-sheet provider
  * Even a platform-held float

You do NOT need to name them.

You say:

> “Liquidity is provided by regulated partners via API.”

That’s it.

---

### Phase 2 (post-challenge, optional)

Only later — and **not in this bid** — you *could* explore:

* Wholesale capital markets
* Institutional funds
* Invoice securitisation
* Programmable money (CBDC)

Crowdfunding still optional — but **not central**.

---

## How to phrase this safely in the application

Use this exact language (or close to it):

> “Where suppliers require earlier access to cash, the platform enables embedded early payment funded by regulated liquidity partners, using pre-verified payment commitments rather than traditional invoice credit.”

This avoids:

* “Investors”
* “Marketplace”
* “Crowd”

But preserves your **core economic insight**.

---

## Final sanity check

What you are building is:

✅ Procurement tool
✅ Payment orchestration layer
✅ Verification engine
✅ Embedded finance rail

What you are **not** building (for this challenge):

❌ DeFi platform
❌ Investment marketplace
❌ Crowdfunding app
❌ CBDC dependency

-----


# 1. What do we mean by **liquidity** (in this context)?

**Liquidity = cash available *now***
Not profit. Not credit limits. Not promises.

For an SME supplier:

* They have **earned** £25,000
* But they will **receive** it in 30–60 days
* In the meantime they:

  * Can’t pay staff
  * Can’t buy materials
  * Can’t take the next order

So liquidity means:

> **Turning a guaranteed future payment into usable cash today**

That’s it. No jargon.

---

# 2. Who is the **regulated liquidity partner**?

A regulated liquidity partner is a **financial institution already authorised to advance money** against predictable cashflows.

Examples (conceptual, not endorsements):

* UK banks offering supply-chain finance
* Fintechs offering early-pay / invoice finance
* Challenger banks with working capital products
* Payment providers with balance-sheet lending

They already:

* Move money
* Assess risk
* Hold regulatory permissions

Your platform does **not** become a lender.

---

# 3. What’s new here vs traditional invoice finance?

Traditional invoice finance:

* Happens **after** invoicing
* Depends on:

  * Buyer creditworthiness
  * Manual checks
  * Dispute risk
* Costs 5–15%

Your approach:

* Happens **before** work starts
* Payment is:

  * Pre-authorised
  * Condition-locked
  * Automatically released
* Risk is dramatically lower
* Cost drops to ~1–3%

Why? Because the uncertainty is removed.

---

# 4. The exact mechanics (step-by-step)

Let’s walk through a **realistic SME example**.

---

## Example: UK SME supplying services

### Parties

* **Buyer:** Mid-size UK retailer
* **Supplier:** Small logistics firm
* **Liquidity Partner:** Regulated fintech lender
* **Platform:** Your procurement-to-pay system

---

## Step 1: Buyer issues a £20,000 purchase order

In your app, the buyer defines:

* Service: 2 weeks logistics support
* Amount: £20,000
* Acceptance condition: “Buyer confirmation”
* Acceptance window: 48 hours

This is a **digitally signed PO**.

---

## Step 2: Buyer pre-authorises payment

Via Open Banking:

* £20,000 is **ring-fenced**
* Buyer cannot cancel or delay once conditions are met
* Funds remain in buyer’s account until release

Key point:

> The money exists and is reserved — it’s just waiting.

---

## Step 3: Supplier starts work

Supplier sees in the app:

* “Payment guaranteed”
* “Get paid early: £19,500 today”

They now have a choice.

---

## Step 4: Supplier requests early payment

Supplier clicks:

> **“Get paid now”**

The system shows:

* Face value: £20,000
* Early-pay fee: £500 (2.5%)
* Cash today: £19,500

Supplier accepts.

---

## Step 5: Liquidity partner advances funds

Here’s the critical bit.

### What the liquidity partner actually does:

* Transfers **£19,500** to the supplier **today**
* In return, they receive:

  * The **right to receive the £20,000** when the buyer accepts

This is **not** a loan:

* No repayment schedule
* No SME debt
* No interest compounding

It’s a **purchase of a payment right**.

---

## Step 6: Work is completed and verified

Supplier finishes work.

Buyer:

* Confirms completion in the app
* Or does nothing → auto-accept after 48 hours

This triggers payment release.

---

## Step 7: Buyer’s money settles

* £20,000 moves from buyer’s account
* Goes **directly to the liquidity partner**

The transaction closes.

---

## Step 8: Everyone’s outcome

### Supplier

* Got £19,500 immediately
* No debt
* No chasing
* Cashflow problem solved

### Buyer

* Paid exactly what they expected
* No admin
* No invoice disputes

### Liquidity partner

* Put up £19,500
* Received £20,000
* Earned £500 in ~14 days
* Extremely low risk

### Platform

* Took facilitation fee
* Created economic value
* No balance-sheet exposure

---

# 5. Why this is **safe** for the liquidity partner

This is key — reviewers will ask.

Risk is low because:

1. **Funds are pre-authorised**

   * Buyer can’t “disappear”

2. **Conditions are explicit**

   * No vague invoice terms

3. **Verification is digital**

   * Fewer disputes

4. **Time to settlement is short**

   * Days, not months

This is closer to:

> “Payment orchestration”
> than
> “SME lending”

---

# 6. What you are NOT doing (important for regulation)

You are NOT:

* Taking deposits
* Lending your own money
* Assessing SME creditworthiness
* Offering investments
* Holding customer funds long-term

You are:

> **Coordinating verified payment flows and connecting to licensed capital.**

This keeps:

* FCA scope minimal
* Partner onboarding realistic
* Challenge reviewers comfortable

---

# 7. How to describe this cleanly in the application

Use this wording (or very close):

> “Where suppliers require earlier access to cash, the platform enables early settlement of pre-authorised payments through regulated liquidity partners. These partners advance funds against digitally verified payment commitments, enabling same-day liquidity without increasing SME debt.”

That sentence alone does a lot of work.

---

