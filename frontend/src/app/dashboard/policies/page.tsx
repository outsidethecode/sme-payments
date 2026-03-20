"use client";

import { useAuth } from "@/lib/auth-context";
import { policiesApi, type PolicyRule } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCcw,
  Database,
  Activity,
  Search,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";

const RULE_TYPE_LABELS: Record<string, string> = {
  PO_APPROVAL: "PO Approval",
  PO_ORDER_LIMITS: "PO Order Limits",
  FUNDING_LIMIT: "Funding Limit",
  ESCROW_FUNDING: "Escrow Funding",
  SUPPLIER_ACCEPTANCE: "Supplier Acceptance",
  SETTLEMENT: "Settlement",
  EARLY_PAYMENT: "Early Payment",
  LP_FUNDING: "LP Funding",
  DISPUTE_RESOLUTION: "Dispute Resolution",
  DELIVERY_VERIFICATION: "Delivery Verification",
};

const AVAILABLE_ROLES = [
  { value: "OWNER", label: "Owner" },
  { value: "APPROVER", label: "Approver" },
  { value: "FINANCE", label: "Finance" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
] as const;

/** Rule types that use exposure/fee conditions instead of amount ranges */
const FUNDING_LIMIT_TYPE = "FUNDING_LIMIT";

const isFundingLimitType = (rt: string) => rt === FUNDING_LIMIT_TYPE;

export default function PoliciesPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const orgId = user?.organisationId;
  const isAdmin = user?.role === "ADMIN";
  const currency = (user?.currency as "GBP" | "SAR") || "GBP";
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string>("all");
  const [simAmount, setSimAmount] = useState("");
  const [simRuleType, setSimRuleType] = useState("PO_APPROVAL");
  const [createOpen, setCreateOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    ruleType: "PO_APPROVAL",
    minAmount: "",
    maxAmount: "",
    // Funding Limit fields
    maxExposureTotal: "",
    maxExposurePerBuyer: "",
    maxExposurePerSupplier: "",
    maxTenorDays: "",
    feeBps: "",
    // Approval fields
    requiredApprovals: "0",
    requiredRoles: [] as string[],
    autoApprove: false,
    priority: "1",
  });

  const resetNewRule = () =>
    setNewRule({
      name: "",
      ruleType: "PO_APPROVAL",
      minAmount: "",
      maxAmount: "",
      maxExposureTotal: "",
      maxExposurePerBuyer: "",
      maxExposurePerSupplier: "",
      maxTenorDays: "",
      feeBps: "",
      requiredApprovals: "0",
      requiredRoles: [],
      autoApprove: false,
      priority: "1",
    });

  // ── Queries ─────────────────────────────────────────────────

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ["policies", orgId],
    queryFn: () => (orgId ? policiesApi.byOrg(orgId).then((r) => r.data) : []),
    enabled: !!orgId,
  });

  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ["policies", "readiness", orgId],
    queryFn: () =>
      orgId ? policiesApi.readiness(orgId).then((r) => r.data) : null,
    enabled: !!orgId,
  });

  // ── Mutations ───────────────────────────────────────────────

  const seedMutation = useMutation({
    mutationFn: () =>
      isAdmin && orgId
        ? policiesApi.seedDefaults(orgId)
        : policiesApi.seedMyDefaults(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      isAdmin && orgId
        ? policiesApi.resetDefaults(orgId)
        : policiesApi.resetMyDefaults(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });

  const simMutation = useMutation({
    mutationFn: () =>
      policiesApi
        .simulate(parseInt(simAmount, 10) || 0, simRuleType)
        .then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const isFunding = isFundingLimitType(newRule.ruleType);
      const conditions: Record<string, unknown> = isFunding
        ? {
            ...(newRule.maxExposureTotal
              ? { maxExposureTotal: parseInt(newRule.maxExposureTotal, 10) }
              : {}),
            ...(newRule.maxExposurePerBuyer
              ? { maxExposurePerBuyer: parseFloat(newRule.maxExposurePerBuyer) }
              : {}),
            ...(newRule.maxExposurePerSupplier
              ? {
                  maxExposurePerSupplier: parseFloat(
                    newRule.maxExposurePerSupplier,
                  ),
                }
              : {}),
            ...(newRule.maxTenorDays
              ? { maxTenorDays: parseInt(newRule.maxTenorDays, 10) }
              : {}),
            ...(newRule.feeBps ? { feeBps: parseInt(newRule.feeBps, 10) } : {}),
          }
        : {
            ...(newRule.minAmount
              ? { minAmount: parseInt(newRule.minAmount, 10) }
              : {}),
            ...(newRule.maxAmount
              ? { maxAmount: parseInt(newRule.maxAmount, 10) }
              : {}),
          };
      return policiesApi.createMyRule({
        organisationId: orgId || "",
        ruleType: newRule.ruleType,
        name: newRule.name,
        conditions,
        requiredApprovals: newRule.autoApprove
          ? 0
          : parseInt(newRule.requiredApprovals, 10) || 0,
        requiredRoles: newRule.autoApprove ? [] : newRule.requiredRoles,
        autoApprove: newRule.autoApprove,
        priority: parseInt(newRule.priority, 10) || 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      setCreateOpen(false);
      resetNewRule();
    },
  });

  // ── Filters ─────────────────────────────────────────────────

  const filteredRules =
    ruleTypeFilter === "all"
      ? rules
      : rules.filter((r: PolicyRule) => r.ruleType === ruleTypeFilter);

  const activeRules = rules.filter((r: PolicyRule) => r.active);
  const ruleTypes = [...new Set(rules.map((r: PolicyRule) => r.ruleType))];

  if (!orgId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t("policies.noOrganisation")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            {t("policies.title")}
          </h1>
          <p className="text-muted-foreground">{t("policies.subtitle")}</p>
        </div>
        {
          <div className="flex gap-2">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  {t("policies.addRule")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                  <DialogTitle>{t("policies.createPolicyRule")}</DialogTitle>
                  <DialogDescription>
                    {isFundingLimitType(newRule.ruleType)
                      ? "Configure exposure caps and fees for liquidity provider funding."
                      : `Add an approval rule. Amounts in minor units (e.g. 5000000 = ${currency === "SAR" ? "SAR 50,000" : "£50,000"}).`}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {/* ── Common: Name + Type ── */}
                  <div className="grid gap-2">
                    <Label htmlFor="rule-name">{t("policies.ruleName")}</Label>
                    <Input
                      id="rule-name"
                      placeholder="e.g. Auto-approve POs ≤ £10,000"
                      value={newRule.name}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="rule-type">{t("policies.ruleType")}</Label>
                    <Select
                      value={newRule.ruleType}
                      onValueChange={(v) =>
                        setNewRule((prev) => ({
                          ...prev,
                          ruleType: v,
                          // Reset auto-approve for FUNDING_LIMIT (always auto)
                          autoApprove: isFundingLimitType(v)
                            ? true
                            : prev.autoApprove,
                        }))
                      }
                    >
                      <SelectTrigger id="rule-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RULE_TYPE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* ── FUNDING_LIMIT: exposure / fee fields ── */}
                  {isFundingLimitType(newRule.ruleType) ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="max-exposure">
                          {t("policies.maxExposureTotal")}
                        </Label>
                        <Input
                          id="max-exposure"
                          type="number"
                          placeholder="e.g. 200000000 for £2M"
                          value={newRule.maxExposureTotal}
                          onChange={(e) =>
                            setNewRule((prev) => ({
                              ...prev,
                              maxExposureTotal: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="per-buyer">
                            {t("policies.maxPerBuyer")}
                          </Label>
                          <Input
                            id="per-buyer"
                            type="number"
                            step="0.05"
                            placeholder="0.4"
                            value={newRule.maxExposurePerBuyer}
                            onChange={(e) =>
                              setNewRule((prev) => ({
                                ...prev,
                                maxExposurePerBuyer: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="per-supplier">
                            {t("policies.maxPerSupplier")}
                          </Label>
                          <Input
                            id="per-supplier"
                            type="number"
                            step="0.05"
                            placeholder="0.3"
                            value={newRule.maxExposurePerSupplier}
                            onChange={(e) =>
                              setNewRule((prev) => ({
                                ...prev,
                                maxExposurePerSupplier: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="tenor">
                            {t("policies.maxTenorDays")}
                          </Label>
                          <Input
                            id="tenor"
                            type="number"
                            placeholder="90"
                            value={newRule.maxTenorDays}
                            onChange={(e) =>
                              setNewRule((prev) => ({
                                ...prev,
                                maxTenorDays: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="fee">
                            {t("policies.feeBasisPoints")}
                          </Label>
                          <Input
                            id="fee"
                            type="number"
                            placeholder="200"
                            value={newRule.feeBps}
                            onChange={(e) =>
                              setNewRule((prev) => ({
                                ...prev,
                                feeBps: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    /* ── Amount-range types: min/max ── */
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="min-amount">
                          {t("policies.minAmount")}
                        </Label>
                        <Input
                          id="min-amount"
                          type="number"
                          placeholder="0"
                          value={newRule.minAmount}
                          onChange={(e) =>
                            setNewRule((prev) => ({
                              ...prev,
                              minAmount: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="max-amount">
                          {t("policies.maxAmount")}
                        </Label>
                        <Input
                          id="max-amount"
                          type="number"
                          placeholder="e.g. 5000000"
                          value={newRule.maxAmount}
                          onChange={(e) =>
                            setNewRule((prev) => ({
                              ...prev,
                              maxAmount: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* ── Common: Priority ── */}
                  <div className="grid gap-2">
                    <Label htmlFor="priority">{t("policies.priority")}</Label>
                    <Input
                      id="priority"
                      type="number"
                      min="1"
                      value={newRule.priority}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          priority: e.target.value,
                        }))
                      }
                    />
                  </div>

                  {/* ── Auto-approve toggle ── */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="auto-approve"
                      checked={newRule.autoApprove}
                      disabled={isFundingLimitType(newRule.ruleType)}
                      onCheckedChange={(checked) =>
                        setNewRule((prev) => ({
                          ...prev,
                          autoApprove: checked === true,
                          // Clear approval fields when toggling on
                          ...(checked === true
                            ? { requiredApprovals: "0", requiredRoles: [] }
                            : {}),
                        }))
                      }
                    />
                    <Label
                      htmlFor="auto-approve"
                      className={
                        isFundingLimitType(newRule.ruleType)
                          ? "text-muted-foreground"
                          : ""
                      }
                    >
                      {t("policies.autoApprove")}
                      {isFundingLimitType(newRule.ruleType)
                        ? ` ${t("policies.autoApproveFundingLimit")}`
                        : ` ${t("policies.autoApproveNone")}`}
                    </Label>
                  </div>

                  {/* ── Approval fields — hidden when auto-approve ── */}
                  {!newRule.autoApprove && (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="required-approvals">
                          {t("policies.requiredApprovals")}
                        </Label>
                        <Input
                          id="required-approvals"
                          type="number"
                          min="1"
                          value={newRule.requiredApprovals}
                          onChange={(e) =>
                            setNewRule((prev) => ({
                              ...prev,
                              requiredApprovals: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t("policies.requiredRoles")}</Label>
                        <div className="flex flex-wrap gap-3">
                          {AVAILABLE_ROLES.map((role) => (
                            <div
                              key={role.value}
                              className="flex items-center gap-1.5"
                            >
                              <Checkbox
                                id={`role-${role.value}`}
                                checked={newRule.requiredRoles.includes(
                                  role.value,
                                )}
                                onCheckedChange={(checked) =>
                                  setNewRule((prev) => ({
                                    ...prev,
                                    requiredRoles: checked
                                      ? [...prev.requiredRoles, role.value]
                                      : prev.requiredRoles.filter(
                                          (r) => r !== role.value,
                                        ),
                                  }))
                                }
                              />
                              <Label
                                htmlFor={`role-${role.value}`}
                                className="text-sm font-normal"
                              >
                                {role.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {createMutation.error && (
                  <p className="text-sm text-red-600">
                    Error: {(createMutation.error as Error).message}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending || !newRule.name}
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    {t("policies.createRule")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Database className="h-4 w-4 mr-1" />
              )}
              {t("policies.seedDefaults")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCcw className="h-4 w-4 mr-1" />
              )}
              {t("policies.resetToDefaults")}
            </Button>
          </div>
        }
      </div>

      {/* Seed / Reset results */}
      {seedMutation.data && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <p className="text-sm text-green-800">
              {t("policies.seededResult", {
                created: (seedMutation.data as any).created,
                skipped: (seedMutation.data as any).skipped,
              })}
            </p>
          </CardContent>
        </Card>
      )}
      {resetMutation.data && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4">
            <p className="text-sm text-blue-800">
              {t("policies.resetResult", {
                count: (resetMutation.data as any).created,
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("policies.totalRules")}</CardDescription>
            <CardTitle className="text-2xl">{rules.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("policies.activeRules")}</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {activeRules.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("policies.ruleTypes")}</CardDescription>
            <CardTitle className="text-2xl">{ruleTypes.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("policies.pilotReadiness")}</CardDescription>
            <CardTitle className="text-2xl">
              {readinessLoading ? "…" : `${readiness?.readyPercentage ?? 0}%`}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Pilot Readiness Checklist */}
      {readiness && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t("policies.pilotChecklist")}
            </CardTitle>
            <CardDescription>
              {t("policies.pilotProgress", {
                pct: readiness.readyPercentage,
                passed: readiness.checks.filter((c) => c.complete).length,
                total: readiness.checks.length,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {readiness.checks.map((check) => (
                <div
                  key={check.key}
                  className="flex items-center gap-2 rounded-md border p-3"
                >
                  {check.complete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                  <span
                    className={
                      check.complete
                        ? "text-green-800"
                        : "text-muted-foreground"
                    }
                  >
                    {check.label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Policy Simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t("policies.policySimulator")}
          </CardTitle>
          <CardDescription>
            {t("policies.simulatorDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">
                {t("policies.amountMinorUnits")}
              </label>
              <Input
                type="number"
                placeholder="e.g. 5000000 for £50,000"
                value={simAmount}
                onChange={(e) => setSimAmount(e.target.value)}
              />
            </div>
            <div className="w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                {t("policies.simulateRuleType")}
              </label>
              <Select value={simRuleType} onValueChange={setSimRuleType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RULE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => simMutation.mutate()}
              disabled={simMutation.isPending || !simAmount}
            >
              {simMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Search className="h-4 w-4 mr-1" />
              )}
              {t("policies.simulateButton")}
            </Button>
          </div>
          {simMutation.data && (
            <div className="mt-4 rounded-md border p-4">
              {simMutation.data.matched ? (
                <div>
                  <p className="font-medium text-green-700">
                    {t("policies.simMatched", {
                      name: simMutation.data.rule?.name ?? "",
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("policies.simDetails", {
                      approvals: simMutation.data.rule?.requiredApprovals ?? 0,
                      roles:
                        simMutation.data.rule?.requiredRoles?.join(", ") ||
                        "None",
                      autoApprove: simMutation.data.rule?.autoApprove
                        ? t("policies.simAutoApproveYes")
                        : t("policies.simAutoApproveNo"),
                    })}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {t("policies.simNoMatch", {
                    message: simMutation.data.message ?? "",
                  })}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rules Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("policies.activePolicyRules")}</CardTitle>
              <CardDescription>
                {t("policies.rulesShown", { count: filteredRules.length })}
              </CardDescription>
            </div>
            <Select value={ruleTypeFilter} onValueChange={setRuleTypeFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("policies.filterByType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("policies.allTypes")}</SelectItem>
                {ruleTypes.map((rt) => (
                  <SelectItem key={rt} value={rt}>
                    {RULE_TYPE_LABELS[rt] ?? rt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rulesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredRules.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t("policies.noPolicyRules")} {isAdmin && t("policies.seedHint")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("policies.colName")}</TableHead>
                  <TableHead>{t("policies.colType")}</TableHead>
                  <TableHead>{t("policies.colRange")}</TableHead>
                  <TableHead>{t("policies.colApprovals")}</TableHead>
                  <TableHead>{t("policies.colRoles")}</TableHead>
                  <TableHead>{t("policies.colAuto")}</TableHead>
                  <TableHead>{t("policies.colPriority")}</TableHead>
                  <TableHead>{t("policies.colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map((rule: PolicyRule) => {
                  const cond = rule.conditions || {};
                  const min = (cond.minAmount as number) ?? null;
                  const max = (cond.maxAmount as number) ?? null;
                  return (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {min !== null && max !== null
                          ? `${formatCurrency(min, currency)} – ${formatCurrency(max, currency)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{rule.requiredApprovals}</TableCell>
                      <TableCell className="text-sm">
                        {rule.requiredRoles?.length > 0
                          ? rule.requiredRoles.join(", ")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {rule.autoApprove ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400" />
                        )}
                      </TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>
                        <Badge variant={rule.active ? "default" : "secondary"}>
                          {rule.active
                            ? t("policies.activeBadge")
                            : t("policies.inactiveBadge")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
