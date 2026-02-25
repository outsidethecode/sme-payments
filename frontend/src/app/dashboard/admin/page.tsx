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
  PoundSterling,
  Lock,
  Zap,
  Users,
  TrendingUp,
  BadgePoundSterling,
  ShieldCheck,
} from "lucide-react";

interface AdminStats {
  totalPOs: number;
  settledPOs: number;
  totalVolumePennies: number;
  activeLocks: number;
  earlyPayments: number;
  totalFeesPennies: number;
  totalUsers: number;
}

export default function AdminPage() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.stats().then((r) => r.data),
  });

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
            <StatCard
              icon={PoundSterling}
              label="Total Volume"
              value={formatCurrency(stats.totalVolumePennies)}
              description="All PO value"
            />
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
            <StatCard
              icon={BadgePoundSterling}
              label="Platform Fees"
              value={formatCurrency(stats.totalFeesPennies)}
              description="Revenue collected"
            />
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
                <span>PO Limits</span>
                <span className="font-medium text-foreground">
                  £500 – £250,000
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Acceptance Window</span>
                <span className="font-medium text-foreground">48 hours</span>
              </div>
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
