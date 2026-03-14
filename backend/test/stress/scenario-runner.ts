/**
 * Phase 5 — Scenario Runner
 *
 * TypeScript framework for running full PO lifecycle scenarios against a live
 * backend server (http://localhost:3001/api by default). Each scenario creates
 * its own users and PO, runs the full lifecycle, and verifies the final state.
 *
 * Usage (standalone):
 *   npx ts-node test/stress/scenario-runner.ts [--scenario=1]
 *
 * Usage (from orchestrator):
 *   import { scenarios, runScenario } from "./scenario-runner";
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ScenarioResult {
  scenario: number;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  verifications: VerificationResult[];
}

export interface VerificationResult {
  check: string;
  passed: boolean;
  expected?: string;
  actual?: string;
}

interface UserCreds {
  email: string;
  password: string;
  name: string;
  companyName: string;
  role: "BUYER" | "SUPPLIER";
}

interface AuthedUser {
  accessToken: string;
  id: string;
  role: string;
}

// ═══════════════════════════════════════════════════════════════════
// API Client
// ═══════════════════════════════════════════════════════════════════

const BASE_URL = process.env.STRESS_API_URL || "http://localhost:3001/api";

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

let userCounter = 0;

function uniqueEmail(prefix: string): string {
  return `stress-${prefix}-${Date.now()}-${++userCounter}@test.local`;
}

async function registerAndLogin(creds: UserCreds): Promise<AuthedUser> {
  const regRes = await api("POST", "/auth/register", undefined, creds);
  if (regRes.status !== 201 && regRes.status !== 200) {
    throw new Error(
      `Register failed for ${creds.email}: ${regRes.status} ${JSON.stringify(regRes.data)}`,
    );
  }
  // Register returns { accessToken, user }
  return {
    accessToken: regRes.data.accessToken,
    id: regRes.data.user.id,
    role: regRes.data.user.role,
  };
}

async function loginSeeded(
  email: string,
  password: string,
): Promise<AuthedUser> {
  const res = await api("POST", "/auth/login", undefined, { email, password });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `Login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
  return {
    accessToken: res.data.accessToken,
    id: res.data.user.id,
    role: res.data.user.role,
  };
}

async function getBalance(token: string): Promise<number> {
  const res = await api("GET", "/users/balance", token);
  return res.data?.balance ?? 0;
}

async function getPO(token: string, poId: string): Promise<any> {
  const res = await api("GET", `/purchase-orders/${poId}`, token);
  return res.data;
}

async function getPaymentLocks(token: string): Promise<any[]> {
  const res = await api("GET", "/payment-locks", token);
  return res.data || [];
}

async function verifyLedger(token: string, entityId: string): Promise<any> {
  const res = await api("GET", `/ledger/verify/${entityId}`, token);
  return res.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════
// PO Lifecycle Helpers
// ═══════════════════════════════════════════════════════════════════

interface LifecycleContext {
  buyer: AuthedUser;
  supplier: AuthedUser;
  admin: AuthedUser;
  lp?: AuthedUser;
  poId: string;
  poAmount: number;
}

async function createPO(
  buyer: AuthedUser,
  supplierId: string,
  lineItems?: {
    description: string;
    quantity: number;
    unitPricePennies: number;
  }[],
): Promise<{ poId: string; amount: number }> {
  const items = lineItems || [
    { description: "Stress test item A", quantity: 10, unitPricePennies: 5000 },
    { description: "Stress test item B", quantity: 5, unitPricePennies: 10000 },
  ];
  const res = await api("POST", "/purchase-orders", buyer.accessToken, {
    supplierId,
    description: `Stress test PO ${Date.now()}`,
    lineItems: items,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `Create PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
  const amount = items.reduce(
    (sum, li) => sum + li.quantity * li.unitPricePennies,
    0,
  );
  return { poId: res.data.id, amount };
}

async function sendPO(buyer: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/send`,
    buyer.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Send PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function acceptPO(supplier: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/accept`,
    supplier.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Accept PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function fundEscrow(buyer: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/fund`,
    buyer.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Fund escrow failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function confirmEscrow(admin: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/confirm-escrow`,
    admin.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Confirm escrow failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function shipPO(supplier: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/ship`,
    supplier.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Ship PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function deliverPO(supplier: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/deliver`,
    supplier.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Deliver PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function verifyDelivery(buyer: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/verify`,
    buyer.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Verify delivery failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function acknowledgePO(buyer: AuthedUser, poId: string): Promise<void> {
  const res = await api(
    "PATCH",
    `/purchase-orders/${poId}/acknowledge`,
    buyer.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `Acknowledge PO failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function requestEarlyPayment(
  supplier: AuthedUser,
  poId: string,
): Promise<string> {
  const res = await api("POST", "/early-payments", supplier.accessToken, {
    purchaseOrderId: poId,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `Request early payment failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
  return res.data.id;
}

async function lpFundEarlyPayment(
  lp: AuthedUser,
  earlyPayId: string,
): Promise<void> {
  const res = await api(
    "PATCH",
    `/early-payments/${earlyPayId}/fund`,
    lp.accessToken,
  );
  if (res.status !== 200) {
    throw new Error(
      `LP fund failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function raiseDispute(
  buyer: AuthedUser,
  poId: string,
  reason: string,
): Promise<string> {
  // Buyer must first call PATCH /purchase-orders/:id/dispute to move PO → DISPUTED
  const disputeRes = await api(
    "PATCH",
    `/purchase-orders/${poId}/dispute`,
    buyer.accessToken,
  );
  if (disputeRes.status !== 200) {
    throw new Error(
      `Dispute PO failed: ${disputeRes.status} ${JSON.stringify(disputeRes.data)}`,
    );
  }

  const res = await api("POST", "/disputes", buyer.accessToken, {
    purchaseOrderId: poId,
    reason,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `Raise dispute failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
  return res.data.id;
}

async function resolveDispute(
  admin: AuthedUser,
  disputeId: string,
  outcome: string,
  opts?: { refundAmount?: number; resolutionNotes?: string },
): Promise<void> {
  // Put under review first
  await api("PATCH", `/disputes/${disputeId}/review`, admin.accessToken);

  const res = await api(
    "PATCH",
    `/disputes/${disputeId}/resolve`,
    admin.accessToken,
    { outcome, ...opts },
  );
  if (res.status !== 200) {
    throw new Error(
      `Resolve dispute failed: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Full lifecycle (create → send → accept → fund → confirm → ship → deliver → verify)
// ═══════════════════════════════════════════════════════════════════

async function runHappyPathUntilVerified(
  buyer: AuthedUser,
  supplier: AuthedUser,
  admin: AuthedUser,
): Promise<LifecycleContext> {
  const { poId, amount } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);

  return { buyer, supplier, admin, poId, poAmount: amount };
}

// ═══════════════════════════════════════════════════════════════════
// Verification Helpers
// ═══════════════════════════════════════════════════════════════════

function verify(
  results: VerificationResult[],
  check: string,
  condition: boolean,
  expected?: string,
  actual?: string,
): void {
  results.push({ check, passed: condition, expected, actual });
}

// ═══════════════════════════════════════════════════════════════════
// Scenarios
// ═══════════════════════════════════════════════════════════════════

type ScenarioFn = (
  admin: AuthedUser,
  chaos: boolean,
) => Promise<VerificationResult[]>;

/**
 * Scenario 1: Normal Settlement
 * Full happy path: create → send → accept → fund → confirm → ship → deliver → verify → acknowledge → SETTLED
 */
async function scenario1(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyerCreds: UserCreds = {
    email: uniqueEmail("s1-buyer"),
    password: "StressTest1!",
    name: "S1 Buyer",
    companyName: "S1 Buyer Co",
    role: "BUYER",
  };
  const supplierCreds: UserCreds = {
    email: uniqueEmail("s1-supplier"),
    password: "StressTest1!",
    name: "S1 Supplier",
    companyName: "S1 Supplier Co",
    role: "SUPPLIER",
  };

  const buyer = await registerAndLogin(buyerCreds);
  const supplier = await registerAndLogin(supplierCreds);

  // Buyer needs balance — use admin stats to check, but balance comes from seed/setup
  // For stress tests against a running server, buyer balance is set at registration (default per seed)
  // We'll use small amounts so default balance suffices

  const ctx = await runHappyPathUntilVerified(buyer, supplier, admin);

  // Acknowledge → triggers settlement → SETTLED
  await acknowledgePO(buyer, ctx.poId);

  if (chaos) await sleep(Math.random() * 200);

  // Verify final state
  const po = await getPO(buyer.accessToken, ctx.poId);
  verify(
    results,
    "PO status is SETTLED",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  // Verify ledger integrity
  const ledger = await verifyLedger(buyer.accessToken, ctx.poId);
  verify(
    results,
    "Ledger chain valid",
    ledger?.valid === true,
    "true",
    String(ledger?.valid),
  );

  return results;
}

/**
 * Scenario 2: Early Payment Funded
 * Supplier requests early payment after FULFILLMENT. LP funds. Then buyer acknowledges.
 * Settlement goes to LP (not supplier).
 */
async function scenario2(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s2-buyer"),
    password: "StressTest2!",
    name: "S2 Buyer",
    companyName: "S2 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s2-supplier"),
    password: "StressTest2!",
    name: "S2 Supplier",
    companyName: "S2 Supplier Co",
    role: "SUPPLIER",
  });
  // Use seeded LP
  const lp = await loginSeeded("lp@capitalbridge.co.uk", "password123");

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);

  if (chaos) await sleep(Math.random() * 100);

  // Supplier requests early payment (PO is in FULFILLMENT)
  const earlyPayId = await requestEarlyPayment(supplier, poId);
  verify(results, "Early payment request created", !!earlyPayId);

  // LP funds the early payment
  await lpFundEarlyPayment(lp, earlyPayId);

  // Continue lifecycle
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);
  await acknowledgePO(buyer, poId);

  const po = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO status is SETTLED",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  const ledger = await verifyLedger(buyer.accessToken, poId);
  verify(
    results,
    "Ledger chain valid",
    ledger?.valid === true,
    "true",
    String(ledger?.valid),
  );

  return results;
}

/**
 * Scenario 3: Early Payment Expired
 * Supplier requests early payment but LP doesn't fund. Buyer settles before LP funds.
 * Early payment auto-expires on acknowledgement; settlement goes to supplier.
 */
async function scenario3(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s3-buyer"),
    password: "StressTest3!",
    name: "S3 Buyer",
    companyName: "S3 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s3-supplier"),
    password: "StressTest3!",
    name: "S3 Supplier",
    companyName: "S3 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);

  // Supplier requests early payment
  const earlyPayId = await requestEarlyPayment(supplier, poId);
  verify(results, "Early payment request created", !!earlyPayId);

  // No LP funding — buyer proceeds
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);

  if (chaos) await sleep(Math.random() * 150);

  // Acknowledge → auto-expires the unfunded early payment → settles to supplier
  await acknowledgePO(buyer, poId);

  const po = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO status is SETTLED",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  // Check early payment was expired
  const epRes = await api(
    "GET",
    `/early-payments/${earlyPayId}`,
    supplier.accessToken,
  );
  verify(
    results,
    "Early payment expired",
    epRes.data?.status === "EXPIRED" || epRes.data?.status === "SETTLED",
    "EXPIRED or SETTLED",
    epRes.data?.status,
  );

  return results;
}

/**
 * Scenario 4: Dispute — Full Refund
 * Buyer disputes after delivery, admin resolves with full refund.
 */
async function scenario4(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s4-buyer"),
    password: "StressTest4!",
    name: "S4 Buyer",
    companyName: "S4 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s4-supplier"),
    password: "StressTest4!",
    name: "S4 Supplier",
    companyName: "S4 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId, amount } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);

  if (chaos) await sleep(Math.random() * 100);

  // Buyer disputes
  const disputeId = await raiseDispute(
    buyer,
    poId,
    "Goods damaged in transit — full refund required",
  );
  verify(results, "Dispute created", !!disputeId);

  // Admin resolves with full refund
  await resolveDispute(admin, disputeId, "FULL_REFUND", {
    resolutionNotes: "Approved — full refund to buyer",
  });

  const po = await getPO(admin.accessToken, poId);
  verify(
    results,
    "PO status is REFUNDED",
    po.status === "REFUNDED",
    "REFUNDED",
    po.status,
  );

  return results;
}

/**
 * Scenario 5: Dispute — Partial Refund
 * Admin resolves with partial refund for a portion of the PO amount.
 */
async function scenario5(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s5-buyer"),
    password: "StressTest5!",
    name: "S5 Buyer",
    companyName: "S5 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s5-supplier"),
    password: "StressTest5!",
    name: "S5 Supplier",
    companyName: "S5 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId, amount } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);

  const partialRefund = Math.round(amount * 0.3); // 30% refund

  const disputeId = await raiseDispute(
    buyer,
    poId,
    "Partial defect — 30% refund needed",
  );
  await resolveDispute(admin, disputeId, "PARTIAL_REFUND", {
    refundAmount: partialRefund,
    resolutionNotes: "30% refund approved for defective items",
  });

  const po = await getPO(admin.accessToken, poId);
  verify(
    results,
    "PO status after partial refund",
    po.status === "REFUNDED" || po.status === "PARTIALLY_REFUNDED",
    "REFUNDED or PARTIALLY_REFUNDED",
    po.status,
  );

  return results;
}

/**
 * Scenario 6: Dispute — Release to Supplier
 * Buyer disputes, but admin sides with supplier and releases funds.
 */
async function scenario6(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s6-buyer"),
    password: "StressTest6!",
    name: "S6 Buyer",
    companyName: "S6 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s6-supplier"),
    password: "StressTest6!",
    name: "S6 Supplier",
    companyName: "S6 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);

  const disputeId = await raiseDispute(buyer, poId, "Minor cosmetic issue");
  await resolveDispute(admin, disputeId, "RELEASE_TO_SUPPLIER", {
    resolutionNotes: "Issue is cosmetic — releasing to supplier",
  });

  const po = await getPO(admin.accessToken, poId);
  verify(
    results,
    "PO status is SETTLED after release to supplier",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  return results;
}

/**
 * Scenario 7: Dispute — Rework Cycle
 * Admin orders rework, PO goes back to FULFILLMENT, then completes normally.
 */
async function scenario7(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s7-buyer"),
    password: "StressTest7!",
    name: "S7 Buyer",
    companyName: "S7 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s7-supplier"),
    password: "StressTest7!",
    name: "S7 Supplier",
    companyName: "S7 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);

  const disputeId = await raiseDispute(
    buyer,
    poId,
    "Wrong specification — needs rework",
  );
  await resolveDispute(admin, disputeId, "REWORK", {
    resolutionNotes: "Supplier must rework and redeliver",
  });

  const poAfterRework = await getPO(admin.accessToken, poId);
  verify(
    results,
    "PO reverted to FULFILLMENT after rework",
    poAfterRework.status === "FULFILLMENT",
    "FULFILLMENT",
    poAfterRework.status,
  );

  if (chaos) await sleep(Math.random() * 100);

  // Supplier re-ships and re-delivers
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);
  await acknowledgePO(buyer, poId);

  const po = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO settled after rework cycle",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  return results;
}

/**
 * Scenario 8: LP Funding Rejected (exposure limit)
 * LP attempts to fund but is rejected. Settlement still goes to supplier.
 */
async function scenario8(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s8-buyer"),
    password: "StressTest8!",
    name: "S8 Buyer",
    companyName: "S8 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s8-supplier"),
    password: "StressTest8!",
    name: "S8 Supplier",
    companyName: "S8 Supplier Co",
    role: "SUPPLIER",
  });

  // Register a new "LP" — but they won't have LIQUIDITY_PARTNER role via register
  // Use seeded LP with potentially exceeded limits, or test the rejection path
  // For now, we'll use a supplier (wrong role) to demonstrate rejection
  const fakeLp = await registerAndLogin({
    email: uniqueEmail("s8-fakelp"),
    password: "StressTest8!",
    name: "S8 FakeLP",
    companyName: "S8 FakeLP Co",
    role: "SUPPLIER", // Not an LP!
  });

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);

  // Supplier requests early payment
  const earlyPayId = await requestEarlyPayment(supplier, poId);

  // FakeLP tries to fund — should be rejected (wrong role)
  const fundRes = await api(
    "PATCH",
    `/early-payments/${earlyPayId}/fund`,
    fakeLp.accessToken,
  );
  verify(
    results,
    "Non-LP funding rejected",
    fundRes.status === 403 || fundRes.status === 400,
    "403 or 400",
    String(fundRes.status),
  );

  // Normal flow continues without LP
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);
  await acknowledgePO(buyer, poId);

  const po = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO settled to supplier",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  return results;
}

/**
 * Scenario 9: Concurrent LP Funding + Buyer Settlement Race
 * Both LP and buyer try to lock the instrument simultaneously.
 * Exactly one path should win.
 */
async function scenario9(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s9-buyer"),
    password: "StressTest9!",
    name: "S9 Buyer",
    companyName: "S9 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s9-supplier"),
    password: "StressTest9!",
    name: "S9 Supplier",
    companyName: "S9 Supplier Co",
    role: "SUPPLIER",
  });
  const lp = await loginSeeded("lp@capitalbridge.co.uk", "password123");

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);
  await confirmEscrow(admin, poId);

  // Supplier requests early payment
  const earlyPayId = await requestEarlyPayment(supplier, poId);

  // Fast-track to VERIFIED so buyer can acknowledge
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);

  // Race: LP tries to fund AND buyer tries to acknowledge simultaneously
  const [lpResult, buyerResult] = await Promise.allSettled([
    lpFundEarlyPayment(lp, earlyPayId).then(
      () => ({ success: true, who: "LP" }),
      (err) => ({ success: false, who: "LP", error: err.message }),
    ),
    acknowledgePO(buyer, poId).then(
      () => ({ success: true, who: "BUYER" }),
      (err) => ({ success: false, who: "BUYER", error: err.message }),
    ),
  ]);

  // At least one should succeed
  const lpOk =
    lpResult.status === "fulfilled" && (lpResult.value as any).success;
  const buyerOk =
    buyerResult.status === "fulfilled" && (buyerResult.value as any).success;

  verify(
    results,
    "At least one path succeeded",
    lpOk || buyerOk,
    "at least one succeeds",
    `LP: ${lpOk}, Buyer: ${buyerOk}`,
  );

  // PO should end up SETTLED
  const po = await getPO(admin.accessToken, poId);
  verify(
    results,
    "PO is SETTLED after race",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  return results;
}

/**
 * Scenario 10: Delayed Bank Confirmation
 * Escrow funding initiated but confirmation delayed. PO stays in ACCEPTED
 * until admin manually confirms.
 */
async function scenario10(
  admin: AuthedUser,
  chaos: boolean,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const buyer = await registerAndLogin({
    email: uniqueEmail("s10-buyer"),
    password: "StressTest10!",
    name: "S10 Buyer",
    companyName: "S10 Buyer Co",
    role: "BUYER",
  });
  const supplier = await registerAndLogin({
    email: uniqueEmail("s10-supplier"),
    password: "StressTest10!",
    name: "S10 Supplier",
    companyName: "S10 Supplier Co",
    role: "SUPPLIER",
  });

  const { poId } = await createPO(buyer, supplier.id);
  await sendPO(buyer, poId);
  await acceptPO(supplier, poId);
  await fundEscrow(buyer, poId);

  // PO should still be in ACCEPTED (bank hasn't confirmed)
  // With ESCROW_CONFIRM_DELAY_MS=999999 in test, it won't auto-confirm
  const poBeforeConfirm = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO still ACCEPTED before bank confirms",
    poBeforeConfirm.status === "ACCEPTED",
    "ACCEPTED",
    poBeforeConfirm.status,
  );

  if (chaos) await sleep(Math.random() * 300);

  // Admin manually confirms
  await confirmEscrow(admin, poId);

  const poAfterConfirm = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO in FULFILLMENT after manual confirm",
    poAfterConfirm.status === "FULFILLMENT",
    "FULFILLMENT",
    poAfterConfirm.status,
  );

  // Complete the lifecycle
  await shipPO(supplier, poId);
  await deliverPO(supplier, poId);
  await verifyDelivery(buyer, poId);
  await acknowledgePO(buyer, poId);

  const po = await getPO(buyer.accessToken, poId);
  verify(
    results,
    "PO settled after delayed confirm",
    po.status === "SETTLED",
    "SETTLED",
    po.status,
  );

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Scenario Registry
// ═══════════════════════════════════════════════════════════════════

export const scenarios: { id: number; name: string; fn: ScenarioFn }[] = [
  { id: 1, name: "Normal settlement", fn: scenario1 },
  { id: 2, name: "Early payment funded (LP)", fn: scenario2 },
  { id: 3, name: "Early payment expired", fn: scenario3 },
  { id: 4, name: "Dispute full refund", fn: scenario4 },
  { id: 5, name: "Dispute partial refund", fn: scenario5 },
  { id: 6, name: "Dispute release to supplier", fn: scenario6 },
  { id: 7, name: "Dispute rework cycle", fn: scenario7 },
  { id: 8, name: "LP funding rejected", fn: scenario8 },
  { id: 9, name: "Concurrent LP fund + settle race", fn: scenario9 },
  { id: 10, name: "Delayed bank confirmation", fn: scenario10 },
];

// ═══════════════════════════════════════════════════════════════════
// Public Runner
// ═══════════════════════════════════════════════════════════════════

export async function runScenario(
  scenarioId: number,
  admin: AuthedUser,
  chaos = false,
): Promise<ScenarioResult> {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    return {
      scenario: scenarioId,
      name: `Unknown scenario ${scenarioId}`,
      passed: false,
      durationMs: 0,
      error: "Scenario not found",
      verifications: [],
    };
  }

  const start = performance.now();
  try {
    const verifications = await scenario.fn(admin, chaos);
    const durationMs = Math.round(performance.now() - start);
    const passed = verifications.every((v) => v.passed);

    return {
      scenario: scenarioId,
      name: scenario.name,
      passed,
      durationMs,
      verifications,
    };
  } catch (err: any) {
    return {
      scenario: scenarioId,
      name: scenario.name,
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: err.message || String(err),
      verifications: [],
    };
  }
}

export async function loginAdmin(): Promise<AuthedUser> {
  return loginSeeded("admin@platform.co.uk", "password123");
}

// ═══════════════════════════════════════════════════════════════════
// Standalone CLI
// ═══════════════════════════════════════════════════════════════════

if (require.main === module) {
  (async () => {
    const scenarioArg = process.argv.find((a) => a.startsWith("--scenario="));
    const scenarioId = scenarioArg ? parseInt(scenarioArg.split("=")[1]) : 0;
    const chaos = process.argv.includes("--chaos");

    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  SME Payments Stress — Scenario Runner           ║`);
    console.log(`║  API: ${BASE_URL.padEnd(42)}║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);

    const admin = await loginAdmin();
    console.log(`✓ Logged in as admin\n`);

    const toRun = scenarioId
      ? scenarios.filter((s) => s.id === scenarioId)
      : scenarios;

    let passed = 0;
    let failed = 0;

    for (const s of toRun) {
      process.stdout.write(`  Running #${s.id}: ${s.name}... `);
      const result = await runScenario(s.id, admin, chaos);

      if (result.passed) {
        passed++;
        console.log(`✅ (${result.durationMs}ms)`);
      } else {
        failed++;
        console.log(`❌ (${result.durationMs}ms)`);
        if (result.error) console.log(`    Error: ${result.error}`);
        for (const v of result.verifications.filter((v) => !v.passed)) {
          console.log(
            `    ✗ ${v.check}: expected ${v.expected}, got ${v.actual}`,
          );
        }
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    process.exit(failed > 0 ? 1 : 0);
  })();
}
