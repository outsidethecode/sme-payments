"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  poApi,
  ledgerApi,
  approvalsApi,
  policiesApi,
  earlyPayApi,
  disputesApi,
  type SignaturePayload,
  type LineItem,
  type Dispute,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePasskey } from "@/lib/use-passkey";
import { storeReceipt } from "@/lib/receipt-store";
import {
  EvidencePanel,
  EvidencePackButton,
  InstrumentLifecycleCard,
} from "@/components/evidence-panel";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  statusVariant,
  statusLabel,
} from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import Link from "next/link";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Send,
  Check,
  X,
  Truck,
  Package,
  ShieldCheck,
  HandCoins,
  AlertTriangle,
  AlertCircle,
  Info,
  Fingerprint,
  MessageSquare,
  RotateCcw,
  Wallet,
  Building2,
  Clock,
  CreditCard,
  Loader2,
  Scale,
  FileText,
  ExternalLink,
  CheckCircle,
} from "lucide-react";

// ── Unified Policy Banner ──

function PolicyBanner({
  title,
  description,
  policyName,
  requiredApprovals,
  requiredRoles,
  currentApprovals,
  autoApprove,
  userRole,
  noPermissionText,
  actionLink,
}: {
  title: string;
  description?: string;
  policyName: string;
  requiredApprovals?: number;
  requiredRoles?: string[];
  currentApprovals?: number;
  autoApprove?: boolean;
  userRole?: string | null;
  noPermissionText?: string;
  actionLink?: { href: string; label: string };
}) {
  const rolesFormatted = requiredRoles
    ?.map((r) => r.charAt(0) + r.slice(1).toLowerCase())
    .join(" or ");

  // Check permission
  const effectiveRoles = (
    requiredRoles && requiredRoles.length > 0
      ? requiredRoles
      : ["OWNER", "APPROVER", "FINANCE"]
  ).map((r) => r.toUpperCase());
  const hasPermission = userRole && effectiveRoles.includes(userRole);

  return (
    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <Clock className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">
        {title}
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300 space-y-2">
        {description && (
          <p>
            {description}
            {actionLink && (
              <>
                {" "}
                <Link href={actionLink.href} className="underline font-medium">
                  {actionLink.label}
                </Link>
                .
              </>
            )}
          </p>
        )}
        <div className="mt-2 rounded-md bg-amber-100/60 dark:bg-amber-900/30 px-3 py-2 text-sm space-y-1">
          <p className="font-medium">Policy: {policyName}</p>
          <p>
            {autoApprove ? (
              <>
                This amount qualifies for{" "}
                <span className="font-semibold">auto-approval</span>.
              </>
            ) : (
              <>
                Requires{" "}
                <span className="font-semibold">
                  {requiredApprovals ?? 1}{" "}
                  {(requiredApprovals ?? 1) === 1 ? "approval" : "approvals"}
                </span>
                {rolesFormatted && (
                  <>
                    {" "}
                    from a team member with the{" "}
                    <span className="font-semibold">{rolesFormatted}</span> role
                  </>
                )}
                .
              </>
            )}
          </p>
          {currentApprovals !== undefined &&
            requiredApprovals !== undefined && (
              <p>
                Progress: {currentApprovals} of {requiredApprovals} received.
              </p>
            )}
        </div>
        {noPermissionText && !hasPermission && userRole && (
          <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Your role (
            <span className="font-semibold">
              {userRole.charAt(0)}
              {userRole.slice(1).toLowerCase()}
            </span>
            ) {noPermissionText}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { hasPasskey, signing, signAction } = usePasskey();

  // Escrow details shown after buyer initiates funding
  const [escrowDetails, setEscrowDetails] = useState<{
    bank: string;
    iban: string | null;
    label: string;
    currency: string;
    country: string;
  } | null>(null);

  // Whether funding has been initiated but bank hasn't confirmed yet
  const fundingPending =
    escrowDetails !== null ||
    // Detect pending state from server data (lock exists but PO still ACCEPTED)
    false; // updated below after `po` is available

  const { data: po, isLoading } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => poApi.get(id).then((r) => r.data),
    enabled: !!id,
    // Poll every 2s while escrow funding is pending to detect bank confirmation
    refetchInterval: escrowDetails ? 2000 : undefined,
  });

  // Clear escrow details once PO transitions to FULFILLMENT (bank confirmed)
  useEffect(() => {
    if (po?.status === "FULFILLMENT" && escrowDetails) {
      setEscrowDetails(null);
      toast.success("Bank confirmed — escrow funded, supplier can begin work");
      queryClient.invalidateQueries({ queryKey: ["ledger", id] });
    }
  }, [po?.status, escrowDetails, queryClient, id]);

  // Detect server-side pending state (page refresh while funding is in flight)
  const isServerFundingPending =
    po?.status === "ACCEPTED" &&
    po?.paymentLock &&
    po.paymentLock.status === "LOCKED";

  // Poll when server indicates pending too
  const { data: _poRefresh } = useQuery({
    queryKey: ["purchase-order-poll", id],
    queryFn: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      return Promise.resolve(null);
    },
    enabled: !!isServerFundingPending && !escrowDetails,
    refetchInterval: 2000,
  });

  // Fetch approval request details when PO is pending approval
  const { data: approvalRequests } = useQuery({
    queryKey: ["approval-requests", id],
    queryFn: () =>
      approvalsApi.byEntity("PURCHASE_ORDER", id).then((r) => r.data),
    enabled: !!id && po?.status === "PENDING_APPROVAL",
  });
  const pendingApproval = approvalRequests?.find(
    (ar) => ar.status === "PENDING" || ar.status === "ESCALATED",
  );

  // Fetch supplier acceptance policy when supplier views a SENT PO
  const { data: supplierPolicy } = useQuery({
    queryKey: ["supplier-acceptance-policy", id, po?.totalAmountMinor],
    queryFn: () =>
      policiesApi
        .simulate(
          po!.totalAmountMinor ?? po!.totalAmountPennies,
          "SUPPLIER_ACCEPTANCE",
        )
        .then((r) => r.data),
    enabled: !!po && po.status === "SENT" && user?.role === "SUPPLIER",
  });

  // Fetch negotiation policy (buyer uses PO_APPROVAL, supplier uses SUPPLIER_ACCEPTANCE)
  const negotiationRuleType =
    user?.role === "SUPPLIER" ? "SUPPLIER_ACCEPTANCE" : "PO_APPROVAL";
  const { data: negotiationPolicy } = useQuery({
    queryKey: [
      "negotiation-policy",
      id,
      po?.totalAmountMinor,
      negotiationRuleType,
    ],
    queryFn: () =>
      policiesApi
        .simulate(
          po!.totalAmountMinor ?? po!.totalAmountPennies,
          negotiationRuleType,
        )
        .then((r) => r.data),
    enabled: !!po && po.status === "NEGOTIATION",
  });

  // Fetch early payment policy when supplier views a fulfillment-stage PO
  const { data: earlyPayPolicy } = useQuery({
    queryKey: ["early-pay-policy", id, po?.totalAmountMinor],
    queryFn: () =>
      policiesApi
        .simulate(
          po!.totalAmountMinor ?? po!.totalAmountPennies,
          "EARLY_PAYMENT",
        )
        .then((r) => r.data),
    enabled:
      !!po &&
      user?.role === "SUPPLIER" &&
      ["FULFILLMENT", "SHIPPED", "DELIVERED"].includes(po.status),
  });

  // Check if an early payment request already exists for this PO
  const { data: earlyPayments } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
    enabled:
      user?.role === "SUPPLIER" &&
      !!po &&
      ["FULFILLMENT", "SHIPPED", "DELIVERED"].includes(po.status),
  });
  const hasEarlyPayRequest = earlyPayments?.some(
    (ep) => ep.purchaseOrderId === id,
  );

  // Fetch delivery verification policy when buyer views a DELIVERED PO
  const { data: deliveryPolicy } = useQuery({
    queryKey: ["delivery-policy", id, po?.totalAmountMinor],
    queryFn: () =>
      policiesApi
        .simulate(
          po!.totalAmountMinor ?? po!.totalAmountPennies,
          "DELIVERY_VERIFICATION",
        )
        .then((r) => r.data),
    enabled: !!po && user?.role === "BUYER" && po.status === "DELIVERED",
  });

  const { data: events } = useQuery({
    queryKey: ["ledger", id],
    queryFn: () => ledgerApi.list(id).then((r) => r.data),
    enabled: !!id,
  });

  const { data: poDispute } = useQuery({
    queryKey: ["dispute-for-po", id],
    queryFn: () =>
      disputesApi
        .list({ purchaseOrderId: id })
        .then((r) => r.data?.[0] ?? null),
    enabled:
      !!po &&
      ["DISPUTED", "SETTLED", "CANCELLED", "VERIFIED", "FULFILLMENT"].includes(
        po.status,
      ),
  });

  /**
   * Create a passkey-signing mutation.
   * Before calling the API action, requests a WebAuthn signing challenge
   * and triggers a biometric prompt. The resulting signature is sent
   * alongside the action for immutable ledger recording.
   */
  function makeSignedAction(
    eventType: string,
    action: (id: string, sig?: SignaturePayload) => Promise<unknown>,
    successMsg: string,
  ) {
    return useMutation({
      mutationFn: async () => {
        // Step 1: Get passkey signature (triggers biometric if passkey registered)
        const sigResult = await signAction(eventType, id);

        // Step 2: If signed, verify assertion on server and get sig data
        let signatureData: SignaturePayload | undefined;
        if (sigResult) {
          const { data: verified } = await import("@/lib/api").then((m) =>
            m.passkeysApi.authVerify(sigResult.purpose, sigResult.assertion),
          );
          signatureData = {
            signature: verified.signature,
            authenticatorData: verified.authenticatorData,
            publicKey: verified.publicKey,
            credentialId: verified.credentialId,
            intentHash: sigResult.intentHash,
            clientDataJSON: verified.clientDataJSON,
          };
        }

        // Step 3: Perform the action with signature attached
        return action(id, signatureData);
      },
      onSuccess: (result: unknown) => {
        // Store Layer 4 local receipt in IndexedDB
        const axiosData = (result as { data?: Record<string, unknown> })?.data;
        if (axiosData) {
          storeReceipt(axiosData).catch(() => {});
        }
        queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["ledger", id] });
        toast.success(
          hasPasskey ? `${successMsg} ✓ Passkey signed` : successMsg,
        );
      },
      onError: (
        err: Error & { response?: { data?: { message?: string } } },
      ) => {
        if (err.name === "SigningCancelled") {
          toast.info("Action cancelled");
          return;
        }
        toast.error(err.response?.data?.message || "Action failed");
      },
    });
  }

  /* eslint-disable react-hooks/rules-of-hooks */
  const sendMutation = makeSignedAction(
    "PO_SENT",
    poApi.send,
    "PO sent to supplier",
  );
  const acceptMutation = makeSignedAction(
    "PO_ACCEPTED",
    poApi.accept,
    "PO accepted",
  );
  const rejectMutation = makeSignedAction(
    "PO_CANCELLED",
    poApi.reject,
    "PO rejected",
  );
  const deliverMutation = makeSignedAction(
    "DELIVERY_MARKED",
    poApi.markDelivered,
    "Delivery marked",
  );
  const shipMutation = makeSignedAction(
    "GOODS_SHIPPED",
    poApi.markShipped,
    "Goods shipped",
  );
  const verifyMutation = makeSignedAction(
    "DELIVERY_VERIFIED",
    poApi.verifyDelivery,
    "Delivery verified",
  );
  const acknowledgeMutation = makeSignedAction(
    "OBLIGATION_ACKNOWLEDGED",
    poApi.acknowledgeObligation,
    "Obligation acknowledged — settlement triggered",
  );
  const disputeMutation = makeSignedAction(
    "DELIVERY_DISPUTED",
    poApi.dispute,
    "Delivery disputed",
  );
  const fundEscrowMutation = useMutation({
    mutationFn: async () => {
      const sigResult = await signAction("ESCROW_FUNDING_INITIATED", id);
      let signatureData: SignaturePayload | undefined;
      if (sigResult) {
        const { data: verified } = await import("@/lib/api").then((m) =>
          m.passkeysApi.authVerify(sigResult.purpose, sigResult.assertion),
        );
        signatureData = {
          signature: verified.signature,
          authenticatorData: verified.authenticatorData,
          publicKey: verified.publicKey,
          credentialId: verified.credentialId,
          intentHash: sigResult.intentHash,
          clientDataJSON: verified.clientDataJSON,
        };
      }
      return poApi.fundEscrow(id, signatureData);
    },
    onSuccess: (result: any) => {
      const data = result?.data;
      if (data?._receipt) storeReceipt(data).catch(() => {});
      // Capture escrow details to show payment instructions
      if (data?.escrowDetails) {
        setEscrowDetails(data.escrowDetails);
      }
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ledger", id] });
      toast.success(
        hasPasskey
          ? "Escrow funding initiated — awaiting bank confirmation ✓ Passkey signed"
          : "Escrow funding initiated — awaiting bank confirmation",
      );
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      if (err.name === "SigningCancelled") {
        toast.info("Action cancelled");
        return;
      }
      toast.error(err.response?.data?.message || "Failed to fund escrow");
    },
  });
  const acceptCounterMutation = makeSignedAction(
    "PO_COUNTER_ACCEPTED",
    poApi.acceptCounter,
    "Counter-proposal accepted — PO updated",
  );
  const rejectCounterMutation = makeSignedAction(
    "PO_COUNTER_REJECTED",
    poApi.rejectCounter,
    "Counter-proposal rejected — PO cancelled",
  );
  /* eslint-enable react-hooks-rules-of-hooks */

  // Counter-proposal form state
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [counterItems, setCounterItems] = useState<LineItem[]>([]);
  const [counterNotes, setCounterNotes] = useState("");

  const counterMutation = useMutation({
    mutationFn: async () => {
      const sigResult = await signAction("PO_COUNTER_PROPOSED", id);
      let signatureData: SignaturePayload | undefined;
      if (sigResult) {
        const { data: verified } = await import("@/lib/api").then((m) =>
          m.passkeysApi.authVerify(sigResult.purpose, sigResult.assertion),
        );
        signatureData = {
          signature: verified.signature,
          authenticatorData: verified.authenticatorData,
          publicKey: verified.publicKey,
          credentialId: verified.credentialId,
          intentHash: sigResult.intentHash,
          clientDataJSON: verified.clientDataJSON,
        };
      }
      return poApi.counterPropose(id, {
        lineItems: counterItems,
        notes: counterNotes || undefined,
        signatureData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      queryClient.invalidateQueries({ queryKey: ["ledger", id] });
      setShowCounterForm(false);
      toast.success(
        hasPasskey
          ? "Counter-proposal sent ✓ Passkey signed"
          : "Counter-proposal sent",
      );
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(
        err.response?.data?.message || "Failed to send counter-proposal",
      );
    },
  });
  /* eslint-enable react-hooks/rules-of-hooks */

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!po) {
    return (
      <div className="text-muted-foreground">Purchase order not found</div>
    );
  }

  const isBuyer = user?.role === "BUYER";
  const isSupplier = user?.role === "SUPPLIER";
  const latestRevision = po.revisions?.[0];
  const canRespondToCounter =
    po.status === "NEGOTIATION" &&
    latestRevision &&
    ((isBuyer && latestRevision.proposedByRole === "SUPPLIER") ||
      (isSupplier && latestRevision.proposedByRole === "BUYER"));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/purchase-orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {po.reference}
            </h1>
            <Badge variant={statusVariant(po.status)}>
              {statusLabel(po.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatDate(po.createdAt)}
          </p>
        </div>
        <EvidencePackButton purchaseOrderId={id} />
      </div>

      {/* Pending Approval Banner */}
      {po.status === "PENDING_APPROVAL" && (
        <PolicyBanner
          title="Awaiting Approval"
          description="This purchase order requires approval before it can be sent to the supplier. Team members with the appropriate role can approve it on the"
          actionLink={{ href: "/dashboard/approvals", label: "Approvals page" }}
          policyName={
            pendingApproval?.policyRule?.name ?? "Organisation policy"
          }
          requiredApprovals={pendingApproval?.requiredApprovals}
          requiredRoles={pendingApproval?.policyRule?.requiredRoles}
          currentApprovals={pendingApproval?.currentApprovals}
          userRole={user?.orgRole}
        />
      )}

      {/* Supplier Acceptance Policy Banner */}
      {isSupplier && po.status === "SENT" && supplierPolicy?.rule && (
        <PolicyBanner
          title="Supplier Acceptance Policy"
          description="Your organisation's policy for accepting purchase orders."
          policyName={supplierPolicy.rule.name}
          requiredApprovals={supplierPolicy.rule.requiredApprovals}
          requiredRoles={supplierPolicy.rule.requiredRoles}
          autoApprove={supplierPolicy.rule.autoApprove}
          userRole={user?.orgRole}
          noPermissionText="does not have permission to act on this PO."
        />
      )}

      {/* Negotiation Policy Banner */}
      {canRespondToCounter && negotiationPolicy?.rule && (
        <PolicyBanner
          title="Negotiation Policy"
          description="Your organisation's policy for responding to counter-proposals."
          policyName={negotiationPolicy.rule.name}
          requiredApprovals={negotiationPolicy.rule.requiredApprovals}
          requiredRoles={negotiationPolicy.rule.requiredRoles}
          userRole={user?.orgRole}
          noPermissionText="does not have permission to respond to this counter-proposal."
        />
      )}

      {/* Supplier Fulfillment Policy Banner */}
      {isSupplier && po.status === "FULFILLMENT" && earlyPayPolicy?.rule && (
        <PolicyBanner
          title="Early Payment Policy"
          description="Your organisation's policy for requesting early payment."
          policyName={earlyPayPolicy.rule.name}
          requiredApprovals={earlyPayPolicy.rule.requiredApprovals}
          requiredRoles={earlyPayPolicy.rule.requiredRoles}
          autoApprove={earlyPayPolicy.rule.autoApprove}
          userRole={user?.orgRole}
          noPermissionText="does not have permission to request early payment."
        />
      )}

      {/* Buyer Delivery Verification Policy Banner */}
      {isBuyer && po.status === "DELIVERED" && deliveryPolicy?.rule && (
        <PolicyBanner
          title="Delivery Verification Policy"
          description="Your organisation's policy for verifying delivery."
          policyName={deliveryPolicy.rule.name}
          requiredApprovals={deliveryPolicy.rule.requiredApprovals}
          requiredRoles={deliveryPolicy.rule.requiredRoles}
          autoApprove={deliveryPolicy.rule.autoApprove}
          userRole={user?.orgRole}
          noPermissionText="does not have permission to verify delivery."
        />
      )}

      {/* Resolved Dispute Banner — shown when PO was resolved from a dispute */}
      {poDispute &&
        poDispute.status === "RESOLVED" &&
        po.status !== "DISPUTED" && (
          <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800 dark:text-green-200">
              Dispute Resolved
            </AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300 space-y-2">
              <p>
                This dispute was resolved with outcome:{" "}
                <span className="font-semibold">
                  {poDispute.outcome === "FULL_REFUND"
                    ? "Full Refund"
                    : poDispute.outcome === "PARTIAL_REFUND"
                      ? "Partial Refund"
                      : poDispute.outcome === "RELEASE_TO_SUPPLIER"
                        ? "Released to Supplier"
                        : poDispute.outcome === "REWORK"
                          ? "Rework Required"
                          : statusLabel(poDispute.outcome ?? "")}
                </span>
              </p>
              {poDispute.refundAmount !== null &&
                poDispute.refundAmount !== undefined && (
                  <p className="text-sm">
                    Refund Amount:{" "}
                    <span className="font-semibold">
                      {formatCurrency(
                        poDispute.refundAmount,
                        po.currency as "GBP" | "SAR",
                      )}
                    </span>{" "}
                    of{" "}
                    {formatCurrency(
                      po.totalAmountPennies,
                      po.currency as "GBP" | "SAR",
                    )}{" "}
                    total
                  </p>
                )}
              {poDispute.resolutionNotes && (
                <div className="rounded-md bg-green-100/60 dark:bg-green-900/30 px-3 py-2 text-sm">
                  <p className="font-medium">Resolution Notes</p>
                  <p>{poDispute.resolutionNotes}</p>
                </div>
              )}
              <Link
                href={`/dashboard/disputes/${poDispute.id}`}
                className="inline-block text-xs underline"
              >
                View full dispute details
              </Link>
            </AlertDescription>
          </Alert>
        )}

      {/* Dispute Banner — shown when PO is DISPUTED */}
      {po.status === "DISPUTED" && (
        <Alert className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <Scale className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800 dark:text-red-200">
            Dispute in Progress
          </AlertTitle>
          <AlertDescription className="text-red-700 dark:text-red-300 space-y-2">
            {poDispute ? (
              <>
                <p>
                  This PO was disputed by the buyer. Status:{" "}
                  <span className="font-semibold">
                    {statusLabel(poDispute.status)}
                  </span>
                </p>
                <div className="rounded-md bg-red-100/60 dark:bg-red-900/30 px-3 py-2 text-sm space-y-1">
                  <p className="font-medium">Reason</p>
                  <p>{poDispute.reason}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-2">
                  <span>
                    Buyer Evidence:{" "}
                    <span className="font-semibold">
                      {(poDispute.buyerEvidence?.length ?? 0) > 0
                        ? `${poDispute.buyerEvidence!.length} file(s)`
                        : "None yet"}
                    </span>
                  </span>
                  <span>
                    Supplier Evidence:{" "}
                    <span className="font-semibold">
                      {(poDispute.supplierEvidence?.length ?? 0) > 0
                        ? `${poDispute.supplierEvidence!.length} file(s)`
                        : "None yet"}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {user?.role === "ADMIN"
                    ? "As admin, you can review and resolve this dispute from the Disputes page."
                    : user?.role === "BUYER" || user?.role === "SUPPLIER"
                      ? "Both buyer and supplier can submit evidence. An admin will review and resolve the dispute."
                      : "An admin will review the evidence and decide the outcome."}
                </p>
              </>
            ) : (
              <p>
                This purchase order is under dispute. A platform admin will
                review and resolve it.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {signing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Fingerprint className="h-4 w-4 animate-pulse" />
            Waiting for biometric…
          </div>
        )}
        {isBuyer && po.status === "DRAFT" && (
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || signing}
          >
            <Send className="mr-2 h-4 w-4" />
            Send to Supplier
          </Button>
        )}
        {isSupplier &&
          po.status === "SENT" &&
          (() => {
            // Auto-approve skips multi-step approval, but the permission gate still applies
            const defaultRoles = ["OWNER", "APPROVER", "FINANCE"];
            const policyRoles = supplierPolicy?.rule?.requiredRoles;
            const supplierActionRoles = (
              policyRoles && policyRoles.length > 0 ? policyRoles : defaultRoles
            ).map((r: string) => r.toUpperCase());
            const canSupplierAct =
              user?.orgRole && supplierActionRoles.includes(user.orgRole);
            if (!canSupplierAct) return null;
            return (
              <>
                <Button
                  onClick={() => acceptMutation.mutate()}
                  disabled={acceptMutation.isPending || signing}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Accept
                </Button>
                {(po.currentRevision ?? 0) === 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCounterItems(po.lineItems.map((li) => ({ ...li })));
                      setCounterNotes("");
                      setShowCounterForm(true);
                    }}
                    disabled={counterMutation.isPending || signing}
                  >
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Counter-Propose
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending || signing}
                >
                  <X className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </>
            );
          })()}
        {isBuyer &&
          po.status === "ACCEPTED" &&
          !po.paymentLock &&
          !escrowDetails && (
            <Button
              onClick={() => fundEscrowMutation.mutate()}
              disabled={fundEscrowMutation.isPending || signing}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Fund Escrow
            </Button>
          )}
        {isBuyer &&
          po.status === "ACCEPTED" &&
          (escrowDetails || isServerFundingPending) && (
            <div className="flex items-center gap-2 text-sm text-amber-600 font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              Awaiting bank confirmation…
            </div>
          )}
        {isSupplier &&
          po.status === "FULFILLMENT" &&
          (() => {
            const defRoles = ["OWNER", "FINANCE"];
            const rr = earlyPayPolicy?.rule?.requiredRoles;
            const fulfillmentRoles = (rr && rr.length > 0 ? rr : defRoles).map(
              (r: string) => r.toUpperCase(),
            );
            const canAct =
              user?.orgRole && fulfillmentRoles.includes(user.orgRole);
            return (
              <div className="flex w-full flex-col gap-3 rounded-lg border p-4">
                {po.paymentLock?.status === "LOCKED" ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                    <ShieldCheck className="h-5 w-5" />
                    Payment Secured — Buyer has funded escrow
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                    <AlertTriangle className="h-5 w-5" />
                    Payment Not Locked — Waiting for buyer to fund escrow
                  </div>
                )}
                <Separator />
                {canAct ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => shipMutation.mutate()}
                      disabled={
                        shipMutation.isPending ||
                        signing ||
                        po.paymentLock?.status !== "LOCKED"
                      }
                    >
                      <Package className="mr-2 h-4 w-4" />
                      Mark Shipped
                    </Button>
                    {!hasEarlyPayRequest &&
                    po.paymentLock?.status === "LOCKED" ? (
                      <Link href="/dashboard/early-payments">
                        <Button variant="outline">
                          <CreditCard className="mr-2 h-4 w-4" />
                          Request Early Payment
                        </Button>
                      </Link>
                    ) : hasEarlyPayRequest ? (
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-inset ring-amber-300">
                        <CreditCard className="mr-1.5 h-4 w-4" />
                        Early Payment Requested
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Your role (
                    <span className="font-semibold">
                      {user?.orgRole?.charAt(0)}
                      {user?.orgRole?.slice(1).toLowerCase()}
                    </span>
                    ) does not have permission to perform actions on this PO.
                    Required: {fulfillmentRoles.join(", ")}.
                  </p>
                )}
              </div>
            );
          })()}
        {isSupplier &&
          po.status === "SHIPPED" &&
          (() => {
            const defRoles = ["OWNER", "FINANCE"];
            const rr = earlyPayPolicy?.rule?.requiredRoles;
            const actionRoles = (rr && rr.length > 0 ? rr : defRoles).map(
              (r: string) => r.toUpperCase(),
            );
            const canAct = user?.orgRole && actionRoles.includes(user.orgRole);
            if (!canAct) return null;
            return (
              <>
                <Button
                  onClick={() => deliverMutation.mutate()}
                  disabled={deliverMutation.isPending || signing}
                >
                  <Truck className="mr-2 h-4 w-4" />
                  Mark Delivered
                </Button>
                {!hasEarlyPayRequest && po.paymentLock?.status === "LOCKED" ? (
                  <Link href="/dashboard/early-payments">
                    <Button variant="outline">
                      <CreditCard className="mr-2 h-4 w-4" />
                      Request Early Payment
                    </Button>
                  </Link>
                ) : hasEarlyPayRequest ? (
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-inset ring-amber-300">
                    <CreditCard className="mr-1.5 h-4 w-4" />
                    Early Payment Requested
                  </span>
                ) : null}
              </>
            );
          })()}
        {isSupplier &&
          po.status === "DELIVERED" &&
          (() => {
            const defRoles = ["OWNER", "FINANCE"];
            const rr = earlyPayPolicy?.rule?.requiredRoles;
            const actionRoles = (rr && rr.length > 0 ? rr : defRoles).map(
              (r: string) => r.toUpperCase(),
            );
            const canAct = user?.orgRole && actionRoles.includes(user.orgRole);
            if (!canAct) return null;
            if (hasEarlyPayRequest)
              return (
                <span className="inline-flex items-center rounded-md bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-inset ring-amber-300">
                  <CreditCard className="mr-1.5 h-4 w-4" />
                  Early Payment Requested
                </span>
              );
            if (po.paymentLock?.status !== "LOCKED") return null;
            return (
              <Link href="/dashboard/early-payments">
                <Button>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Request Early Payment
                </Button>
              </Link>
            );
          })()}
        {isBuyer &&
          po.status === "DELIVERED" &&
          (() => {
            const defRoles = ["OWNER", "FINANCE"];
            const rr = deliveryPolicy?.rule?.requiredRoles;
            const actionRoles = (rr && rr.length > 0 ? rr : defRoles).map(
              (r: string) => r.toUpperCase(),
            );
            const canAct = user?.orgRole && actionRoles.includes(user.orgRole);
            if (!canAct) return null;
            return (
              <>
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending || signing}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Verify Delivery
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => disputeMutation.mutate()}
                  disabled={disputeMutation.isPending || signing}
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Dispute
                </Button>
              </>
            );
          })()}
        {isBuyer &&
          po.status === "VERIFIED" &&
          (() => {
            const defRoles = ["OWNER", "FINANCE"];
            const rr = deliveryPolicy?.rule?.requiredRoles;
            const actionRoles = (rr && rr.length > 0 ? rr : defRoles).map(
              (r: string) => r.toUpperCase(),
            );
            const canAct = user?.orgRole && actionRoles.includes(user.orgRole);
            if (!canAct) return null;
            return (
              <Button
                onClick={() => acknowledgeMutation.mutate()}
                disabled={acknowledgeMutation.isPending || signing}
              >
                <HandCoins className="mr-2 h-4 w-4" />
                Acknowledge &amp; Settle
              </Button>
            );
          })()}
        {canRespondToCounter &&
          (() => {
            const negRoles = (
              negotiationPolicy?.rule?.requiredRoles ?? [
                "OWNER",
                "APPROVER",
                "FINANCE",
              ]
            ).map((r: string) => r.toUpperCase());
            const canNegotiate =
              user?.orgRole && negRoles.includes(user.orgRole);
            if (!canNegotiate) return null;
            return (
              <>
                <Button
                  onClick={() => acceptCounterMutation.mutate()}
                  disabled={acceptCounterMutation.isPending || signing}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Accept Counter
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const rev = latestRevision;
                    setCounterItems(
                      (rev?.lineItems as LineItem[])?.map((li) => ({
                        ...li,
                      })) ?? po.lineItems.map((li) => ({ ...li })),
                    );
                    setCounterNotes("");
                    setShowCounterForm(true);
                  }}
                  disabled={counterMutation.isPending || signing}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Counter Again
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => rejectCounterMutation.mutate()}
                  disabled={rejectCounterMutation.isPending || signing}
                >
                  <X className="mr-2 h-4 w-4" />
                  Reject Counter
                </Button>
              </>
            );
          })()}
        {po.status === "DISPUTED" &&
          poDispute &&
          (() => {
            const isAdmin = user?.role === "ADMIN";
            const disputeHref = `/dashboard/disputes/${poDispute.id}`;
            return (
              <div className="flex w-full flex-col gap-3 rounded-lg border border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/10 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                  <Scale className="h-5 w-5" />
                  Dispute Actions
                </div>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  {(isBuyer || isSupplier) &&
                    poDispute.status !== "RESOLVED" && (
                      <Link href={disputeHref}>
                        <Button>
                          <FileText className="mr-2 h-4 w-4" />
                          Submit Evidence
                        </Button>
                      </Link>
                    )}
                  {isAdmin && (
                    <Link href={disputeHref}>
                      <Button>
                        <Scale className="mr-2 h-4 w-4" />
                        Review &amp; Resolve
                      </Button>
                    </Link>
                  )}
                  <Link href={disputeHref}>
                    <Button variant="outline">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View Details
                    </Button>
                  </Link>
                </div>
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Only a platform admin can resolve disputes. Contact your
                    admin or wait for the resolution.
                  </p>
                )}
              </div>
            );
          })()}
      </div>

      {/* Escrow Payment Instructions — shown while funding is pending */}
      {isBuyer &&
        po.status === "ACCEPTED" &&
        (escrowDetails || isServerFundingPending) && (
          <Card className="border-amber-300 bg-amber-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-600" />
                Escrow Payment Details
              </CardTitle>
              <CardDescription>
                Transfer the amount below to the escrow account. The system will
                automatically confirm once the bank verifies the deposit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-md border bg-white p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold text-lg">
                    {formatCurrency(
                      po.totalAmountPennies,
                      po.currency as "GBP" | "SAR",
                    )}
                  </span>
                </div>
                <Separator />
                {escrowDetails ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bank</span>
                      <span className="font-medium">{escrowDetails.bank}</span>
                    </div>
                    {escrowDetails.iban && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IBAN</span>
                        <span className="font-mono font-medium tracking-wider">
                          {escrowDetails.iban}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Account Label
                      </span>
                      <span className="font-medium">{escrowDetails.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Currency</span>
                      <Badge variant="outline">{escrowDetails.currency}</Badge>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Server-side pending: no escrow details cached, show lock info */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Payment Lock
                      </span>
                      <Badge variant="secondary">
                        {statusLabel(po.paymentLock?.status ?? "")}
                      </Badge>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reference</span>
                  <span className="font-mono text-xs">
                    {po.paymentLock?.externalRef || po.reference}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-amber-700">
                <Clock className="h-4 w-4" />
                <span className="text-xs">
                  Awaiting bank confirmation — this page will update
                  automatically. In simulation mode, this completes in a few
                  seconds.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Counter-Proposal Form */}
      {showCounterForm && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Counter-Proposal
            </CardTitle>
            <CardDescription>
              Edit line items and submit your counter-proposal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px] text-right">Qty</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Unit Price (pennies)
                  </TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {counterItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input
                        value={item.description}
                        onChange={(e) => {
                          const next = [...counterItems];
                          next[i] = { ...next[i], description: e.target.value };
                          setCounterItems(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        className="text-right"
                        value={item.quantity}
                        onChange={(e) => {
                          const next = [...counterItems];
                          next[i] = {
                            ...next[i],
                            quantity: Number(e.target.value),
                          };
                          setCounterItems(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        className="text-right"
                        value={item.unitPricePennies}
                        onChange={(e) => {
                          const next = [...counterItems];
                          next[i] = {
                            ...next[i],
                            unitPricePennies: Number(e.target.value),
                          };
                          setCounterItems(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setCounterItems(
                            counterItems.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCounterItems([
                  ...counterItems,
                  { description: "", quantity: 1, unitPricePennies: 0 },
                ])
              }
            >
              + Add Line Item
            </Button>
            <div className="flex justify-between text-sm font-medium">
              <span>Counter Total</span>
              <span>
                {formatCurrency(
                  counterItems.reduce(
                    (sum, li) => sum + li.quantity * li.unitPricePennies,
                    0,
                  ),
                  po.currency as "GBP" | "SAR",
                )}
              </span>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Explain your proposed changes…"
                value={counterNotes}
                onChange={(e) => setCounterNotes(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => counterMutation.mutate()}
                disabled={
                  counterMutation.isPending ||
                  signing ||
                  counterItems.length === 0
                }
              >
                <Send className="mr-2 h-4 w-4" />
                Submit Counter-Proposal
              </Button>
              <Button variant="ghost" onClick={() => setShowCounterForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buyer</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{po.buyer?.companyName}</p>
            <p className="text-muted-foreground">{po.buyer?.name}</p>
            <p className="text-muted-foreground">{po.buyer?.email}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supplier</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{po.supplier?.companyName}</p>
            <p className="text-muted-foreground">{po.supplier?.name}</p>
            <p className="text-muted-foreground">{po.supplier?.email}</p>
          </CardContent>
        </Card>
      </div>

      {po.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{po.description}</p>
          </CardContent>
        </Card>
      )}

      {po.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Special Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{po.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lineItems.map((item, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.sku || "—"}
                  </TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.unitOfMeasure || "EACH"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      item.unitPricePennies,
                      po.currency as "GBP" | "SAR",
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(
                      item.quantity * item.unitPricePennies,
                      po.currency as "GBP" | "SAR",
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Separator className="my-3" />
          <div className="flex justify-between text-sm">
            <span className="font-medium">Total</span>
            <span className="text-lg font-bold">
              {formatCurrency(
                po.totalAmountPennies,
                po.currency as "GBP" | "SAR",
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Payment Lock */}
      {po.paymentLock && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment Lock</CardTitle>
            <CardDescription>
              Funds locked in escrow for this order
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Amount</span>
              <span className="font-medium">
                {formatCurrency(
                  po.paymentLock.amountPennies,
                  po.currency as "GBP" | "SAR",
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Status</span>
              <Badge variant={statusVariant(po.paymentLock.status)}>
                {statusLabel(po.paymentLock.status)}
              </Badge>
            </div>
            {po.paymentLock.status === "REFUNDED" &&
              poDispute?.refundAmount != null &&
              poDispute.refundAmount < po.paymentLock.amountPennies && (
                <div className="flex justify-between">
                  <span>Refunded Amount</span>
                  <span className="font-medium">
                    {formatCurrency(
                      poDispute.refundAmount,
                      po.currency as "GBP" | "SAR",
                    )}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      (partial)
                    </span>
                  </span>
                </div>
              )}
            {po.paymentLock.lockedAt && (
              <div className="flex justify-between">
                <span>Locked at</span>
                <span className="text-muted-foreground">
                  {formatDateTime(po.paymentLock.lockedAt)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Extended PO Fields */}
      {(po.externalPoNumber ||
        po.paymentTerms !== "IMMEDIATE" ||
        po.deliveryTerms !== "EX_WORKS" ||
        (po.taxRate ?? 0) > 0 ||
        po.expectedDeliveryDate ||
        po.buyerContactName ||
        po.shippedAt) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Terms</CardTitle>
            <CardDescription>
              Payment, delivery, and tax details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {po.externalPoNumber && (
              <div className="flex justify-between">
                <span>External PO #</span>
                <span className="font-mono font-medium">
                  {po.externalPoNumber}
                </span>
              </div>
            )}
            {po.expectedDeliveryDate && (
              <div className="flex justify-between">
                <span>Expected Delivery</span>
                <span>{formatDate(po.expectedDeliveryDate)}</span>
              </div>
            )}
            {po.shippedAt && (
              <div className="flex justify-between">
                <span>Shipped At</span>
                <span>{formatDateTime(po.shippedAt)}</span>
              </div>
            )}
            {po.buyerContactName && (
              <div className="flex justify-between">
                <span>Buyer Contact</span>
                <span>
                  {po.buyerContactName}
                  {po.buyerContactEmail && (
                    <span className="text-muted-foreground ml-2">
                      ({po.buyerContactEmail})
                    </span>
                  )}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Payment Terms</span>
              <Badge variant="outline">
                {po.paymentTerms?.replace("_", " ") || "IMMEDIATE"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Delivery Terms</span>
              <Badge variant="outline">
                {po.deliveryTerms?.replace("_", " ") || "EX WORKS"}
              </Badge>
            </div>
            {po.deliveryAddress && (
              <div className="flex justify-between">
                <span>Delivery Address</span>
                <span className="text-muted-foreground text-right max-w-[60%]">
                  {po.deliveryAddress}
                </span>
              </div>
            )}
            {(po.taxRate ?? 0) > 0 && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span>Tax Rate</span>
                  <span>{((po.taxRate ?? 0) / 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax Amount</span>
                  <span>
                    {formatCurrency(
                      po.taxAmount ?? 0,
                      po.currency as "GBP" | "SAR",
                    )}
                  </span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Gross Amount</span>
                  <span>
                    {formatCurrency(
                      po.grossAmount ?? po.totalAmountPennies,
                      po.currency as "GBP" | "SAR",
                    )}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span>Dispute Window</span>
              <span>{po.disputeWindowHours ?? 72}h</span>
            </div>
            {po.partialAcceptanceAllowed && (
              <div className="flex justify-between">
                <span>Partial Acceptance</span>
                <Badge variant="secondary">Allowed</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Evidence & Attachments */}
      <EvidencePanel purchaseOrderId={id} />

      {/* Financial Instrument & Reconciliation */}
      <InstrumentLifecycleCard purchaseOrderId={id} />

      {/* Negotiation History */}
      {po.revisions && po.revisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Negotiation History
            </CardTitle>
            <CardDescription>
              Revision {po.currentRevision ?? po.revisions.length} —{" "}
              {po.revisions.length} counter-proposal
              {po.revisions.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {po.revisions.map((rev) => (
              <div
                key={rev.id}
                className="rounded-md border p-3 text-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Rev #{rev.revision}</span>
                    <Badge variant="outline" className="text-xs">
                      {rev.proposedByRole}
                    </Badge>
                  </div>
                  <Badge
                    variant={
                      rev.status === "ACCEPTED"
                        ? "default"
                        : rev.status === "REJECTED"
                          ? "destructive"
                          : rev.status === "PENDING"
                            ? "secondary"
                            : "outline"
                    }
                  >
                    {statusLabel(rev.status)}
                  </Badge>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    Amount:{" "}
                    {formatCurrency(rev.amount, po.currency as "GBP" | "SAR")}
                  </span>
                  <span>{formatDateTime(rev.createdAt)}</span>
                </div>
                {rev.notes && (
                  <p className="text-xs text-muted-foreground italic">
                    &ldquo;{rev.notes}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Event Timeline */}
      {events && events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Timeline</CardTitle>
            <CardDescription>
              Cryptographically linked audit trail
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-primary" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {statusLabel(event.eventType)}
                      </p>
                      {event.actorSignature &&
                        event.actorSignature !== "SYSTEM" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] gap-1"
                          >
                            <Fingerprint className="h-3 w-3" />
                            Signed
                          </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                  <code className="text-[10px] text-muted-foreground font-mono">
                    {event.eventHash.slice(0, 12)}…
                  </code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
