"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { riskApi, type FraudFlag, type ExposureReport } from "@/lib/api";
import { formatCurrency, formatDateTime, statusLabel } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-800",
};

export default function RiskPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [lpIdInput, setLpIdInput] = useState("");

  const isAdmin = user?.role === "ADMIN";
  const isLP = user?.role === "LIQUIDITY_PARTNER";

  // ── Fraud Config ────────────────────────────────────────
  const { data: fraudConfig } = useQuery({
    queryKey: ["risk", "fraud-config"],
    queryFn: () => riskApi.getFraudConfig().then((r) => r.data),
    enabled: isAdmin,
  });

  // ── Fraud Flags ─────────────────────────────────────────
  const { data: fraudFlags = [] } = useQuery({
    queryKey: ["risk", "fraud-flags"],
    queryFn: () => riskApi.getUnacknowledgedFlags().then((r) => r.data),
    enabled: isAdmin,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => riskApi.acknowledgeFlag(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["risk", "fraud-flags"] }),
  });

  // ── LP Exposure ─────────────────────────────────────────
  const lpId = isLP ? user?.id : lpIdInput;
  const {
    data: exposure,
    refetch: refetchExposure,
    isFetching: exposureLoading,
  } = useQuery({
    queryKey: ["risk", "lp-exposure", lpId],
    queryFn: () => riskApi.getLpExposure(lpId!).then((r) => r.data),
    enabled: !!lpId,
  });

  const snapshotMutation = useMutation({
    mutationFn: (id: string) => riskApi.takeSnapshot(id),
    onSuccess: () => refetchExposure(),
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Risk Controls</h1>
        <p className="text-muted-foreground">
          Fraud detection, velocity controls, and LP exposure monitoring
        </p>
      </div>

      {/* ── Fraud Configuration (Admin only) ────────────── */}
      {isAdmin && fraudConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Fraud Control Configuration
            </CardTitle>
            <CardDescription>
              Per-currency velocity limits and thresholds
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {fraudConfig.configByCurrency ? (
              Object.entries(
                fraudConfig.configByCurrency as Record<
                  string,
                  typeof fraudConfig
                >,
              ).map(([ccy, cfg]) => (
                <div key={ccy}>
                  <h3 className="mb-3 text-sm font-semibold">{ccy}</h3>
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground">
                        Max POs / Buyer / Day
                      </div>
                      <div className="text-lg font-semibold">
                        {cfg.maxPOsPerBuyerPerDay}
                      </div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground">
                        Max Daily Value / Buyer
                      </div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(
                          cfg.maxDailyValuePerBuyer,
                          ccy as "GBP" | "SAR",
                        )}
                      </div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground">
                        Mandatory Evidence Threshold
                      </div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(
                          cfg.mandatoryEvidenceThreshold,
                          ccy as "GBP" | "SAR",
                        )}
                      </div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground">
                        Max POs / Supplier / Day
                      </div>
                      <div className="text-lg font-semibold">
                        {cfg.maxPOsPerSupplierPerDay}
                      </div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground">
                        Supplier Whitelist
                      </div>
                      <div className="text-lg font-semibold">
                        {(cfg.supplierWhitelist ?? []).length > 0
                          ? `${cfg.supplierWhitelist.length} entries`
                          : "Not enforced"}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 lg:grid-cols-3">
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">
                    Max POs / Buyer / Day
                  </div>
                  <div className="text-lg font-semibold">
                    {fraudConfig.maxPOsPerBuyerPerDay}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">
                    Max Daily Value / Buyer
                  </div>
                  <div className="text-lg font-semibold">
                    {formatCurrency(fraudConfig.maxDailyValuePerBuyer, "GBP")}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">
                    Mandatory Evidence Threshold
                  </div>
                  <div className="text-lg font-semibold">
                    {formatCurrency(
                      fraudConfig.mandatoryEvidenceThreshold,
                      "GBP",
                    )}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">
                    Max POs / Supplier / Day
                  </div>
                  <div className="text-lg font-semibold">
                    {fraudConfig.maxPOsPerSupplierPerDay}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">
                    Supplier Whitelist
                  </div>
                  <div className="text-lg font-semibold">
                    {fraudConfig.supplierWhitelist.length > 0
                      ? `${fraudConfig.supplierWhitelist.length} entries`
                      : "Not enforced"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Fraud Flags (Admin only) ────────────────────── */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Unacknowledged Fraud Flags
            </CardTitle>
            <CardDescription>
              {fraudFlags.length} active flag{fraudFlags.length !== 1 && "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fraudFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unacknowledged fraud flags.
              </p>
            ) : (
              <div className="space-y-3">
                {fraudFlags.map((flag: FraudFlag) => (
                  <div
                    key={flag.id}
                    className="flex items-start justify-between rounded border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge className={SEVERITY_COLORS[flag.severity] ?? ""}>
                          {statusLabel(flag.severity)}
                        </Badge>
                        <span className="font-mono text-sm">
                          {flag.ruleCode}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        User: {flag.user?.name ?? flag.userId} (
                        {flag.user?.email})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(flag.createdAt)} &middot;{" "}
                        {JSON.stringify(flag.details)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => acknowledgeMutation.mutate(flag.id)}
                      disabled={acknowledgeMutation.isPending}
                    >
                      Acknowledge
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* ── LP Exposure ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">LP Exposure Monitor</CardTitle>
          <CardDescription>
            Real-time liquidity partner exposure and concentration tracking
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="w-64 rounded border px-3 py-2 text-sm"
                placeholder="Enter LP User ID"
                value={lpIdInput}
                onChange={(e) => setLpIdInput(e.target.value)}
              />
              <Button
                size="sm"
                onClick={() => refetchExposure()}
                disabled={!lpIdInput || exposureLoading}
              >
                {exposureLoading ? "Loading…" : "Check Exposure"}
              </Button>
            </div>
          )}

          {exposure && (
            <div className="space-y-4">
              {/* Per-currency exposure breakdown */}
              {exposure.exposureByCurrency &&
              Object.keys(exposure.exposureByCurrency).length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    Exposure by Currency
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {Object.entries(exposure.exposureByCurrency).map(
                      ([ccy, amt]) => (
                        <div key={ccy} className="rounded border p-3">
                          <div className="text-muted-foreground text-sm">
                            Total Exposure ({ccy})
                          </div>
                          <div className="text-xl font-bold">
                            {formatCurrency(amt, ccy as "GBP" | "SAR")}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded border p-3">
                  <div className="text-muted-foreground text-sm">
                    Total Exposure
                  </div>
                  <div className="text-xl font-bold">
                    {formatCurrency(
                      exposure.totalExposure,
                      (exposure.currency ?? "GBP") as "GBP" | "SAR",
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded border p-3">
                  <div className="text-muted-foreground text-sm">
                    Funding Limit
                  </div>
                  <div className="text-xl font-bold">
                    {exposure.fundingLimit
                      ? formatCurrency(
                          exposure.fundingLimit,
                          (exposure.currency ?? "GBP") as "GBP" | "SAR",
                        )
                      : "No limit set"}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground text-sm">
                    Utilisation
                  </div>
                  <div className="text-xl font-bold">
                    {exposure.utilisationPct !== null
                      ? `${exposure.utilisationPct}%`
                      : "N/A"}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground text-sm">
                    Funding Status
                  </div>
                  <div className="text-xl font-bold">
                    {exposure.fundingSuspended ? (
                      <span className="text-red-600">SUSPENDED</span>
                    ) : (
                      <span className="text-green-600">ACTIVE</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Alerts */}
              {exposure.alerts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Alerts</h3>
                  {exposure.alerts.map((alert: string, i: number) => (
                    <div
                      key={i}
                      className="rounded border-l-4 border-orange-500 bg-orange-50 p-3 text-sm"
                    >
                      {alert}
                    </div>
                  ))}
                </div>
              )}

              {/* Concentration */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Buyer Concentration
                  </h3>
                  {Object.keys(exposure.buyerConcentration).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No buyer exposure
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {Object.entries(exposure.buyerConcentration).map(
                        ([id, amount]) => (
                          <div
                            key={id}
                            className="flex justify-between rounded border px-3 py-1 text-sm"
                          >
                            <span className="font-mono text-xs">
                              {id.slice(0, 8)}…
                            </span>
                            <span>
                              {formatCurrency(
                                amount as number,
                                (exposure.currency ?? "GBP") as "GBP" | "SAR",
                              )}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Supplier Concentration
                  </h3>
                  {Object.keys(exposure.supplierConcentration).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No supplier exposure
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {Object.entries(exposure.supplierConcentration).map(
                        ([id, amount]) => (
                          <div
                            key={id}
                            className="flex justify-between rounded border px-3 py-1 text-sm"
                          >
                            <span className="font-mono text-xs">
                              {id.slice(0, 8)}…
                            </span>
                            <span>
                              {formatCurrency(
                                amount as number,
                                (exposure.currency ?? "GBP") as "GBP" | "SAR",
                              )}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    snapshotMutation.mutate(exposure.liquidityPartnerId)
                  }
                  disabled={snapshotMutation.isPending}
                >
                  Take Exposure Snapshot
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
