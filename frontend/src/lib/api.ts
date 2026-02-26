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
      totalVolumePennies: number;
      activeLocks: number;
      earlyPayments: number;
      totalFeesPennies: number;
    }>("/admin/stats"),
};
