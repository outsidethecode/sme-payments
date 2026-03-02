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
  orgRole?: "OWNER" | "APPROVER" | "FINANCE" | "MEMBER";
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
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  buyerId: string;
  supplierId: string;
  status: string;
  totalAmountPennies: number;
  lineItems: LineItem[];
  description: string | null;
  acceptanceDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  buyer?: User;
  supplier?: User;
  paymentLock?: PaymentLock | null;
}

export interface PaymentLock {
  id: string;
  purchaseOrderId: string;
  amountPennies: number;
  status: string;
  lockedAt: string | null;
  releasedAt: string | null;
}

export interface EarlyPaymentRequest {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  liquidityPartnerId: string | null;
  faceValuePennies: number;
  serviceFeePennies: number;
  netAdvancePennies: number;
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
    buyer?: User;
    supplier?: User;
    paymentLock?: { status: string; amountPennies: number };
  };
  supplier?: User;
  liquidityPartner?: User;
}

export interface PaymentLockEntry {
  id: string;
  purchaseOrderId: string;
  buyerId: string;
  amountPennies: number;
  status: string;
  lockedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  purchaseOrder: {
    id: string;
    reference: string;
    totalAmountPennies: number;
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
  }) => api.post<PurchaseOrder>("/purchase-orders", data),
  send: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/send`, { signatureData }),
  accept: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/accept`, {
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
  verifyDelivery: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/verify`, {
      signatureData,
    }),
  dispute: (id: string, signatureData?: SignaturePayload) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id}/dispute`, {
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
  suppliers: () => api.get<User[]>("/users?role=SUPPLIER"),
  buyers: () => api.get<User[]>("/users?role=BUYER"),
  balance: () => api.get<{ balance: number }>("/users/balance"),
};

export const adminApi = {
  stats: () =>
    api.get<{
      totalPOs: number;
      settledPOs: number;
      totalVolumePennies: number;
      activeLocks: number;
      earlyPayments: number;
      totalFeesPennies: number;
      totalUsers: number;
    }>("/admin/stats"),
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
  ruleType: "PO_APPROVAL" | "FUNDING_LIMIT";
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
  exposure: (orgId: string) =>
    api.get<LPExposure>(`/policies/exposure/${orgId}`),
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
