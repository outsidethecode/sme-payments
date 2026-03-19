"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { featureFlagApi, FlagStatus } from "@/lib/api";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleLeft,
  ToggleRight,
  Building2,
  Globe,
  X,
} from "lucide-react";
import api from "@/lib/api";

/** Human-friendly descriptions for each flag */
const FLAG_DESCRIPTIONS: Record<string, string> = {
  REAL_BANK_ESCROW:
    "Use real bank webhooks for escrow funding instead of simulated setTimeout",
  REAL_KYB_PROVIDER: "Use Wathq KYB provider instead of mock verification",
  LP_MARKETPLACE:
    "Enable the liquidity-provider marketplace for early payment matching",
  EARLY_PAYMENTS: "Allow suppliers to request early payment on eligible POs",
  MULTI_CURRENCY: "Enable SAR alongside GBP for cross-border transactions",
  ESCROW_TRANSACTIONS: "Enable the escrow transaction journal for audit trail",
  POLICY_ENGINE:
    "Enable the policy evaluation engine with approval workflows and escalation",
  SUPPLIER_APPROVALS:
    "Require supplier-side approval before accepting purchase orders (Phase 9)",
  LP_FUNDING_APPROVALS:
    "Require LP funding approval before early payment disbursement (Phase 9)",
  DELEGATION:
    "Allow authority delegation between organisation members (Phase 9)",
  ESCALATION:
    "Enable automatic approval escalation and expiry handling (Phase 9)",
};

const SOURCE_LABELS: Record<string, string> = {
  env: "Env Var",
  "db-global": "Global Override",
  "db-org": "Org Override",
  default: "Default",
};

function sourceBadgeVariant(
  source: string,
): "default" | "secondary" | "outline" | "destructive" {
  switch (source) {
    case "db-global":
    case "db-org":
      return "default";
    case "env":
      return "secondary";
    default:
      return "outline";
  }
}

interface Organisation {
  id: string;
  name: string;
  type: string;
}

export default function FeatureFlagsPage() {
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>(
    undefined,
  );

  // Fetch all orgs for the selector
  const { data: orgsData } = useQuery({
    queryKey: ["organisations-list"],
    queryFn: () =>
      api.get<Organisation[]>("/organisations").then((r) => r.data),
  });
  const orgs = orgsData ?? [];

  // Fetch flags — scoped to selected org or global
  const { data, isLoading, error } = useQuery({
    queryKey: ["feature-flags", selectedOrgId ?? "global"],
    queryFn: () => featureFlagApi.list(selectedOrgId).then((r) => r.data),
  });

  // Toggle globally
  const toggleGlobalMutation = useMutation({
    mutationFn: ({ flag, enabled }: { flag: string; enabled: boolean }) =>
      featureFlagApi.toggle(flag, enabled).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

  // Toggle per-org
  const toggleOrgMutation = useMutation({
    mutationFn: ({
      flag,
      enabled,
      organisationId,
    }: {
      flag: string;
      enabled: boolean;
      organisationId: string;
    }) =>
      featureFlagApi
        .toggle(flag, enabled, organisationId)
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

  const isPending =
    toggleGlobalMutation.isPending || toggleOrgMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-sm text-muted-foreground">
            Manage platform feature flags and pilot gating
          </p>
        </div>
        <div className="grid gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              Failed to load feature flags. Please try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const flags: FlagStatus[] = data?.flags ?? [];
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <p className="text-sm text-muted-foreground">
          Manage platform feature flags and pilot gating. Toggle flags globally
          or per-organisation.
        </p>
      </div>

      {/* ── Org Selector ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Scope</CardTitle>
          <CardDescription>
            View global defaults or select an organisation to see per-org
            resolution and set overrides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select
              value={selectedOrgId ?? "__global__"}
              onValueChange={(v) =>
                setSelectedOrgId(v === "__global__" ? undefined : v)
              }
            >
              <SelectTrigger className="w-[360px]">
                <SelectValue placeholder="Global (all organisations)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__">
                  <span className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Global (all organisations)
                  </span>
                </SelectItem>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    <span className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {org.name}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({org.type})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOrgId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedOrgId(undefined)}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Flags Grid ─────────────────────────────────────── */}
      <div className="grid gap-4">
        {flags.map((f) => (
          <Card key={f.flag}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base font-mono">
                    {f.flag}
                  </CardTitle>
                  <CardDescription>
                    {FLAG_DESCRIPTIONS[f.flag] ?? "No description available"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={sourceBadgeVariant(f.source)}>
                    {SOURCE_LABELS[f.source] ?? f.source}
                  </Badge>
                  <Badge
                    variant={f.enabled ? "default" : "outline"}
                    className={
                      f.enabled
                        ? "bg-green-600 hover:bg-green-700"
                        : "text-muted-foreground"
                    }
                  >
                    {f.enabled ? "ON" : "OFF"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Global toggle — always available */}
                {!selectedOrgId && (
                  <Button
                    size="sm"
                    variant={f.enabled ? "outline" : "default"}
                    disabled={isPending}
                    onClick={() =>
                      toggleGlobalMutation.mutate({
                        flag: f.flag,
                        enabled: !f.enabled,
                      })
                    }
                  >
                    {f.enabled ? (
                      <>
                        <ToggleRight className="mr-2 h-4 w-4" />
                        Disable Globally
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="mr-2 h-4 w-4" />
                        Enable Globally
                      </>
                    )}
                  </Button>
                )}

                {/* Per-org toggle — when an org is selected */}
                {selectedOrgId && (
                  <>
                    <Button
                      size="sm"
                      variant={f.enabled ? "outline" : "default"}
                      disabled={isPending}
                      onClick={() =>
                        toggleOrgMutation.mutate({
                          flag: f.flag,
                          enabled: !f.enabled,
                          organisationId: selectedOrgId,
                        })
                      }
                    >
                      <Building2 className="mr-2 h-4 w-4" />
                      {f.enabled ? "Disable" : "Enable"} for{" "}
                      {selectedOrg?.name ?? "this org"}
                    </Button>
                    {f.source === "db-org" && (
                      <span className="text-xs text-muted-foreground ml-1">
                        This org has a specific override
                      </span>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
