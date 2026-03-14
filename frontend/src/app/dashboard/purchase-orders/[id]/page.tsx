"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  poApi,
  ledgerApi,
  type SignaturePayload,
  type LineItem,
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
  Fingerprint,
  MessageSquare,
  RotateCcw,
  Wallet,
  Building2,
  Clock,
  CreditCard,
  Loader2,
} from "lucide-react";

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

  const { data: events } = useQuery({
    queryKey: ["ledger", id],
    queryFn: () => ledgerApi.list(id).then((r) => r.data),
    enabled: !!id,
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
        {isSupplier && po.status === "SENT" && (
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
        )}
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
        {isSupplier && po.status === "FULFILLMENT" && (
          <div className="flex items-center gap-3">
            {po.paymentLock?.status === "LOCKED" ? (
              <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                <ShieldCheck className="h-4 w-4" />
                Payment Secured
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-amber-600 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Payment Not Locked
              </span>
            )}
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
          </div>
        )}
        {isSupplier && po.status === "SHIPPED" && (
          <Button
            onClick={() => deliverMutation.mutate()}
            disabled={deliverMutation.isPending || signing}
          >
            <Truck className="mr-2 h-4 w-4" />
            Mark Delivered
          </Button>
        )}
        {isBuyer && po.status === "DELIVERED" && (
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
        )}
        {isBuyer && po.status === "VERIFIED" && (
          <Button
            onClick={() => acknowledgeMutation.mutate()}
            disabled={acknowledgeMutation.isPending || signing}
          >
            <HandCoins className="mr-2 h-4 w-4" />
            Acknowledge &amp; Settle
          </Button>
        )}
        {canRespondToCounter && (
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
                  (rev?.lineItems as LineItem[])?.map((li) => ({ ...li })) ??
                    po.lineItems.map((li) => ({ ...li })),
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
        )}
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
                        {po.paymentLock?.status}
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
                    {rev.status}
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
