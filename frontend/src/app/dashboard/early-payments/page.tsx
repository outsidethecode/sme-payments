"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  earlyPayApi,
  poApi,
  passkeysApi,
  type SignaturePayload,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePasskey } from "@/lib/use-passkey";
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
} from "lucide-react";
import { useState } from "react";

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
    onSuccess: () => {
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
        po.status === "IN_PROGRESS" ||
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
                        {formatCurrency(po.totalAmountPennies)}
                      </TableCell>
                      <TableCell className="text-destructive">
                        -{formatCurrency(fee)}
                      </TableCell>
                      <TableCell className="font-medium text-green-600">
                        {formatCurrency(net)}
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
                    <TableCell>{formatCurrency(ep.faceValuePennies)}</TableCell>
                    <TableCell className="text-destructive">
                      -{formatCurrency(ep.serviceFeePennies)}
                    </TableCell>
                    <TableCell className="font-medium text-green-600">
                      {formatCurrency(ep.netAdvancePennies)}
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

// ── LP View ───────────────────────────────────────────────────

function LPView() {
  const queryClient = useQueryClient();
  const [fundingId, setFundingId] = useState<string | null>(null);
  const { hasPasskey, signing, signAction } = usePasskey();

  const { data: marketplace, isLoading: mktLoading } = useQuery({
    queryKey: ["early-payments-marketplace"],
    queryFn: () => earlyPayApi.marketplace().then((r) => r.data),
  });

  const { data: myPayments } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
  });

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
    onSuccess: () => {
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
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" />
            Available Requests
          </CardTitle>
          <CardDescription>
            {marketplace?.length ?? 0} early payment request
            {(marketplace?.length ?? 0) !== 1 ? "s" : ""} available to fund
          </CardDescription>
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
              {marketplace.map((ep) => (
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
                    <Badge variant="outline">
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Payment Locked
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Face Value</p>
                      <p className="font-medium">
                        {formatCurrency(ep.faceValuePennies)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Service Fee (2.5%)
                      </p>
                      <p className="font-medium text-green-600">
                        +{formatCurrency(ep.serviceFeePennies)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">You Advance</p>
                      <p className="font-medium">
                        {formatCurrency(ep.netAdvancePennies)}
                      </p>
                    </div>
                  </div>

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
                      {formatCurrency(ep.netAdvancePennies)}
                    </TableCell>
                    <TableCell className="text-green-600">
                      +{formatCurrency(ep.serviceFeePennies)}
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
                    <TableCell>{formatCurrency(ep.faceValuePennies)}</TableCell>
                    <TableCell>
                      {formatCurrency(ep.serviceFeePennies)}
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
