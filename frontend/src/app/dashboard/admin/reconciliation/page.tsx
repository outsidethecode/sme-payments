"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  reconciliationApi,
  ReconciliationReport,
  ReconciliationAlert,
} from "@/lib/api";
import { formatDateTime, formatCurrency } from "@/lib/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Shield,
  Activity,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────

function statusBanner(report: ReconciliationReport | null) {
  if (!report)
    return {
      color: "bg-muted",
      icon: Clock,
      label: "No data",
      description: "No reconciliation reports yet",
    };
  if (report.mismatches === 0 && report.totalChecked > 0)
    return {
      color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
      label: "All Clear",
      description: "Bank ↔ Platform fully consistent",
    };
  if (report.mismatches === 0 && report.totalChecked === 0)
    return {
      color: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      icon: Clock,
      label: "Idle",
      description: "No pending instruments or settlements to check",
    };
  if (report.mismatches > 0)
    return {
      color: "bg-destructive/15 text-destructive",
      icon: XCircle,
      label: `${report.mismatches} Mismatch${report.mismatches > 1 ? "es" : ""}`,
      description: "Action required — review alerts below",
    };
  return {
    color: "bg-amber-500/15 text-amber-700",
    icon: AlertTriangle,
    label: "Pending",
    description: "Reconciliation in progress",
  };
}

function alertSeverityBadge(alert: ReconciliationAlert) {
  if (alert.actual === "STALE")
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-700">
        Stale
      </Badge>
    );
  if (alert.actual === "ERROR")
    return <Badge variant="destructive">Error</Badge>;
  if (alert.actual === "FAILED")
    return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Mismatch</Badge>;
}

// ── Page ─────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("latest");

  // Fetch latest report
  const { data: latest, isLoading: latestLoading } = useQuery({
    queryKey: ["reconciliation-latest"],
    queryFn: () => reconciliationApi.getLatest().then((r) => r.data),
  });

  // Fetch historical reports
  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ["reconciliation-reports"],
    queryFn: () => reconciliationApi.getReports(50).then((r) => r.data),
  });

  // Manual run mutation
  const runMutation = useMutation({
    mutationFn: () => reconciliationApi.run().then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-latest"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation-reports"] });
    },
  });

  const banner = statusBanner(latest ?? null);
  const BannerIcon = banner.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Bank Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground">
            Bank ↔ Platform consistency monitoring
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${runMutation.isPending ? "animate-spin" : ""}`}
          />
          {runMutation.isPending ? "Running…" : "Run Reconciliation"}
        </Button>
      </div>

      {/* Status Banner */}
      {latestLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div
          className={`flex items-center gap-4 rounded-lg border p-4 ${banner.color}`}
        >
          <BannerIcon className="h-8 w-8 shrink-0" />
          <div>
            <p className="text-lg font-semibold">{banner.label}</p>
            <p className="text-sm opacity-80">{banner.description}</p>
          </div>
          {latest && (
            <p className="ml-auto text-xs opacity-60">
              Last run: {formatDateTime(latest.runAt)}
            </p>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {latestLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : latest ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={Activity}
            label="Total Checked"
            value={latest.totalChecked}
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Matched"
            value={latest.matched}
            className="text-emerald-600"
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Mismatches"
            value={latest.mismatches}
            className={latest.mismatches > 0 ? "text-destructive" : ""}
          />
          <SummaryCard
            icon={Shield}
            label="Ledger Balance"
            value={
              latest.ledgerBalanceByCurrency &&
              Object.keys(latest.ledgerBalanceByCurrency).length > 0
                ? Object.entries(latest.ledgerBalanceByCurrency)
                    .map(([ccy, amt]) =>
                      formatCurrency(amt, ccy as "GBP" | "SAR"),
                    )
                    .join(" / ")
                : latest.ledgerBalance !== null
                  ? formatCurrency(
                      latest.ledgerBalance,
                      latest.currency ?? "GBP",
                    )
                  : "—"
            }
            subtitle={
              latest.variance !== null
                ? `Variance: ${formatCurrency(latest.variance, latest.currency ?? "GBP")}`
                : "Bank balance not available"
            }
          />
        </div>
      ) : null}

      {/* Tabs: Latest Alerts / History */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="latest">
            Alerts
            {latest && latest.mismatches > 0 && (
              <Badge variant="destructive" className="ml-2">
                {latest.mismatches}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Report History</TabsTrigger>
        </TabsList>

        {/* ── Alerts Tab ─────────────────────────────────── */}
        <TabsContent value="latest" className="mt-4">
          {latestLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !latest || latest.alerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle2 className="mb-2 h-10 w-10 text-emerald-500" />
                <p>No alerts — all operations reconciled cleanly.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mismatch Details</CardTitle>
                <CardDescription>
                  {latest.alerts.length} alert
                  {latest.alerts.length > 1 ? "s" : ""} from the last run
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>External Ref</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead className="max-w-[300px]">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {latest.alerts.map((alert, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {alert.instrumentId ? "Instrument" : "Settlement"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {(
                            alert.instrumentId ||
                            alert.settlementId ||
                            "—"
                          ).slice(0, 8)}
                          …
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{alert.expected}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive">{alert.actual}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {alert.externalRef.slice(0, 16)}
                          {alert.externalRef.length > 16 ? "…" : ""}
                        </TableCell>
                        <TableCell>{alertSeverityBadge(alert)}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                          {alert.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── History Tab ────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          {reportsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !reports || reports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock className="mb-2 h-10 w-10" />
                <p>No reconciliation reports yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historical Reports</CardTitle>
                <CardDescription>
                  {reports.length} report{reports.length > 1 ? "s" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run At</TableHead>
                      <TableHead className="text-right">Checked</TableHead>
                      <TableHead className="text-right">Matched</TableHead>
                      <TableHead className="text-right">Mismatches</TableHead>
                      <TableHead className="text-right">
                        Ledger Balance
                      </TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{formatDateTime(r.runAt)}</TableCell>
                        <TableCell className="text-right">
                          {r.totalChecked}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.matched}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {r.mismatches > 0 ? (
                            <span className="text-destructive">
                              {r.mismatches}
                            </span>
                          ) : (
                            r.mismatches
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.ledgerBalanceByCurrency &&
                          Object.keys(r.ledgerBalanceByCurrency).length > 0
                            ? Object.entries(r.ledgerBalanceByCurrency)
                                .map(([ccy, amt]) =>
                                  formatCurrency(amt, ccy as "GBP" | "SAR"),
                                )
                                .join(" / ")
                            : r.ledgerBalance !== null
                              ? formatCurrency(
                                  r.ledgerBalance,
                                  r.currency ?? "GBP",
                                )
                              : "—"}
                        </TableCell>
                        <TableCell>
                          {r.mismatches === 0 ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                              Clean
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              {r.mismatches} alert{r.mismatches > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Summary Card Component ───────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  subtitle,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className={`h-4 w-4 text-muted-foreground ${className ?? ""}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${className ?? ""}`}>{value}</div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
