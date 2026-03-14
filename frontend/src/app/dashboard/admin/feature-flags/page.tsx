"use client";

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
import { ToggleLeft, ToggleRight } from "lucide-react";

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

export default function FeatureFlagsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => featureFlagApi.list().then((r) => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ flag, enabled }: { flag: string; enabled: boolean }) =>
      featureFlagApi.toggle(flag, enabled).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <p className="text-sm text-muted-foreground">
          Manage platform feature flags and pilot gating. Toggle flags globally
          or per-organisation.
        </p>
      </div>

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
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={f.enabled ? "outline" : "default"}
                  disabled={toggleMutation.isPending}
                  onClick={() =>
                    toggleMutation.mutate({
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
