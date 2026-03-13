"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settlementsApi, type Settlement } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
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
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Server,
  TrendingUp,
  DollarSign,
  Zap,
} from "lucide-react";
import { useState } from "react";

export default function SettlementsPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "ADMIN") return <AdminView />;
  return <UserView />;
}

/* ─── Status helpers ─────────────────────────────────────── */

function settlementStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
      return "default";
    case "PENDING":
      return "outline";
    case "FAILED":
      return "destructive";
    case "REFUNDED":
      return "secondary";
    default:
      return "secondary";
  }
}

function typeIcon(type: string) {
  switch (type) {
    case "STANDARD":
      return <ArrowRightLeft className="h-4 w-4" />;
    case "EARLY_PAY_ADVANCE":
      return <Zap className="h-4 w-4" />;
    case "EARLY_PAY_SETTLEMENT":
      return <TrendingUp className="h-4 w-4" />;
    default:
      return <ArrowRightLeft className="h-4 w-4" />;
  }
}

function typeLabel(type: string) {
  switch (type) {
    case "STANDARD":
      return "Standard";
    case "EARLY_PAY_ADVANCE":
      return "Early Pay Advance";
    case "EARLY_PAY_SETTLEMENT":
      return "Early Pay Settlement";
    default:
      return statusLabel(type);
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case "PENDING":
      return <Clock className="h-4 w-4 text-amber-500" />;
    case "FAILED":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "REFUNDED":
      return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
    default:
      return null;
  }
}

/* ─── User View (Buyer / Supplier / LP) ──────────────────── */

function UserView() {
  const { user } = useAuth();
  const { data: settlements, isLoading } = useQuery({
    queryKey: ["settlements"],
    queryFn: () => settlementsApi.list().then((r) => r.data),
  });

  const { data: adapterInfo } = useQuery({
    queryKey: ["settlements-adapter"],
    queryFn: () => settlementsApi.adapter().then((r) => r.data),
  });

  if (isLoading) return <SettlementsSkeleton />;

  const items = settlements ?? [];

  // Summary stats
  const completed = items.filter((s) => s.status === "COMPLETED");
  const totalVolume = completed.reduce((sum, s) => sum + s.amount, 0);
  const currency = user?.currency ?? "GBP";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground">
            Track all fund transfers for your purchase orders.
          </p>
        </div>
        {adapterInfo && (
          <Badge
            variant="outline"
            className="flex items-center gap-1.5 px-3 py-1"
          >
            <Server className="h-3.5 w-3.5" />
            {adapterInfo.adapter} Rail
          </Badge>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Total Settlements
            </CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Completed Volume
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalVolume, currency as "GBP" | "SAR")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {items.length > 0
                ? `${Math.round((completed.length / items.length) * 100)}%`
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Settlements Table */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No settlements yet. Settlements are created when purchase orders are
            verified or early payments are funded.
          </CardContent>
        </Card>
      ) : (
        <SettlementsTable settlements={items} showPO showCounterparty />
      )}
    </div>
  );
}

/* ─── Admin View ─────────────────────────────────────────── */

function AdminView() {
  const queryClient = useQueryClient();
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  const { data: settlements, isLoading } = useQuery({
    queryKey: ["settlements"],
    queryFn: () => settlementsApi.list().then((r) => r.data),
  });

  const { data: pendingSettlements } = useQuery({
    queryKey: ["settlements-pending"],
    queryFn: () => settlementsApi.pending().then((r) => r.data),
  });

  const { data: adapterInfo } = useQuery({
    queryKey: ["settlements-adapter"],
    queryFn: () => settlementsApi.adapter().then((r) => r.data),
  });

  const reconcileMutation = useMutation({
    mutationFn: ({ id, ref }: { id: string; ref: string }) =>
      settlementsApi.reconcile(id, ref).then((r) => r.data),
    onSuccess: (result) => {
      if (result.changed) {
        toast.success(
          `Settlement reconciled: ${result.previousStatus} → ${result.currentStatus}`,
        );
      } else {
        toast.info("Settlement status unchanged — already up to date.");
      }
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["settlements-pending"] });
      setReconcilingId(null);
    },
    onError: () => {
      toast.error("Reconciliation failed.");
      setReconcilingId(null);
    },
  });

  if (isLoading) return <SettlementsSkeleton />;

  const items = settlements ?? [];
  const pending = pendingSettlements ?? [];
  const completed = items.filter((s) => s.status === "COMPLETED");
  const failed = items.filter((s) => s.status === "FAILED");
  const totalVolume = completed.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Settlement Management
          </h1>
          <p className="text-muted-foreground">
            Monitor all platform settlements and trigger reconciliation.
          </p>
        </div>
        {adapterInfo && (
          <Badge
            variant="outline"
            className="flex items-center gap-1.5 px-3 py-1"
          >
            <Server className="h-3.5 w-3.5" />
            {adapterInfo.adapter} Rail
          </Badge>
        )}
      </div>

      {/* Admin Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completed.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pending.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failed.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Platform Volume</CardTitle>
          <CardDescription>Total completed settlement volume</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            // Group completed settlements by currency
            const byCurrency: Record<string, number> = {};
            for (const s of completed) {
              const ccy = s.currency ?? "GBP";
              byCurrency[ccy] = (byCurrency[ccy] ?? 0) + s.amount;
            }
            const entries = Object.entries(byCurrency);
            if (entries.length === 0) {
              return <div className="text-3xl font-bold">—</div>;
            }
            return (
              <div className="space-y-1">
                {entries.map(([ccy, vol]) => (
                  <div key={ccy} className="text-3xl font-bold">
                    {formatCurrency(vol, ccy as "GBP" | "SAR")}
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Pending Reconciliation */}
      {pending.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Pending Reconciliation
            </h2>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Ref</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Rail</TableHead>
                    <TableHead>External Ref</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        {(s.purchaseOrder as any)?.referenceNumber ??
                          s.purchaseOrderId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(s.amount, s.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {s.settlementRail ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.externalRef?.slice(0, 20) ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(s.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            reconcilingId === s.id ||
                            reconcileMutation.isPending
                          }
                          onClick={() => {
                            if (s.externalRef) {
                              setReconcilingId(s.id);
                              reconcileMutation.mutate({
                                id: s.id,
                                ref: s.externalRef,
                              });
                            }
                          }}
                        >
                          <RefreshCw
                            className={`mr-1.5 h-3.5 w-3.5 ${reconcilingId === s.id ? "animate-spin" : ""}`}
                          />
                          Reconcile
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        </>
      )}

      <Separator />

      {/* All Settlements */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">All Settlements</h2>
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No settlements recorded yet.
            </CardContent>
          </Card>
        ) : (
          <SettlementsTable
            settlements={items}
            showPO
            showCounterparty
            showReconcile
            onReconcile={(s) => {
              if (s.externalRef) {
                setReconcilingId(s.id);
                reconcileMutation.mutate({ id: s.id, ref: s.externalRef });
              }
            }}
            reconcilingId={reconcilingId}
            isReconciling={reconcileMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Shared Table ───────────────────────────────────────── */

function SettlementsTable({
  settlements,
  showPO = false,
  showCounterparty = false,
  showReconcile = false,
  onReconcile,
  reconcilingId,
  isReconciling,
}: {
  settlements: Settlement[];
  showPO?: boolean;
  showCounterparty?: boolean;
  showReconcile?: boolean;
  onReconcile?: (s: Settlement) => void;
  reconcilingId?: string | null;
  isReconciling?: boolean;
}) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {showPO && <TableHead>PO</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rail</TableHead>
            <TableHead>External Ref</TableHead>
            {showCounterparty && <TableHead>From → To</TableHead>}
            <TableHead>Date</TableHead>
            {showReconcile && (
              <TableHead className="text-right">Action</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {settlements.map((s) => (
            <TableRow key={s.id}>
              {showPO && (
                <TableCell className="font-mono text-xs">
                  {s.purchaseOrder?.referenceNumber ??
                    s.purchaseOrderId.slice(0, 8)}
                </TableCell>
              )}
              <TableCell>
                <span className="flex items-center gap-1.5">
                  {typeIcon(s.type)}
                  <span className="text-sm">{typeLabel(s.type)}</span>
                </span>
              </TableCell>
              <TableCell className="font-medium">
                {formatCurrency(s.amount, s.currency)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={settlementStatusVariant(s.status)}
                  className="flex w-fit items-center gap-1"
                >
                  {statusIcon(s.status)}
                  {statusLabel(s.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {s.settlementRail ?? "—"}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">
                {s.externalRef ?? "—"}
              </TableCell>
              {showCounterparty && (
                <TableCell className="text-sm">
                  <span className="text-muted-foreground">
                    {s.fromUser?.companyName ?? s.fromUser?.name ?? "—"}
                  </span>
                  <span className="mx-1">→</span>
                  <span>{s.toUser?.companyName ?? s.toUser?.name ?? "—"}</span>
                </TableCell>
              )}
              <TableCell className="text-sm text-muted-foreground">
                {s.completedAt
                  ? formatDateTime(s.completedAt)
                  : formatDate(s.createdAt)}
              </TableCell>
              {showReconcile && (
                <TableCell className="text-right">
                  {s.status === "PENDING" && s.externalRef && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={reconcilingId === s.id || isReconciling}
                      onClick={() => onReconcile?.(s)}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${reconcilingId === s.id ? "animate-spin" : ""}`}
                      />
                    </Button>
                  )}
                  {s.reconciledAt && (
                    <span className="text-xs text-muted-foreground">
                      ✓ {formatDate(s.reconciledAt)}
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/* ─── Skeleton ───────────────────────────────────────────── */

function SettlementsSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
