import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api",
  headers: { "Content-Type": "application/json" },
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// On 401, clear token and redirect to login
// On 403 with role mismatch, redirect to dashboard (stale session)
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (typeof window !== "undefined") {
      if (error.response?.status === 401) {
        localStorage.removeItem("token");
        window.location.href = "/login";
      } else if (
        error.response?.status === 403 &&
        error.response?.data?.message?.includes("not authorised")
      ) {
        // Role mismatch — user switched accounts; redirect to dashboard
        window.location.href = "/dashboard";
      }
    }
    return Promise.reject(error);
  },
);

export default api;

// ── Auth ──────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  role: "BUYER" | "SUPPLIER" | "LIQUIDITY_PARTNER" | "ADMIN";
  companyName: string;
  organisationId?: string;
  orgRole?: "OWNER" | "APPROVER" | "FINANCE" | "MEMBER" | "VIEWER";
  jurisdiction?: "UK" | "KSA";
  currency?: "GBP" | "SAR";
}

export interface LoginResponse {
  user: User;
  accessToken: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  me: () => api.get<User>("/auth/me"),
  register: (data: {
    email: string;
    password: string;
    name: string;
    companyName: string;
    role: string;
    jurisdiction?: "UK" | "KSA";
    currency?: "GBP" | "SAR";
  }) => api.post<LoginResponse>("/auth/register", data),
};

// ── Purchase Orders ───────────────────────────────────────────
export interface LineItem {
  description: string;
  quantity: number;
  unitPricePennies: number;
  sku?: string;
  unitOfMeasure?: string;
}

export interface PORevision {
  id: string;
  revision: number;
  proposedBy: string;
  proposedByRole: string;
  lineItems: LineItem[];
  amount: number;
  notes?: string | null;
  expectedDeliveryDate?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  status: string; // PENDING | ACCEPTED | REJECTED | SUPERSEDED
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  buyerId: string;
  supplierId: string;
  status: string;
  totalAmountPennies: number;
  totalAmountMinor: number;
  currency?: string;
  lineItems: LineItem[];
  description: string | null;
  acceptanceDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  buyer?: User;
  supplier?: User;
  paymentLock?: PaymentLock | null;
  // Phase 4 extended fields
  externalPoNumber?: string | null;
  paymentTerms?: string;
  deliveryTerms?: string;
  deliveryTermsNote?: string | null;
  deliveryAddress?: string | null;
  taxRate?: number;
  taxAmount?: number;
  grossAmount?: number;
  disputeWindowHours?: number;
  partialAcceptanceAllowed?: boolean;
  acceptedLineItems?: number[];
  importSource?: string | null;
  importBatchId?: string | null;
  importedAt?: string | null;
  attachmentUrl?: string | null;
  // Standard PO header fields
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  buyerContactName?: string | null;
  buyerContactEmail?: string | null;
  currentRevision?: number;
  shippedAt?: string | null;
  // Revisions
  revisions?: PORevision[];
}

export interface PaymentLock {
  id: string;
  purchaseOrderId: string;
  amountPennies: number;
  amountMinor: number;
  currency?: string;
  status: string;
  externalRef?: string | null;
  lockedAt: string | null;
  releasedAt: string | null;
}

export interface RiskFactorScore {
  name: string;
  score: number;
  weight: number;
  weighted: number;
  reason: string;
}

export interface RiskSnapshot {
  riskScore: number;
  defaultProbability: number;
  paymentLocked: boolean;
  instrumentStatus: string | null;
  deliveryStatus: string;
  buyerDisputeRate: number;
  bankReference: string | null;
  expectedSettlement: string | null;
  evidencePackAvailable: boolean;
  factors: RiskFactorScore[];
}

export interface EarlyPaymentRequest {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  liquidityPartnerId: string | null;
  faceValuePennies: number;
  serviceFeePennies: number;
  netAdvancePennies: number;
  faceValueMinor: number;
  serviceFeeMinor: number;
  netAdvanceMinor: number;
  currency?: string;
  status: string;
  riskAcknowledged: boolean;
  fundedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  purchaseOrder?: {
    id: string;
    reference: string;
    status: string;
    totalAmountPennies: number;
    totalAmountMinor: number;
    currency?: string;
    buyer?: User;
    supplier?: User;
    paymentLock?: {
      status: string;
      amountPennies: number;
      amountMinor: number;
    };
  };
  supplier?: User;
  liquidityPartner?: User;
  risk?: RiskSnapshot | null;
}

export interface PaymentLockEntry {
  id: string;
  purchaseOrderId: string;
  buyerId: string;
  amountPennies: number;
  amountMinor: number;
  currency?: string;
  status: string;
  lockedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  purchaseOrder: {
    id: string;
    reference: string;
    totalAmountPennies: number;
    totalAmountMinor: number;
    status: string;
    buyer?: { id: string; name: string; companyName: string };
    supplier?: { id: string; name: string; companyName: string };
  };
  buyer: { id: string; name: string; companyName: string };
}

export interface EventLogEntry {
  id: string;
  sequence: number;
  entitySequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorRole: string;
  payload: Record<string, unknown>;
  timestamp: string;
  eventHash: string;
  previousHash: string | null;
  actorSignature: string;
  authenticatorData: string | null;
  actorPublicKey: string;
  credentialId: string | null;
  intentHash: string | null;
  clientDataJSON: string | null;
  createdAt: string;
}

export interface SignaturePayload {
  signature: string;
  authenticatorData: string;
  publicKey: string;
  credentialId: string;
  intentHash?: string;
  clientDataJSON?: string;
}

export const poApi = {
  list: (params?: Record<string, string>) =>
    api.get<PurchaseOrder[]>("/purchase-orders", { params }),
  get: (id: string) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
  create: (data: {
    supplierId: string;
    description?: string;
    lineItems: LineItem[];
    externalPoNumber?: string;
    paymentTerms?: string;
    deliveryTerms?: string;
    deliveryTermsNote?: string;
    deliveryAddress?: string;
    taxRate?: number;
    disputeWindowHours?: number;
    partialAcceptanceAllowed?: boolean;
    expectedDeliveryDate?: string;
    notes?: string;
    buyerContactName?: string;
    buyerContactEmail?: string;
  }) => api.post<PurchaseOrder>("/purchase-orders", data),
  importCSV: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<{ imported: number; errors: string[] }>(
      "/purchase-orders/import/csv",
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
  },
  send: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/send`, { signatureData }),
  accept: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/accept`, {
      signatureData,
    }),
  fundEscrow: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/fund`, {
      signatureData,
    }),
  reject: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/reject`, {
      signatureData,
    }),
  markDelivered: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/deliver`, {
      signatureData,
    }),
  markShipped: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/ship`, {
      signatureData,
    }),
  verifyDelivery: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/verify`, {
      signatureData,
    }),
  acknowledgeObligation: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/acknowledge`, {
      signatureData,
    }),
  dispute: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/dispute`, {
      signatureData,
    }),
  counterPropose: (
    id: string,
    data: {
      lineItems: LineItem[];
      notes?: string;
      expectedDeliveryDate?: string;
      paymentTerms?: string;
      deliveryTerms?: string;
      signatureData?: SignaturePayload;
    },
  ) => api.patch<PurchaseOrder>(`/purchase-orders/${id}/counter`, data),
  acceptCounter: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/accept-counter`, {
      signatureData,
    }),
  rejectCounter: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/reject-counter`, {
      signatureData,
    }),
};

export const earlyPayApi = {
  list: () => api.get<EarlyPaymentRequest[]>("/early-payments"),
  marketplace: () =>
    api.get<EarlyPaymentRequest[]>("/early-payments/marketplace"),
  get: (id: string) => api.get<EarlyPaymentRequest>(`/early-payments/${id}`),
  request: (purchaseOrderId: string, signatureData?: SignaturePayload) =>
    api.post<EarlyPaymentRequest>("/early-payments", {
      purchaseOrderId,
      signatureData,
    }),
  fund: (id: string, signatureData?: SignaturePayload) =>
    api.patch<EarlyPaymentRequest>(`/early-payments/${id}/fund`, {
      signatureData,
    }),
};

export const paymentLocksApi = {
  list: () => api.get<PaymentLockEntry[]>("/payment-locks"),
};

export const ledgerApi = {
  list: (entityId?: string) =>
    api.get<EventLogEntry[]>("/ledger", {
      params: entityId ? { entityId } : {},
    }),
  verify: (entityId: string) =>
    api.get<{
      valid: boolean;
      eventCount?: number;
      signedCount?: number;
      details: string;
    }>(`/ledger/verify/${entityId}`),
  /** Step 1: Request a signing challenge for a specific action */
  challenge: (entityId: string, eventType: string) =>
    api.post<{ purpose: string; intentHash: string; options: any }>(
      "/ledger/challenge",
      { entityId, eventType },
    ),
  /** Step 2: Submit a signed event with the WebAuthn assertion */
  submitSigned: (data: {
    purpose: string;
    assertion: any;
    entityType: string;
    entityId: string;
    eventType: string;
    payload: Record<string, unknown>;
    intentHash?: string;
  }) => api.post("/ledger/events", data),
  /** Get self-contained proof bundle for external verification */
  proof: (eventId: string) => api.get(`/ledger/proof/${eventId}`),
  /** Verify local receipts against the ledger */
  verifyReceipts: (
    receipts: Array<{
      eventId: string;
      eventHash: string;
      entityId: string;
      entitySequence: number;
    }>,
  ) =>
    api.post<{
      total: number;
      verified: number;
      missing: number;
      mismatched: number;
      allVerified: boolean;
      results: Array<{
        eventId: string;
        entityId: string;
        status: "VERIFIED" | "MISSING" | "HASH_MISMATCH" | "SEQUENCE_MISMATCH";
        detail: string;
      }>;
    }>("/ledger/receipts/verify", { receipts }),
};

// ── Evidence ──────────────────────────────────────────────────
export interface EvidenceAttachment {
  id: string;
  purchaseOrderId: string;
  uploaderId: string;
  type: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  eventLogId: string | null;
  description: string | null;
  createdAt: string;
  uploader?: { id: string; name: string; companyName: string; role: string };
}

export interface EvidencePack {
  purchaseOrder: any;
  attachments: any[];
  ledgerEvents: any[];
  integrity: {
    attachmentId: string;
    filename: string;
    valid: boolean;
    sha256: string;
  }[];
  generatedAt: string;
  paymentInstrument?: {
    instrumentId: string;
    type: string;
    amount: number;
    currency: string;
    status: string;
    escrowReference: string | null;
    bankReference: string | null;
    lifecycle: { status: string; at: string; bankRef?: string | null }[];
  } | null;
  reconciliation?: {
    lastChecked: string;
    status: string;
    bankBalance: number | null;
    ledgerBalance: number | null;
    variance: number | null;
  } | null;
}

export const evidenceApi = {
  upload: (data: {
    purchaseOrderId: string;
    type: string;
    description?: string;
    file: File;
  }) => {
    const formData = new FormData();
    formData.append("purchaseOrderId", data.purchaseOrderId);
    formData.append("type", data.type);
    if (data.description) formData.append("description", data.description);
    formData.append("file", data.file);
    return api.post<EvidenceAttachment>("/evidence/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  listByPO: (poId: string) =>
    api.get<EvidenceAttachment[]>(`/evidence/po/${poId}`),
  download: (id: string) =>
    api.get(`/evidence/${id}/download`, { responseType: "blob" }),
  verify: (id: string) =>
    api.get<{ valid: boolean; storedHash: string; computedHash: string }>(
      `/evidence/${id}/verify`,
    ),
  pack: (poId: string) => api.get<EvidencePack>(`/evidence/po/${poId}/pack`),
};

// ── Passkeys ──────────────────────────────────────────────────

export const passkeysApi = {
  status: () => api.get<{ hasPasskey: boolean }>("/passkeys/status"),
  list: () =>
    api.get<
      {
        id: string;
        credentialId: string;
        deviceType: string | null;
        backedUp: boolean;
        createdAt: string;
        lastUsedAt: string | null;
      }[]
    >("/passkeys"),
  registerOptions: () => api.post<any>("/passkeys/register/options"),
  registerVerify: (response: any) =>
    api.post<{ verified: boolean; credentialId: string }>(
      "/passkeys/register/verify",
      response,
    ),
  authOptions: (purpose: string) =>
    api.post<any>("/passkeys/authenticate/options", { purpose }),
  authVerify: (purpose: string, response: any) =>
    api.post<{
      verified: boolean;
      credentialId: string;
      signature: string;
      authenticatorData: string;
      clientDataJSON: string;
      publicKey: string;
    }>("/passkeys/authenticate/verify", { purpose, response }),
  delete: (id: string) => api.delete(`/passkeys/${id}`),
};

export const usersApi = {
  suppliers: () => api.get<User[]>("/users/suppliers"),
  buyers: () => api.get<User[]>("/users?role=BUYER"),
  balance: () => api.get<{ balance: number }>("/users/balance"),
};

export interface EscrowAccount {
  id: string;
  label: string;
  bank: string;
  country: string;
  currency: string;
  balanceMinor: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { instruments: number; reconciliationReports?: number };
}

export const adminApi = {
  stats: () =>
    api.get<{
      totalPOs: number;
      settledPOs: number;
      totalVolumePennies: number;
      totalVolumeMinor: number;
      activeLocks: number;
      earlyPayments: number;
      totalFeesPennies: number;
      totalFeesMinor: number;
      totalUsers: number;
      volumeByCurrency?: Record<string, number>;
      feesByCurrency?: Record<string, number>;
      escrowBalanceByCurrency?: Record<string, number>;
      lockedAmountByCurrency?: Record<string, number>;
    }>("/admin/stats"),

  integrityCheck: () =>
    api.get<{
      checkedAt: string;
      totalChecked: number;
      valid: number;
      violations: Array<{
        invariantId: string;
        purchaseOrderId: string;
        expected: string;
        actual: string;
        severity: "CRITICAL" | "HIGH" | "MEDIUM";
      }>;
    }>("/admin/integrity-check"),

  listEscrowAccounts: () => api.get<EscrowAccount[]>("/admin/escrow-accounts"),
  getEscrowAccount: (id: string) =>
    api.get<EscrowAccount>(`/admin/escrow-accounts/${id}`),
  createEscrowAccount: (data: {
    label: string;
    bank: string;
    country: string;
    currency: string;
  }) => api.post<EscrowAccount>("/admin/escrow-accounts", data),
  updateEscrowAccount: (
    id: string,
    data: { label?: string; active?: boolean },
  ) => api.patch<EscrowAccount>(`/admin/escrow-accounts/${id}`, data),

  // ── Escrow Transaction Journal ────────────────────────────

  getEscrowStatement: (id: string) =>
    api.get<{
      escrowAccountId: string;
      label: string;
      currency: string;
      currentBalance: number;
      transactions: Array<{
        id: string;
        type: string;
        amountMinor: number;
        balanceAfter: number;
        purchaseOrderId: string | null;
        counterpartyId: string | null;
        reference: string;
        createdAt: string;
      }>;
    }>(`/admin/escrow-accounts/${id}/statement`),

  verifyEscrowBalance: (id: string) =>
    api.get<{
      escrowAccountId: string;
      shadowBalance: number;
      computedBalance: number;
      match: boolean;
      transactionCount: number;
    }>(`/admin/escrow-accounts/${id}/verify-balance`),
};

// ── Feature Flags ─────────────────────────────────────────────

export interface FlagStatus {
  flag: string;
  enabled: boolean;
  source: "env" | "db-global" | "db-org" | "default";
}

export const featureFlagApi = {
  list: (orgId?: string) =>
    api.get<{ flags: FlagStatus[]; orgId: string | null }>(
      "/admin/feature-flags",
      orgId ? { params: { orgId } } : undefined,
    ),
  toggle: (flag: string, enabled: boolean, organisationId?: string) =>
    api.patch<{
      flag: string;
      enabled: boolean;
      organisationId: string | null;
    }>(`/admin/feature-flags/${flag}`, { enabled, organisationId }),
};

// ── Approvals ─────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  entityType: string;
  entityId: string;
  organisationId: string;
  policyRuleId: string;
  requiredApprovals: number;
  currentApprovals: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "ESCALATED";
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  policyRule?: { id: string; name: string; requiredRoles: string[] };
  approvals?: {
    id: string;
    decision: "APPROVE" | "REJECT";
    comment: string | null;
    user: { id: string; name: string; email: string };
    createdAt: string;
  }[];
}

export interface PolicyRule {
  id: string;
  organisationId: string;
  ruleType:
    | "PO_APPROVAL"
    | "PO_ORDER_LIMITS"
    | "FUNDING_LIMIT"
    | "ESCROW_FUNDING"
    | "SUPPLIER_ACCEPTANCE"
    | "SETTLEMENT"
    | "EARLY_PAYMENT"
    | "LP_FUNDING"
    | "DISPUTE_RESOLUTION"
    | "DELIVERY_VERIFICATION";
  name: string;
  conditions: Record<string, unknown>;
  requiredApprovals: number;
  requiredRoles: string[];
  autoApprove: boolean;
  priority: number;
  active: boolean;
  createdAt: string;
}

export interface PolicyEvaluation {
  requiresApproval: boolean;
  autoApprove: boolean;
  requiredApprovals: number;
  requiredRoles: string[];
  matchedRule: { id: string; name: string } | null;
}

export interface LPExposure {
  total: number;
  perBuyer: Record<string, number>;
  perSupplier: Record<string, number>;
  count: number;
}

export const approvalsApi = {
  pending: () => api.get<ApprovalRequest[]>("/approvals/pending"),
  byEntity: (entityType: string, entityId: string) =>
    api.get<ApprovalRequest[]>(`/approvals/entity/${entityType}/${entityId}`),
  get: (id: string) => api.get<ApprovalRequest>(`/approvals/${id}`),
  decide: (id: string, decision: "APPROVE" | "REJECT", comment?: string) =>
    api.post<{
      approvalRequest: ApprovalRequest;
      isComplete: boolean;
      finalStatus: string;
    }>(`/approvals/${id}/decide`, { decision, comment }),
};

export const policiesApi = {
  byOrg: (orgId: string, ruleType?: string) =>
    api.get<PolicyRule[]>(`/policies/org/${orgId}`, {
      params: ruleType ? { ruleType } : {},
    }),
  evaluate: (amount: number) =>
    api.get<PolicyEvaluation>("/policies/evaluate/po-approval", {
      params: { amount: amount.toString() },
    }),
  poLimits: () =>
    api.get<{ minAmount: number; maxAmount: number; source: string }>(
      "/policies/po-limits",
    ),
  exposure: (orgId: string) =>
    api.get<LPExposure>(`/policies/exposure/${orgId}`),
  templates: (orgType: string, jurisdiction: string) =>
    api.get<{
      orgType: string;
      jurisdiction: string;
      count: number;
      templates: {
        ruleType: string;
        name: string;
        conditions: Record<string, unknown>;
        requiredApprovals: number;
        requiredRoles: string[];
        autoApprove: boolean;
        priority: number;
      }[];
    }>(`/policies/templates/${orgType}/${jurisdiction}`),
  readiness: (orgId: string) =>
    api.get<{
      organisationId: string;
      organisationName: string;
      orgType: string;
      jurisdiction: string;
      readyPercentage: number;
      checks: {
        key: string;
        label: string;
        complete: boolean;
      }[];
    }>(`/policies/readiness/${orgId}`),
  seedDefaults: (orgId: string) =>
    api.post<{ created: number; skipped: number; rules: string[] }>(
      `/policies/org/${orgId}/seed-defaults`,
    ),
  resetDefaults: (orgId: string) =>
    api.post<{ created: number; skipped: number; rules: string[] }>(
      `/policies/org/${orgId}/reset-defaults`,
    ),
  seedMyDefaults: () =>
    api.post<{ created: number; skipped: number; rules: string[] }>(
      "/policies/seed-my-defaults",
    ),
  resetMyDefaults: () =>
    api.post<{ created: number; skipped: number; rules: string[] }>(
      "/policies/reset-my-defaults",
    ),
  simulate: (amount: number, ruleType: string) =>
    api.post<{
      matched: boolean;
      rule: {
        id: string;
        name: string;
        ruleType: string;
        requiredApprovals: number;
        requiredRoles: string[];
        autoApprove: boolean;
      } | null;
      message?: string;
    }>("/policies/simulate", { amount, ruleType }),
  createMyRule: (data: {
    organisationId: string;
    ruleType: string;
    name: string;
    conditions: Record<string, unknown>;
    requiredApprovals?: number;
    requiredRoles?: string[];
    autoApprove?: boolean;
    priority?: number;
  }) => api.post<PolicyRule>("/policies/create-my-rule", data),
};

// ── Onboarding ────────────────────────────────────────────────

export interface OnboardingStep {
  complete: boolean;
  [key: string]: unknown;
}

export interface OnboardingStatus {
  id: string;
  name: string;
  type: "BUYER" | "SUPPLIER" | "LIQUIDITY_PARTNER";
  onboardingStatus:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "KYB_PENDING"
    | "KYB_VERIFIED"
    | "KYB_FAILED"
    | "COMPLETED";
  registrationNo: string | null;
  jurisdiction: "UK" | "KSA";
  authorizedSignatory: string | null;
  bankIban: string | null;
  termsAcceptedAt: string | null;
  kybProvider: string | null;
  kybVerifiedAt: string | null;
  supplierTier: "BASIC" | "LIQUIDITY_ELIGIBLE" | null;
  fundingLimitTotal: number | null;
  fundingAccountRef: string | null;
  participationAgreementAcceptedAt: string | null;
  steps: Record<string, OnboardingStep>;
}

export interface KybResult {
  verified: boolean;
  onboardingStatus: string;
  provider: string;
  errorMessage?: string;
}

export const onboardingApi = {
  status: () => api.get<OnboardingStatus>("/onboarding/status"),
  buyerKyb: (data: { registrationNo: string; authorizedSignatory: string }) =>
    api.post<KybResult>("/onboarding/buyer/kyb", data),
  buyerPayment: (data: { bankIban: string }) =>
    api.post("/onboarding/buyer/payment", data),
  buyerComplete: () => api.post("/onboarding/buyer/complete"),
  supplierTier1: (data: {
    registrationNo: string;
    bankIban: string;
    termsAccepted: boolean;
  }) => api.post("/onboarding/supplier/tier1", data),
  supplierTier2: (data: { uboDisclosure?: Record<string, unknown> }) =>
    api.post("/onboarding/supplier/tier2", data),
  lpProfile: (data: {
    fundingAccountRef: string;
    fundingLimitTotal: number;
    riskAppetiteConfig?: Record<string, unknown>;
    participationAgreementAccepted: boolean;
  }) => api.post("/onboarding/lp/profile", data),
};

// ── Invitations ───────────────────────────────────────────────

export interface Invitation {
  id: string;
  token: string;
  inviterOrgId: string;
  inviterUserId: string;
  inviteeEmail: string;
  inviteeRole: "SUPPLIER" | "LIQUIDITY_PARTNER";
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  acceptedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  inviterOrg?: {
    name: string;
    type?: string;
    jurisdiction?: string;
    currency?: string;
  };
}

export const invitationsApi = {
  create: (data: {
    inviteeEmail: string;
    inviteeRole: "SUPPLIER" | "LIQUIDITY_PARTNER";
    metadata?: Record<string, unknown>;
  }) => api.post<Invitation>("/invitations", data),
  list: () => api.get<Invitation[]>("/invitations"),
  getByToken: (token: string) => api.get<Invitation>(`/invitations/${token}`),
  cancel: (id: string) => api.delete(`/invitations/${id}`),
  registerInvited: (data: {
    invitationToken: string;
    email: string;
    password: string;
    name: string;
    companyName: string;
    companyNumber?: string;
  }) => api.post<LoginResponse>("/auth/register-invited", data),
};

// ── Settlements ───────────────────────────────────────────────

export interface Settlement {
  id: string;
  purchaseOrderId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: "GBP" | "SAR";
  type: "STANDARD" | "EARLY_PAY_ADVANCE" | "EARLY_PAY_SETTLEMENT";
  status: "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";
  settlementRail: string | null;
  externalRef: string | null;
  completedAt: string | null;
  reconciledAt: string | null;
  createdAt: string;
  purchaseOrder?: {
    id: string;
    referenceNumber: string;
    amount: number;
    currency: string;
    status: string;
  };
  fromUser?: { id: string; name: string; companyName: string };
  toUser?: { id: string; name: string; companyName: string };
}

export const settlementsApi = {
  list: () => api.get<Settlement[]>("/settlements"),
  adapter: () => api.get<{ adapter: string }>("/settlements/adapter"),
  pending: () => api.get<Settlement[]>("/settlements/pending"),
  byPO: (poId: string) => api.get<Settlement[]>(`/settlements/po/${poId}`),
  reconcile: (id: string, externalRef: string) =>
    api.post<{
      externalRef: string;
      previousStatus: string;
      currentStatus: string;
      changed: boolean;
    }>(`/settlements/${id}/reconcile`, { externalRef }),
};

// ── Reconciliation ────────────────────────────────────────────

export interface ReconciliationAlert {
  instrumentId?: string;
  settlementId?: string;
  expected: string;
  actual: string;
  externalRef: string;
  reason: string;
}

export interface ReconciliationReport {
  id: string;
  runAt: string;
  totalChecked: number;
  matched: number;
  mismatches: number;
  alerts: ReconciliationAlert[];
  ledgerBalance: number | null;
  ledgerBalanceByCurrency?: Record<string, number>;
  bankBalance: number | null;
  variance: number | null;
  currency?: "GBP" | "SAR";
  createdAt: string;
}

export const reconciliationApi = {
  getLatest: () =>
    api.get<ReconciliationReport | null>("/settlements/reconciliation/latest"),
  getReports: (limit = 20, offset = 0) =>
    api.get<ReconciliationReport[]>("/settlements/reconciliation/reports", {
      params: { limit, offset },
    }),
  run: () => api.post<ReconciliationReport>("/settlements/reconciliation/run"),
};

// ── Disputes ──────────────────────────────────────────────────

export interface Dispute {
  id: string;
  purchaseOrderId: string;
  raisedById: string;
  reason: string;
  status: "OPEN" | "EVIDENCE_SUBMITTED" | "UNDER_REVIEW" | "RESOLVED";
  outcome:
    | "FULL_REFUND"
    | "PARTIAL_REFUND"
    | "RELEASE_TO_SUPPLIER"
    | "REWORK"
    | null;
  resolvedById: string | null;
  refundAmount: number | null;
  resolutionNotes: string | null;
  buyerEvidence: string[] | null;
  supplierEvidence: string[] | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseOrder?: {
    id: string;
    referenceNumber: string;
    amount: number;
    currency: string;
    status: string;
    buyerId?: string;
    supplierId?: string;
  };
  raisedBy?: { id: string; name: string; email: string; companyName: string };
  resolvedBy?: { id: string; name: string; email: string } | null;
}

export const disputesApi = {
  raise: (data: {
    purchaseOrderId: string;
    reason: string;
    evidenceIds?: string[];
  }) => api.post<Dispute>("/disputes", data),
  submitEvidence: (id: string, evidenceIds: string[]) =>
    api.post<Dispute>(`/disputes/${id}/evidence`, { evidenceIds }),
  markUnderReview: (id: string) => api.patch<Dispute>(`/disputes/${id}/review`),
  resolve: (
    id: string,
    data: {
      outcome:
        | "FULL_REFUND"
        | "PARTIAL_REFUND"
        | "RELEASE_TO_SUPPLIER"
        | "REWORK";
      refundAmount?: number;
      resolutionNotes?: string;
    },
  ) => api.patch<Dispute>(`/disputes/${id}/resolve`, data),
  list: (params?: { purchaseOrderId?: string; status?: string }) =>
    api.get<Dispute[]>("/disputes", { params }),
  getById: (id: string) => api.get<Dispute>(`/disputes/${id}`),
};

// ── Risk / Fraud Controls ─────────────────────────────────────

export interface FraudConfig {
  maxPOsPerBuyerPerDay: number;
  maxDailyValuePerBuyer: number;
  mandatoryEvidenceThreshold: number;
  supplierWhitelist: string[];
  maxPOsPerSupplierPerDay: number;
  configByCurrency?: Record<
    string,
    {
      maxPOsPerBuyerPerDay: number;
      maxDailyValuePerBuyer: number;
      mandatoryEvidenceThreshold: number;
      supplierWhitelist: string[];
      maxPOsPerSupplierPerDay: number;
    }
  >;
}

export interface FraudFlag {
  id: string;
  userId: string;
  ruleCode: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    companyName: string;
  };
}

export interface ExposureReport {
  liquidityPartnerId: string;
  currency?: "GBP" | "SAR";
  totalExposure: number;
  exposureByCurrency?: Record<string, number>;
  fundingLimit: number | null;
  utilisationPct: number | null;
  buyerConcentration: Record<string, number>;
  supplierConcentration: Record<string, number>;
  fundingSuspended: boolean;
  suspensionReason: string | null;
  alerts: string[];
}

export const riskApi = {
  // Fraud controls
  getFraudConfig: () => api.get<FraudConfig>("/risk/fraud/config"),
  updateFraudConfig: (data: Partial<FraudConfig>) =>
    api.patch<FraudConfig>("/risk/fraud/config", data),
  getUnacknowledgedFlags: () => api.get<FraudFlag[]>("/risk/fraud/flags"),
  acknowledgeFlag: (id: string) =>
    api.patch<FraudFlag>(`/risk/fraud/flags/${id}/acknowledge`),
  getUserFlags: (userId: string) =>
    api.get<FraudFlag[]>(`/risk/fraud/flags/user/${userId}`),

  // LP risk
  getLpRiskConfig: () => api.get("/risk/lp/config"),
  updateLpRiskConfig: (data: Record<string, unknown>) =>
    api.patch("/risk/lp/config", data),
  getLpExposure: (lpId: string) =>
    api.get<ExposureReport>(`/risk/lp/exposure/${lpId}`),
  takeSnapshot: (lpId: string) =>
    api.post(`/risk/lp/exposure/${lpId}/snapshot`),
  getSnapshotHistory: (lpId: string, limit?: number) =>
    api.get(`/risk/lp/exposure/${lpId}/history`, {
      params: limit ? { limit } : undefined,
    }),
  checkFunding: (lpId: string, amount: number) =>
    api.post("/risk/lp/check-funding", { lpId, amount }),
};

// ── Organisations & Team ──────────────────────────────────────

export interface OrgMemberRaw {
  id: string;
  userId: string;
  orgRole: string;
  user: { id: string; email: string; name: string; role: string };
}

export interface OrgMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  orgRole: string;
}

export interface OrgPermission {
  id: string;
  organisationId: string;
  action: string;
  allowedRoles: string[];
}

export interface OrgDelegation {
  id: string;
  organisationId: string;
  delegatorUserId: string;
  delegateUserId: string;
  actions: string[];
  validFrom: string;
  validTo: string;
  active: boolean;
  delegator?: { id: string; name: string; email: string };
  delegate?: { id: string; name: string; email: string };
  organisation?: { id: string; name: string };
}

export const organisationsApi = {
  me: () => api.get("/organisations/me"),
  members: (orgId: string) =>
    api.get<OrgMemberRaw[]>(`/organisations/${orgId}/members`),
  updateMemberRole: (orgId: string, userId: string, orgRole: string) =>
    api.patch(`/organisations/${orgId}/members/${userId}`, { orgRole }),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organisations/${orgId}/members/${userId}`),
  inviteTeamMember: (
    orgId: string,
    data: { email: string; name: string; password: string; orgRole: string },
  ) => api.post(`/organisations/${orgId}/invite-member`, data),

  // Permissions
  getPermissions: (orgId: string) =>
    api.get<OrgPermission[]>(`/organisations/${orgId}/permissions`),
  setPermission: (orgId: string, action: string, allowedRoles: string[]) =>
    api.put<OrgPermission>(`/organisations/${orgId}/permissions/${action}`, {
      allowedRoles,
    }),
  deletePermission: (orgId: string, action: string) =>
    api.delete(`/organisations/${orgId}/permissions/${action}`),

  // Delegations
  createDelegation: (
    orgId: string,
    data: { delegateUserId: string; actions: string[]; validTo: string },
  ) => api.post<OrgDelegation>(`/organisations/${orgId}/delegations`, data),
  getDelegations: (orgId: string) =>
    api.get<OrgDelegation[]>(`/organisations/${orgId}/delegations`),
  revokeDelegation: (orgId: string, delegationId: string) =>
    api.delete(`/organisations/${orgId}/delegations/${delegationId}`),
  myDelegations: () =>
    api.get<OrgDelegation[]>("/organisations/delegations/mine"),
};
