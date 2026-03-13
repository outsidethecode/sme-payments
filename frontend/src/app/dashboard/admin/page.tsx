"use client";

import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Coins,
  Lock,
  Zap,
  Users,
  TrendingUp,
  Banknote,
  ShieldCheck,
} from "lucide-react";

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
        <h1 className="text-2xl font-bold tracking-tight">Platform Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide statistics and metrics
        </p>
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
              label="Total POs"
              value={stats.totalPOs.toString()}
              description={`${stats.settledPOs} settled`}
            />
            {volumeEntries.map(({ currency, amount }) => (
              <StatCard
                key={`vol-${currency}`}
                icon={Coins}
                label={`Volume (${currency})`}
                value={formatCurrency(amount, currency)}
                description="PO value"
              />
            ))}
            <StatCard
              icon={Lock}
              label="Active Locks"
              value={stats.activeLocks.toString()}
              description="Funds in escrow"
            />
            <StatCard
              icon={Zap}
              label="Early Payments"
              value={stats.earlyPayments.toString()}
              description="Funded/settled"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {feeEntries.map(({ currency, amount }) => (
              <StatCard
                key={`fee-${currency}`}
                icon={Banknote}
                label={`Fees (${currency})`}
                value={formatCurrency(amount, currency)}
                description="Revenue collected"
              />
            ))}
            <StatCard
              icon={Users}
              label="Total Users"
              value={stats.totalUsers.toString()}
              description="All registered users"
            />
            <StatCard
              icon={TrendingUp}
              label="Settlement Rate"
              value={
                stats.totalPOs > 0
                  ? `${Math.round((stats.settledPOs / stats.totalPOs) * 100)}%`
                  : "0%"
              }
              description="POs settled / total"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                Platform Overview
              </CardTitle>
              <CardDescription>
                Key platform metrics at a glance
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span>Transaction Fee Rate</span>
                <span className="font-medium text-foreground">
                  0.5% (50 BPS)
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>Early Payment Facilitation Fee</span>
                <span className="font-medium text-foreground">
                  2.5% (250 BPS)
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>PO Limits (GBP)</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(500_00, "GBP")} –{" "}
                  {formatCurrency(250_000_00, "GBP")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>PO Limits (SAR)</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(1_875_00, "SAR")} –{" "}
                  {formatCurrency(937_500_00, "SAR")}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>Acceptance Window</span>
                <span className="font-medium text-foreground">48 hours</span>
              </div>
              {stats.volumeByCurrency && (
                <>
                  {Object.entries(stats.volumeByCurrency).map(([ccy, vol]) => (
                    <div
                      key={ccy}
                      className="flex items-center justify-between border-b pb-2"
                    >
                      <span>Volume ({ccy})</span>
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
                      <span>Fees ({ccy})</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(fee, ccy as "GBP" | "SAR")}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground">
          Failed to load admin statistics.
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
