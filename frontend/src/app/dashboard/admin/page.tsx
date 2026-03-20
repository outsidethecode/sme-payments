"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { formatCurrency, statusLabel } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Coins,
  Lock,
  Zap,
  Users,
  TrendingUp,
  Banknote,
  ShieldCheck,
  Activity,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "@/i18n";

const CURRENCIES: Array<"GBP" | "SAR"> = ["GBP", "SAR"];

interface AdminStats {
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
}

export default function AdminPage() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.stats().then((r) => r.data),
  });

  const {
    data: integrity,
    isLoading: integrityLoading,
    refetch: refetchIntegrity,
    isFetching: integrityFetching,
  } = useQuery({
    queryKey: ["admin-integrity"],
    queryFn: () => adminApi.integrityCheck().then((r) => r.data),
    refetchOnWindowFocus: false,
  });

  const { t } = useTranslation();

  // Build per-currency volume/fee entries
  const volumeEntries = stats?.volumeByCurrency
    ? CURRENCIES.filter((c) => (stats.volumeByCurrency?.[c] ?? 0) > 0).map(
        (c) => ({ currency: c, amount: stats.volumeByCurrency![c] ?? 0 }),
      )
    : [{ currency: "GBP" as const, amount: stats?.totalVolumeMinor ?? 0 }];

  const feeEntries = stats?.feesByCurrency
    ? CURRENCIES.filter((c) => (stats.feesByCurrency?.[c] ?? 0) > 0).map(
        (c) => ({ currency: c, amount: stats.feesByCurrency![c] ?? 0 }),
      )
    : [{ currency: "GBP" as const, amount: stats?.totalFeesMinor ?? 0 }];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("admin.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={FileText}
              label={t("admin.totalPOs")}
              value={stats.totalPOs.toString()}
              description={t("admin.settledCount", { count: stats.settledPOs })}
            />
            {volumeEntries.map(({ currency, amount }) => (
              <StatCard
                key={`vol-${currency}`}
                icon={Coins}
                label={t("admin.volumeLabel", { currency })}
                value={formatCurrency(amount, currency)}
                description={t("admin.poValue")}
              />
            ))}
            <StatCard
              icon={Lock}
              label={t("admin.activeLocks")}
              value={stats.activeLocks.toString()}
              description={t("admin.fundsInEscrow")}
            />
            <StatCard
              icon={Zap}
              label={t("admin.earlyPayments")}
              value={stats.earlyPayments.toString()}
              description={t("admin.fundedSettled")}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {feeEntries.map(({ currency, amount }) => (
              <StatCard
                key={`fee-${currency}`}
                icon={Banknote}
                label={t("admin.feesLabel", { currency })}
                value={formatCurrency(amount, currency)}
                description={t("admin.revenueCollected")}
              />
            ))}
            <StatCard
              icon={Users}
              label={t("admin.totalUsers")}
              value={stats.totalUsers.toString()}
              description={t("admin.allRegisteredUsers")}
            />
            <StatCard
              icon={TrendingUp}
              label={t("admin.settlementRate")}
              value={
                stats.totalPOs > 0
                  ? `${Math.round((stats.settledPOs / stats.totalPOs) * 100)}%`
                  : "0%"
              }
              description={t("admin.posSettledTotal")}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                {t("admin.platformOverview")}
              </CardTitle>
              <CardDescription>{t("admin.keyMetrics")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span>{t("admin.transactionFeeRate")}</span>
                <span className="font-medium text-foreground">
                  {t("admin.transactionFeeValue")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>{t("admin.earlyPayFacilitationFee")}</span>
                <span className="font-medium text-foreground">
                  {t("admin.earlyPayFacilitationFeeValue")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>{t("admin.poLimitsGBP")}</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(500_00, "GBP")} –{" "}
                  {formatCurrency(250_000_00, "GBP")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>{t("admin.poLimitsSAR")}</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(1_875_00, "SAR")} –{" "}
                  {formatCurrency(937_500_00, "SAR")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>{t("admin.acceptanceWindow")}</span>
                <span className="font-medium text-foreground">
                  {t("admin.acceptanceWindowValue")}
                </span>
              </div>
              {stats.volumeByCurrency && (
                <>
                  {Object.entries(stats.volumeByCurrency).map(([ccy, vol]) => (
                    <div
                      key={ccy}
                      className="flex items-center justify-between border-b pb-2"
                    >
                      <span>{t("admin.volumeLabel", { currency: ccy })}</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(vol, ccy as "GBP" | "SAR")}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {stats.feesByCurrency && (
                <>
                  {Object.entries(stats.feesByCurrency).map(([ccy, fee]) => (
                    <div
                      key={`fee-${ccy}`}
                      className="flex items-center justify-between border-b pb-2"
                    >
                      <span>{t("admin.feesLabel", { currency: ccy })}</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(fee, ccy as "GBP" | "SAR")}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Integrity Check Card ────────────────────── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  {t("admin.financialIntegrityCheck")}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchIntegrity()}
                  disabled={integrityFetching}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${integrityFetching ? "animate-spin" : ""}`}
                  />
                  {integrityFetching
                    ? t("admin.checking")
                    : t("admin.runCheck")}
                </Button>
              </div>
              <CardDescription>
                {t("admin.integrityDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {integrityLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : integrity ? (
                <>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        integrity.violations.length === 0
                          ? "default"
                          : "destructive"
                      }
                    >
                      {integrity.violations.length === 0
                        ? t("admin.allClear")
                        : t("admin.violationsCount", {
                            count: integrity.violations.length,
                          })}
                    </Badge>
                    <span className="text-muted-foreground">
                      {t("admin.posChecked", {
                        checked: integrity.totalChecked,
                        valid: integrity.valid,
                      })}{" "}
                      · {new Date(integrity.checkedAt).toLocaleString()}
                    </span>
                  </div>
                  {integrity.violations.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {integrity.violations.map((v, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-xs border rounded p-2"
                        >
                          <Badge
                            variant={
                              v.severity === "CRITICAL"
                                ? "destructive"
                                : "secondary"
                            }
                            className="text-[10px] shrink-0"
                          >
                            {statusLabel(v.severity)}
                          </Badge>
                          <div>
                            <span className="font-mono font-medium">
                              {v.invariantId}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              PO {v.purchaseOrderId.slice(0, 8)}…
                            </span>
                            <div className="text-muted-foreground mt-0.5">
                              {t("admin.expected")} {v.expected}
                              <br />
                              {t("admin.actual")} {v.actual}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  {t("admin.clickRunCheck")}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground">
          {t("admin.failedToLoadStats")}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}
