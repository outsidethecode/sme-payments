"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  earlyPayApi,
  poApi,
  passkeysApi,
  type SignaturePayload,
  type RiskSnapshot,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePasskey } from "@/lib/use-passkey";
import { storeReceipt } from "@/lib/receipt-store";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Zap,
  DollarSign,
  ShieldCheck,
  TrendingUp,
  Fingerprint,
  Shield,
  AlertTriangle,
  CheckCircle2,
  ArrowUpDown,
} from "lucide-react";
import { useState, useMemo } from "react";

export default function EarlyPaymentsPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "SUPPLIER") return <SupplierView />;
  if (user.role === "LIQUIDITY_PARTNER") return <LPView />;
  if (user.role === "ADMIN") return <AdminView />;
  return (
    <div className="py-12 text-center text-muted-foreground">
      Early payments is not available for your role.
    </div>
  );
}

// ── Supplier View ─────────────────────────────────────────────

function SupplierView() {
  const queryClient = useQueryClient();
  const { hasPasskey, signing, signAction } = usePasskey();

  const { data: earlyPayments, isLoading: epLoading } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
  });

  const { data: pos, isLoading: posLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => poApi.list().then((r) => r.data),
  });

  const requestMutation = useMutation({
    mutationFn: async (poId: string) => {
      const sigResult = await signAction("EARLY_PAYMENT_REQUESTED", poId);
      let signatureData: SignaturePayload | undefined;
      if (sigResult) {
        const { data: verified } = await passkeysApi.authVerify(
          sigResult.purpose,
          sigResult.assertion,
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
      return earlyPayApi.request(poId, signatureData);
    },
    onSuccess: (result: unknown) => {
      const axiosData = (result as { data?: Record<string, unknown> })?.data;
      if (axiosData) storeReceipt(axiosData).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["early-payments"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(
        hasPasskey
          ? "Early payment requested ✓ Passkey signed"
          : "Early payment requested successfully",
      );
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(
        err.response?.data?.message || "Failed to request early payment",
      );
    },
  });

  const eligiblePOs = pos?.filter(
    (po) =>
      (po.status === "ACCEPTED" ||
        po.status === "FULFILLMENT" ||
        po.status === "SHIPPED" ||
        po.status === "DELIVERED") &&
      !earlyPayments?.find((ep) => ep.purchaseOrderId === po.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Early Payments</h1>
        <p className="text-sm text-muted-foreground">
          Get paid early on accepted purchase orders
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            How Early Payment Works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            1. Your PO must be <strong>accepted</strong> with payment locked by
            the buyer.
          </p>
          <p>2. Request early payment, a flat 2.5% service fee applies.</p>
          <p>
            3. A liquidity partner funds the advance, you receive the net amount
            immediately.
          </p>
          <p>
            4. When the buyer verifies delivery, the locked funds settle to the
            liquidity partner.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Eligible Purchase Orders</CardTitle>
          <CardDescription>
            POs with locked payment that you can request early payment on
          </CardDescription>
        </CardHeader>
        <CardContent>
          {posLoading || epLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !eligiblePOs?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No eligible purchase orders for early payment.</p>
              <p className="text-xs mt-1">
                POs must be accepted with locked payment and not already have an
                early payment request.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Fee (2.5%)</TableHead>
                  <TableHead>You Receive</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligiblePOs.map((po) => {
                  const fee = Math.round(
                    (po.totalAmountPennies * 250) / 10_000,
                  );
                  const net = po.totalAmountPennies - fee;
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-sm">
                        {po.reference}
                      </TableCell>
                      <TableCell>{po.buyer?.companyName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(po.status)}>
                          {statusLabel(po.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(
                          po.totalAmountPennies,
                          po.currency as "GBP" | "SAR",
                        )}
                      </TableCell>
                      <TableCell className="text-destructive">
                        -{formatCurrency(fee, po.currency as "GBP" | "SAR")}
                      </TableCell>
                      <TableCell className="font-medium text-green-600">
                        {formatCurrency(net, po.currency as "GBP" | "SAR")}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => requestMutation.mutate(po.id)}
                          disabled={requestMutation.isPending || signing}
                        >
                          {signing ? (
                            <Fingerprint className="mr-1 h-3 w-3 animate-pulse" />
                          ) : (
                            <Zap className="mr-1 h-3 w-3" />
                          )}
                          {signing ? "Signing…" : "Request"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {earlyPayments && earlyPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Your Early Payment Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Reference</TableHead>
                  <TableHead>Face Value</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>You Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earlyPayments.map((ep) => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-mono text-sm">
                      {ep.purchaseOrder?.reference ?? "—"}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        ep.faceValuePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell className="text-destructive">
                      -
                      {formatCurrency(
                        ep.serviceFeePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-green-600">
                      {formatCurrency(
                        ep.netAdvancePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ep.status)}>
                        {statusLabel(ep.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(ep.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Risk display helpers ──────────────────────────────────────

function riskColor(score: number) {
  if (score >= 8) return "text-green-600 bg-green-50 border-green-200";
  if (score >= 5) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function riskIcon(score: number) {
  if (score >= 8) return <CheckCircle2 className="h-3 w-3" />;
  if (score >= 5) return <Shield className="h-3 w-3" />;
  return <AlertTriangle className="h-3 w-3" />;
}

function riskLabel(score: number) {
  if (score >= 8) return "Low Risk";
  if (score >= 5) return "Medium Risk";
  return "High Risk";
}

function RiskBadge({ risk }: { risk: RiskSnapshot }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${riskColor(risk.riskScore)}`}
          >
            {riskIcon(risk.riskScore)}
            {risk.riskScore.toFixed(1)} / 10
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs">
          <p className="font-semibold">{riskLabel(risk.riskScore)}</p>
          <p className="text-xs">
            Default probability: {risk.defaultProbability.toFixed(1)}%
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RiskBreakdown({ risk }: { risk: RiskSnapshot }) {
  return (
    <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5">
      <p className="font-medium text-sm flex items-center gap-1.5">
        {riskIcon(risk.riskScore)}
        Risk Assessment — {riskLabel(risk.riskScore)} (
        {risk.riskScore.toFixed(1)}/10)
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
        <span>
          Payment Locked:{" "}
          <span
            className={risk.paymentLocked ? "text-green-600" : "text-red-500"}
          >
            {risk.paymentLocked ? "Yes" : "No"}
          </span>
        </span>
        <span>
          Delivery:{" "}
          <span className="text-foreground">{risk.deliveryStatus}</span>
        </span>
        <span>
          Buyer Disputes:{" "}
          <span
            className={
              risk.buyerDisputeRate > 0.1 ? "text-amber-600" : "text-green-600"
            }
          >
            {(risk.buyerDisputeRate * 100).toFixed(1)}%
          </span>
        </span>
        <span>
          Bank Confirmed:{" "}
          <span
            className={
              risk.bankReference ? "text-green-600" : "text-muted-foreground"
            }
          >
            {risk.bankReference ?? "Pending"}
          </span>
        </span>
        <span>
          Evidence Pack:{" "}
          <span
            className={
              risk.evidencePackAvailable
                ? "text-green-600"
                : "text-muted-foreground"
            }
          >
            {risk.evidencePackAvailable ? "Available" : "None"}
          </span>
        </span>
        {risk.expectedSettlement && (
          <span>
            Exp. Settlement:{" "}
            <span className="text-foreground">
              {formatDate(risk.expectedSettlement)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── LP View ───────────────────────────────────────────────────

function LPView() {
  const queryClient = useQueryClient();
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("newest");
  const { hasPasskey, signing, signAction } = usePasskey();

  const { data: marketplace, isLoading: mktLoading } = useQuery({
    queryKey: ["early-payments-marketplace"],
    queryFn: () => earlyPayApi.marketplace().then((r) => r.data),
  });

  const { data: myPayments } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
  });

  const sortedMarketplace = useMemo(() => {
    if (!marketplace) return [];
    const sorted = [...marketplace];
    switch (sortBy) {
      case "risk-high":
        return sorted.sort(
          (a, b) => (b.risk?.riskScore ?? 0) - (a.risk?.riskScore ?? 0),
        );
      case "risk-low":
        return sorted.sort(
          (a, b) => (a.risk?.riskScore ?? 0) - (b.risk?.riskScore ?? 0),
        );
      case "value-high":
        return sorted.sort((a, b) => b.faceValuePennies - a.faceValuePennies);
      default:
        return sorted;
    }
  }, [marketplace, sortBy]);

  const fundMutation = useMutation({
    mutationFn: async (id: string) => {
      const sigResult = await signAction("EARLY_PAYMENT_FUNDED", id);
      let signatureData: SignaturePayload | undefined;
      if (sigResult) {
        const { data: verified } = await passkeysApi.authVerify(
          sigResult.purpose,
          sigResult.assertion,
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
      return earlyPayApi.fund(id, signatureData);
    },
    onSuccess: (result: unknown) => {
      const axiosData = (result as { data?: Record<string, unknown> })?.data;
      if (axiosData) storeReceipt(axiosData).catch(() => {});
      queryClient.invalidateQueries({
        queryKey: ["early-payments-marketplace"],
      });
      queryClient.invalidateQueries({ queryKey: ["early-payments"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
      toast.success(
        hasPasskey
          ? "Early payment funded ✓ Passkey signed"
          : "Early payment funded successfully",
      );
      setFundingId(null);
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(
        err.response?.data?.message || "Failed to fund early payment",
      );
      setFundingId(null);
    },
  });

  const funded = myPayments?.filter((ep) => ep.status !== "REQUESTED") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Early Payment Marketplace
        </h1>
        <p className="text-sm text-muted-foreground">
          Fund verified purchase orders for a service fee return
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            How It Works for Liquidity Partners
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            1. Browse accepted POs where suppliers have requested early payment.
          </p>
          <p>
            2. You advance the <strong>net amount</strong> (face value minus
            2.5% service fee) to the supplier.
          </p>
          <p>
            3. When the buyer verifies delivery, the{" "}
            <strong>full locked amount</strong> (minus platform fee) settles to
            you.
          </p>
          <p>
            4. You bear genuine delivery risk, if the buyer disputes, settlement
            is delayed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                Available Requests
              </CardTitle>
              <CardDescription>
                {marketplace?.length ?? 0} early payment request
                {(marketplace?.length ?? 0) !== 1 ? "s" : ""} available to fund
              </CardDescription>
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[180px]">
                <ArrowUpDown className="mr-2 h-3 w-3" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="risk-high">Safest First (Risk ↓)</SelectItem>
                <SelectItem value="risk-low">
                  Riskiest First (Risk ↑)
                </SelectItem>
                <SelectItem value="value-high">Highest Value</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {mktLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !marketplace?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No early payment requests available right now.</p>
              <p className="text-xs mt-1">
                Requests appear when suppliers request early payment on accepted
                POs.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedMarketplace.map((ep) => (
                <div key={ep.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono text-sm font-medium">
                        {ep.purchaseOrder?.reference}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {ep.supplier?.companyName} →{" "}
                        {ep.purchaseOrder?.buyer?.companyName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {ep.risk && <RiskBadge risk={ep.risk} />}
                      <Badge variant="outline">
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        Payment Locked
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Face Value</p>
                      <p className="font-medium">
                        {formatCurrency(
                          ep.faceValuePennies,
                          ep.currency as "GBP" | "SAR",
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Service Fee (2.5%)
                      </p>
                      <p className="font-medium text-green-600">
                        +
                        {formatCurrency(
                          ep.serviceFeePennies,
                          ep.currency as "GBP" | "SAR",
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">You Advance</p>
                      <p className="font-medium">
                        {formatCurrency(
                          ep.netAdvancePennies,
                          ep.currency as "GBP" | "SAR",
                        )}
                      </p>
                    </div>
                  </div>

                  {ep.risk && <RiskBreakdown risk={ep.risk} />}

                  <Separator />

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Requested {formatDateTime(ep.createdAt)}
                    </p>
                    {fundingId === ep.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Confirm funding?
                        </span>
                        <Button
                          size="sm"
                          onClick={() => fundMutation.mutate(ep.id)}
                          disabled={fundMutation.isPending || signing}
                        >
                          {signing ? (
                            <>
                              <Fingerprint className="mr-1 h-3 w-3 animate-pulse" />
                              Signing…
                            </>
                          ) : fundMutation.isPending ? (
                            "Funding…"
                          ) : (
                            "Confirm"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setFundingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => setFundingId(ep.id)}>
                        <DollarSign className="mr-1 h-3 w-3" />
                        Fund This Request
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {funded.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Funded Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Reference</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Advanced</TableHead>
                  <TableHead>Fee Earned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Funded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funded.map((ep) => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-mono text-sm">
                      {ep.purchaseOrder?.reference ?? "—"}
                    </TableCell>
                    <TableCell>{ep.supplier?.companyName ?? "—"}</TableCell>
                    <TableCell>
                      {formatCurrency(
                        ep.netAdvancePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell className="text-green-600">
                      +
                      {formatCurrency(
                        ep.serviceFeePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ep.status)}>
                        {statusLabel(ep.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ep.fundedAt ? formatDate(ep.fundedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Admin View ────────────────────────────────────────────────

function AdminView() {
  const { data: earlyPayments, isLoading } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Early Payments</h1>
        <p className="text-sm text-muted-foreground">
          Admin view of all early payment requests
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            All Early Payment Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !earlyPayments?.length ? (
            <p className="py-8 text-center text-muted-foreground">
              No early payment requests yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Reference</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>LP</TableHead>
                  <TableHead>Face Value</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earlyPayments.map((ep) => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-mono text-sm">
                      {ep.purchaseOrder?.reference ?? "—"}
                    </TableCell>
                    <TableCell>{ep.supplier?.companyName ?? "—"}</TableCell>
                    <TableCell>
                      {ep.liquidityPartner?.companyName ?? "—"}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        ep.faceValuePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        ep.serviceFeePennies,
                        ep.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ep.status)}>
                        {statusLabel(ep.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
