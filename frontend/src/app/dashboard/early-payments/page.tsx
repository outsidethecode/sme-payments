"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  earlyPayApi,
  poApi,
  passkeysApi,
  policiesApi,
  type SignaturePayload,
  type RiskSnapshot,
  type RiskFactorScore,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  Info,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useTranslation } from "@/i18n";

export default function EarlyPaymentsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  if (!user) return null;
  if (user.role === "SUPPLIER") return <SupplierView />;
  if (user.role === "LIQUIDITY_PARTNER") return <LPView />;
  if (user.role === "ADMIN") return <AdminView />;
  return (
    <div className="py-12 text-center text-muted-foreground">
      {t("earlyPayments.roleNotAvailable")}
    </div>
  );
}

// ── Supplier View ─────────────────────────────────────────────

function SupplierView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { hasPasskey, signing, signAction } = usePasskey();
  const { t } = useTranslation();

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
          ? t("earlyPayments.requestedPasskey")
          : t("earlyPayments.requestedSuccess"),
      );
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(
        err.response?.data?.message || t("earlyPayments.requestFailed"),
      );
    },
  });

  // Compute a representative amount for policy simulation
  const maxAmount =
    pos?.reduce((max, po) => Math.max(max, po.totalAmountPennies ?? 0), 0) ?? 0;

  const { data: epPolicy } = useQuery({
    queryKey: ["policy-simulate", "EARLY_PAYMENT", maxAmount],
    queryFn: () =>
      policiesApi.simulate(maxAmount, "EARLY_PAYMENT").then((r) => r.data),
    enabled: maxAmount > 0,
  });

  // Role guard: check if user's orgRole is allowed by policy
  const policyRoles = epPolicy?.rule?.requiredRoles ?? [];
  const allowedRoles =
    policyRoles.length > 0 ? policyRoles : ["OWNER", "FINANCE"]; // default — matches backend EARLY_PAYMENT allowed roles
  const userOrgRole = (user as any)?.orgRole;
  const canRequest = allowedRoles.includes(userOrgRole);

  const eligiblePOs = pos?.filter(
    (po) =>
      (po.status === "FULFILLMENT" ||
        po.status === "SHIPPED" ||
        po.status === "DELIVERED") &&
      !earlyPayments?.find((ep) => ep.purchaseOrderId === po.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("earlyPayments.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("earlyPayments.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            {t("earlyPayments.howItWorks")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("earlyPayments.howStep1")}</p>
          <p>{t("earlyPayments.howStep2")}</p>
          <p>{t("earlyPayments.howStep3")}</p>
          <p>{t("earlyPayments.howStep4")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("earlyPayments.eligiblePOs")}
          </CardTitle>
          <CardDescription>
            {t("earlyPayments.eligiblePOsDescription")}
          </CardDescription>
          {!canRequest && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                Your role (<strong>{userOrgRole}</strong>) cannot request early
                payments. Required: {allowedRoles.join(", ")}.
              </span>
            </div>
          )}
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
              <p>{t("earlyPayments.noEligiblePOs")}</p>
              <p className="text-xs mt-1">
                {t("earlyPayments.noEligiblePOsDescription")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("earlyPayments.colReference")}</TableHead>
                  <TableHead>{t("earlyPayments.colBuyer")}</TableHead>
                  <TableHead>{t("earlyPayments.colStatus")}</TableHead>
                  <TableHead>{t("earlyPayments.colAmount")}</TableHead>
                  <TableHead>{t("earlyPayments.colFee")}</TableHead>
                  <TableHead>{t("earlyPayments.colYouReceive")}</TableHead>
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
                        {canRequest ? (
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
                            {signing
                              ? t("earlyPayments.signing")
                              : t("earlyPayments.request")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No permission
                          </span>
                        )}
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
              {t("earlyPayments.yourRequests")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("earlyPayments.colPOReference")}</TableHead>
                  <TableHead>{t("earlyPayments.colFaceValue")}</TableHead>
                  <TableHead>{t("earlyPayments.colFeeLabel")}</TableHead>
                  <TableHead>{t("earlyPayments.colYouReceived")}</TableHead>
                  <TableHead>{t("earlyPayments.colStatus")}</TableHead>
                  <TableHead>{t("earlyPayments.colDate")}</TableHead>
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="inline-flex items-center gap-1">
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="View risk score breakdown"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>
      <RiskScoreModal risk={risk} open={open} onOpenChange={setOpen} />
    </>
  );
}

// ── Risk Score Explanation Modal ─────────────────────────────

function factorBarColor(score: number) {
  if (score >= 8) return "bg-green-500";
  if (score >= 5) return "bg-amber-500";
  return "bg-red-500";
}

function RiskScoreModal({
  risk,
  open,
  onOpenChange,
}: {
  risk: RiskSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Risk Score Breakdown
          </DialogTitle>
          <DialogDescription>
            The risk score is a weighted composite of 5 factors. A higher score
            (out of 10) means lower risk.
          </DialogDescription>
        </DialogHeader>

        {/* Overall score */}
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div
            className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${
              risk.riskScore >= 8
                ? "bg-green-500"
                : risk.riskScore >= 5
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
          >
            {risk.riskScore.toFixed(1)}
          </div>
          <div>
            <p className="font-semibold">{riskLabel(risk.riskScore)}</p>
            <p className="text-sm text-muted-foreground">
              {risk.defaultProbability.toFixed(1)}% estimated default
              probability
            </p>
          </div>
        </div>

        {/* Factor breakdown */}
        {risk.factors && risk.factors.length > 0 ? (
          <div className="space-y-3">
            {risk.factors.map((f) => (
              <div key={f.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-muted-foreground">
                    {f.score.toFixed(1)}/10{" "}
                    <span className="text-xs">
                      ({(f.weight * 100).toFixed(0)}% weight)
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full transition-all ${factorBarColor(f.score)}`}
                    style={{ width: `${(f.score / 10) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{f.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Detailed factor breakdown is not available for this assessment.
          </p>
        )}

        {/* How scoring works */}
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How is this calculated?</p>
          <p>
            Each factor is scored 0&ndash;10 and multiplied by its weight. The
            weighted scores are summed to produce the composite risk score. The
            default probability is the inverse of the composite mapped to
            0&ndash;100%.
          </p>
        </div>
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation();

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
          ? t("earlyPayments.fundedPasskey")
          : t("earlyPayments.fundedSuccess"),
      );
      setFundingId(null);
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message || t("earlyPayments.fundFailed"));
      setFundingId(null);
    },
  });

  const funded = myPayments?.filter((ep) => ep.status !== "REQUESTED") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("earlyPayments.lpTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("earlyPayments.lpSubtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            {t("earlyPayments.lpHowItWorks")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("earlyPayments.lpStep1")}</p>
          <p>{t("earlyPayments.lpStep2")}</p>
          <p>{t("earlyPayments.lpStep3")}</p>
          <p>{t("earlyPayments.lpStep4")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                {t("earlyPayments.availableRequests")}
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
                <SelectItem value="newest">
                  {t("earlyPayments.sortNewest")}
                </SelectItem>
                <SelectItem value="risk-high">
                  {t("earlyPayments.sortSafest")}
                </SelectItem>
                <SelectItem value="risk-low">
                  {t("earlyPayments.sortRiskiest")}
                </SelectItem>
                <SelectItem value="value-high">
                  {t("earlyPayments.sortHighestValue")}
                </SelectItem>
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
                        {t("earlyPayments.paymentLockedBadge")}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t("earlyPayments.faceValue")}
                      </p>
                      <p className="font-medium">
                        {formatCurrency(
                          ep.faceValuePennies,
                          ep.currency as "GBP" | "SAR",
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("earlyPayments.serviceFee")}
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
                      <p className="text-muted-foreground">
                        {t("earlyPayments.youAdvance")}
                      </p>
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
                          {t("earlyPayments.confirmFunding")}
                        </span>
                        <Button
                          size="sm"
                          onClick={() => fundMutation.mutate(ep.id)}
                          disabled={fundMutation.isPending || signing}
                        >
                          {signing ? (
                            <>
                              <Fingerprint className="mr-1 h-3 w-3 animate-pulse" />
                              {t("earlyPayments.signing")}
                            </>
                          ) : fundMutation.isPending ? (
                            t("earlyPayments.funding")
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
                        {t("earlyPayments.fundThisRequest")}
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
            <CardTitle className="text-base">
              {t("earlyPayments.yourFundedPayments")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("earlyPayments.colPOReference")}</TableHead>
                  <TableHead>{t("earlyPayments.colSupplier")}</TableHead>
                  <TableHead>{t("earlyPayments.colAdvanced")}</TableHead>
                  <TableHead>{t("earlyPayments.colFeeEarned")}</TableHead>
                  <TableHead>{t("earlyPayments.colStatus")}</TableHead>
                  <TableHead>{t("earlyPayments.colFunded")}</TableHead>
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
  const { t } = useTranslation();
  const { data: earlyPayments, isLoading } = useQuery({
    queryKey: ["early-payments"],
    queryFn: () => earlyPayApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("earlyPayments.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          Admin view of all early payment requests
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("earlyPayments.adminTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !earlyPayments?.length ? (
            <p className="py-8 text-center text-muted-foreground">
              {t("earlyPayments.noRequestsYet")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("earlyPayments.colPOReference")}</TableHead>
                  <TableHead>{t("earlyPayments.colSupplier")}</TableHead>
                  <TableHead>LP</TableHead>
                  <TableHead>{t("earlyPayments.colFaceValue")}</TableHead>
                  <TableHead>{t("earlyPayments.colFeeLabel")}</TableHead>
                  <TableHead>{t("earlyPayments.colStatus")}</TableHead>
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
