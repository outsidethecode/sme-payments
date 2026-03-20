"use client";

import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { poApi, usersApi, adminApi } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
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
import Link from "next/link";
import {
  FileText,
  Lock,
  Zap,
  Coins,
  Plus,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const { data: pos, isLoading: posLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => poApi.list().then((r) => r.data),
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ["balance"],
    queryFn: () => usersApi.balance().then((r) => r.data),
  });

  const isAdmin = user?.role === "ADMIN";

  const { data: adminStats, isLoading: adminStatsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.stats().then((r) => r.data),
    enabled: isAdmin,
  });

  if (!user) return null;

  const greeting = t("dashboard.welcome", {
    firstName: user.name.split(" ")[0],
  });

  // Compute quick stats
  const totalPOs = pos?.length ?? 0;
  const activePOs =
    pos?.filter((p) =>
      ["SENT", "ACCEPTED", "FULFILLMENT", "DELIVERED"].includes(p.status),
    ).length ?? 0;
  const pendingPOs = pos?.filter((p) => p.status === "SENT").length ?? 0;
  // Per-currency value totals
  const valueByCurrency: Record<string, number> = {};
  for (const p of pos ?? []) {
    const ccy = (p.currency as string) || user.currency || "GBP";
    valueByCurrency[ccy] = (valueByCurrency[ccy] ?? 0) + p.totalAmountPennies;
  }
  const valueEntries = Object.entries(valueByCurrency);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted-foreground">
            {user.companyName} ·{" "}
            <Badge variant="outline">{user.role.replace(/_/g, " ")}</Badge>
            {user.jurisdiction && (
              <>
                {" · "}
                <Badge variant="secondary">
                  {user.jurisdiction === "KSA" ? "🇸🇦 KSA" : "🇬🇧 UK"}
                  {" · "}
                  {user.currency ?? "GBP"}
                </Badge>
              </>
            )}
          </p>
        </div>

        {user.role === "BUYER" && (
          <Link href="/dashboard/purchase-orders/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("dashboard.newPurchaseOrder")}
            </Button>
          </Link>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={
            isAdmin
              ? t("dashboard.escrowBalance")
              : t("dashboard.accountBalance")
          }
          icon={<Coins className="h-4 w-4 text-muted-foreground" />}
          loading={isAdmin ? adminStatsLoading : balanceLoading}
          value={
            isAdmin
              ? adminStats?.escrowBalanceByCurrency &&
                Object.keys(adminStats.escrowBalanceByCurrency).length > 0
                ? Object.entries(adminStats.escrowBalanceByCurrency)
                    .map(([ccy, amt]) =>
                      formatCurrency(amt, ccy as "GBP" | "SAR"),
                    )
                    .join(" / ")
                : formatCurrency(0, "GBP")
              : balanceData
                ? formatCurrency(balanceData.balance, user.currency ?? "GBP")
                : "—"
          }
          description={
            isAdmin
              ? t("dashboard.platformEscrow")
              : t("dashboard.availableFunds")
          }
        />
        <StatCard
          title={t("dashboard.totalPOs")}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          loading={posLoading}
          value={totalPOs.toString()}
          description={`${activePOs} ${t("dashboard.activePOs")}`}
        />
        <StatCard
          title={
            isAdmin ? t("dashboard.lockedAmount") : t("dashboard.pendingAction")
          }
          icon={
            isAdmin ? (
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Lock className="h-4 w-4 text-muted-foreground" />
            )
          }
          loading={isAdmin ? adminStatsLoading : posLoading}
          value={
            isAdmin
              ? adminStats?.lockedAmountByCurrency &&
                Object.keys(adminStats.lockedAmountByCurrency).length > 0
                ? Object.entries(adminStats.lockedAmountByCurrency)
                    .map(([ccy, amt]) =>
                      formatCurrency(amt, ccy as "GBP" | "SAR"),
                    )
                    .join(" / ")
                : formatCurrency(0, "GBP")
              : pendingPOs.toString()
          }
          description={
            isAdmin
              ? t("dashboard.fundsLockedAgainstPOs")
              : t("dashboard.awaitingResponse")
          }
        />
        <StatCard
          title={t("dashboard.totalValue")}
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          loading={isAdmin ? adminStatsLoading : posLoading}
          value={
            isAdmin
              ? adminStats?.volumeByCurrency &&
                Object.keys(adminStats.volumeByCurrency).length > 0
                ? Object.entries(adminStats.volumeByCurrency)
                    .map(([ccy, amt]) =>
                      formatCurrency(amt, ccy as "GBP" | "SAR"),
                    )
                    .join(" / ")
                : formatCurrency(adminStats?.totalVolumeMinor ?? 0, "GBP")
              : valueEntries.length === 0
                ? formatCurrency(0, user.currency ?? "GBP")
                : valueEntries
                    .map(([ccy, amt]) =>
                      formatCurrency(amt, ccy as "GBP" | "SAR"),
                    )
                    .join(" / ")
          }
          description={t("dashboard.allPurchaseOrders")}
        />
      </div>

      {/* Reconciliation discrepancy alert (admin only) */}
      {isAdmin &&
        adminStats &&
        (() => {
          const escrow = adminStats.escrowBalanceByCurrency ?? {};
          const locked = adminStats.lockedAmountByCurrency ?? {};
          const allCurrencies = new Set([
            ...Object.keys(escrow),
            ...Object.keys(locked),
          ]);
          const mismatches: string[] = [];
          for (const ccy of allCurrencies) {
            const e = escrow[ccy] ?? 0;
            const l = locked[ccy] ?? 0;
            if (e !== l) {
              const diff = e - l;
              mismatches.push(
                `${ccy}: escrow ${formatCurrency(e, ccy as "GBP" | "SAR")} vs locked ${formatCurrency(l, ccy as "GBP" | "SAR")} (${diff > 0 ? "+" : ""}${formatCurrency(diff, ccy as "GBP" | "SAR")})`,
              );
            }
          }
          if (mismatches.length === 0) return null;
          return (
            <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-400">
                  {t("dashboard.escrowLockedDiscrepancy")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {mismatches.map((m, i) => (
                  <p
                    key={i}
                    className="text-sm text-amber-700 dark:text-amber-300"
                  >
                    {m}
                  </p>
                ))}
                <Link
                  href="/dashboard/admin/reconciliation"
                  className="inline-flex items-center gap-1 text-sm font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
                >
                  {t("dashboard.runReconciliation")}{" "}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          );
        })()}

      {/* Quick Actions by Role */}
      <div className="grid gap-4 md:grid-cols-2">
        {user.role === "BUYER" && (
          <>
            <QuickActionCard
              title={t("dashboard.createPurchaseOrder")}
              description={t("dashboard.createPODescription")}
              href="/dashboard/purchase-orders/new"
              icon={<Plus className="h-5 w-5" />}
            />
            <QuickActionCard
              title={t("dashboard.viewPurchaseOrders")}
              description={t("dashboard.viewPODescription")}
              href="/dashboard/purchase-orders"
              icon={<FileText className="h-5 w-5" />}
            />
          </>
        )}
        {user.role === "SUPPLIER" && (
          <>
            <QuickActionCard
              title={t("dashboard.incomingOrders")}
              description={t("dashboard.incomingOrdersDescription")}
              href="/dashboard/purchase-orders"
              icon={<FileText className="h-5 w-5" />}
            />
            <QuickActionCard
              title={t("dashboard.earlyPayment")}
              description={t("dashboard.earlyPaymentDescription")}
              href="/dashboard/early-payments"
              icon={<Zap className="h-5 w-5" />}
            />
          </>
        )}
        {user.role === "LIQUIDITY_PARTNER" && (
          <>
            <QuickActionCard
              title={t("dashboard.marketplace")}
              description={t("dashboard.marketplaceDescription")}
              href="/dashboard/early-payments"
              icon={<Zap className="h-5 w-5" />}
            />
            <QuickActionCard
              title={t("dashboard.auditLedger")}
              description={t("dashboard.auditLedgerDescription")}
              href="/dashboard/ledger"
              icon={<Lock className="h-5 w-5" />}
            />
          </>
        )}
        {user.role === "ADMIN" && (
          <>
            <QuickActionCard
              title={t("dashboard.platformAdmin")}
              description={t("dashboard.platformAdminDescription")}
              href="/dashboard/admin"
              icon={<Lock className="h-5 w-5" />}
            />
            <QuickActionCard
              title={t("dashboard.fullLedger")}
              description={t("dashboard.fullLedgerDescription")}
              href="/dashboard/ledger"
              icon={<FileText className="h-5 w-5" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  icon,
  value,
  description,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  description: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function QuickActionCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-colors hover:bg-muted/50">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            {icon}
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
      </Card>
    </Link>
  );
}
