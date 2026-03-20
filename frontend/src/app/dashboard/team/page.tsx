"use client";

import { useAuth } from "@/lib/auth-context";
import {
  organisationsApi,
  type OrgMember,
  type OrgPermission,
  type OrgDelegation,
} from "@/lib/api";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Users,
  Shield,
  ArrowRightLeft,
  Trash2,
  Plus,
  Check,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";

// ── Constants ──────────────────────────────────────────────

const ALL_ROLES = ["OWNER", "APPROVER", "FINANCE", "MEMBER", "VIEWER"] as const;
const ALL_ACTIONS = [
  "PO_APPROVAL",
  "ESCROW_FUNDING",
  "DELIVERY_VERIFICATION",
  "SETTLEMENT",
  "SUPPLIER_ACCEPTANCE",
  "EARLY_PAYMENT",
  "LP_FUNDING",
  "DISPUTE_RESOLUTION",
] as const;

const DEFAULT_ALLOWED_ROLES: Record<string, string[]> = {
  PO_APPROVAL: ["OWNER", "FINANCE", "APPROVER", "MEMBER"],
  ESCROW_FUNDING: ["OWNER", "FINANCE"],
  DELIVERY_VERIFICATION: ["OWNER", "FINANCE"],
  SETTLEMENT: ["OWNER", "FINANCE"],
  SUPPLIER_ACCEPTANCE: ["OWNER", "APPROVER", "FINANCE"],
  EARLY_PAYMENT: ["OWNER", "FINANCE"],
  LP_FUNDING: ["OWNER", "APPROVER", "FINANCE"],
  DISPUTE_RESOLUTION: ["OWNER"],
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: "default",
  APPROVER: "secondary",
  FINANCE: "outline",
  MEMBER: "secondary",
  VIEWER: "outline",
};

function formatAction(action: string) {
  return action
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// ── Tabs ───────────────────────────────────────────────────

type Tab = "members" | "permissions" | "delegations";

export default function TeamPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const { t } = useTranslation();
  const orgId = user?.organisationId;
  const isOwnerOrAdmin = user?.orgRole === "OWNER" || user?.role === "ADMIN";

  if (!orgId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t("team.noOrganisation")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("team.title")}</h1>
        <p className="text-muted-foreground">{t("team.subtitle")}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b">
        {[
          { key: "members" as const, label: t("team.tabMembers"), icon: Users },
          {
            key: "permissions" as const,
            label: t("team.tabPermissionMatrix"),
            icon: Shield,
          },
          {
            key: "delegations" as const,
            label: t("team.tabDelegations"),
            icon: ArrowRightLeft,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "members" && (
        <MembersTab orgId={orgId} isOwner={!!isOwnerOrAdmin} />
      )}
      {activeTab === "permissions" && (
        <PermissionsTab orgId={orgId} isOwner={!!isOwnerOrAdmin} />
      )}
      {activeTab === "delegations" && (
        <DelegationsTab orgId={orgId} isOwner={!!isOwnerOrAdmin} />
      )}
    </div>
  );
}

// ── Members Tab ─────────────────────────────────────────────

function MembersTab({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<OrgMember | null>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    password: "",
    orgRole: "MEMBER" as string,
  });
  const [inviteError, setInviteError] = useState("");

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () =>
      organisationsApi.members(orgId).then((r) =>
        r.data.map((m) => ({
          id: m.id,
          userId: m.userId ?? m.user?.id ?? m.id,
          name: m.user?.name ?? "Unknown",
          email: m.user?.email ?? "",
          orgRole: m.orgRole,
        })),
      ),
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      organisationsApi.updateMemberRole(orgId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", orgId] });
      setEditingUser(null);
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      organisationsApi.removeMember(orgId, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const inviteMember = useMutation({
    mutationFn: (data: {
      email: string;
      name: string;
      password: string;
      orgRole: string;
    }) => organisationsApi.inviteTeamMember(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", orgId] });
      setShowInvite(false);
      setInviteForm({ email: "", name: "", password: "", orgRole: "MEMBER" });
      setInviteError("");
    },
    onError: (err: any) => {
      setInviteError(err?.response?.data?.message || t("team.inviteFailed"));
    },
  });

  if (isLoading) {
    return <p className="text-muted-foreground">{t("team.loadingMembers")}</p>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />{" "}
              {t("team.membersCount", { count: members.length })}
            </CardTitle>
            <CardDescription>{t("team.membersDescription")}</CardDescription>
          </div>
          {isOwner && (
            <Button onClick={() => setShowInvite(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t("team.inviteMember")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="text-sm text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={(ROLE_COLORS[m.orgRole] as any) ?? "outline"}>
                  {m.orgRole}
                </Badge>
                {isOwner && m.orgRole !== "OWNER" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingUser(m);
                        setNewRole(m.orgRole);
                      }}
                    >
                      {t("team.changeRole")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => removeMember.mutate(m.userId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      {/* Role change dialog */}
      <Dialog
        open={!!editingUser}
        onOpenChange={(open) => !open && setEditingUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("team.changeRoleFor", { name: editingUser?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("team.changeRoleDescription")}
            </DialogDescription>
          </DialogHeader>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger>
              <SelectValue placeholder={t("team.selectRole")} />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.filter((r) => r !== "OWNER").map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editingUser &&
                updateRole.mutate({ userId: editingUser.userId, role: newRole })
              }
              disabled={updateRole.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite member dialog */}
      <Dialog
        open={showInvite}
        onOpenChange={(open) => {
          if (!open) {
            setShowInvite(false);
            setInviteError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.inviteTeamMember")}</DialogTitle>
            <DialogDescription>
              {t("team.inviteTeamDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("team.name")}</Label>
              <Input
                placeholder={t("team.namePlaceholder")}
                value={inviteForm.name}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("team.email")}</Label>
              <Input
                type="email"
                placeholder={t("team.emailPlaceholder")}
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("team.temporaryPassword")}</Label>
              <Input
                type="password"
                placeholder={t("team.passwordPlaceholder")}
                value={inviteForm.password}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, password: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteForm.orgRole}
                onValueChange={(v) =>
                  setInviteForm((f) => ({ ...f, orgRole: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("team.selectRole")} />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.filter((r) => r !== "OWNER").map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {inviteError && (
              <p className="text-sm text-destructive">{inviteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => inviteMember.mutate(inviteForm)}
              disabled={
                inviteMember.isPending ||
                !inviteForm.email ||
                !inviteForm.name ||
                !inviteForm.password
              }
            >
              {inviteMember.isPending
                ? t("team.inviting")
                : t("team.inviteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Permissions Tab ─────────────────────────────────────────

function PermissionsTab({
  orgId,
  isOwner,
}: {
  orgId: string;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ["org-permissions", orgId],
    queryFn: () => organisationsApi.getPermissions(orgId).then((r) => r.data),
  });

  // Build merged map: action → { roles, isOverride }
  const permissionMap: Record<
    string,
    { roles: string[]; isOverride: boolean }
  > = {};
  for (const action of ALL_ACTIONS) {
    const override = overrides.find((o) => o.action === action);
    permissionMap[action] = override
      ? { roles: override.allowedRoles, isOverride: true }
      : { roles: DEFAULT_ALLOWED_ROLES[action] ?? [], isOverride: false };
  }

  const toggleRole = useMutation({
    mutationFn: async ({
      action,
      role,
      enabled,
    }: {
      action: string;
      role: string;
      enabled: boolean;
    }) => {
      const current = permissionMap[action].roles;
      const next = enabled
        ? [...new Set([...current, role])]
        : current.filter((r) => r !== role);
      if (next.length === 0) {
        await organisationsApi.deletePermission(orgId, action);
      } else {
        await organisationsApi.setPermission(orgId, action, next);
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["org-permissions", orgId] }),
  });

  const resetAction = useMutation({
    mutationFn: (action: string) =>
      organisationsApi.deletePermission(orgId, action),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["org-permissions", orgId] }),
  });

  if (isLoading) {
    return <p className="text-muted-foreground">Loading permissions…</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" /> {t("team.permissionMatrix")}
        </CardTitle>
        <CardDescription>
          {t("team.permissionMatrixDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4 text-left font-medium">
                {t("team.action")}
              </th>
              {ALL_ROLES.map((r) => (
                <th key={r} className="px-2 py-2 text-center font-medium">
                  {r}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-medium">Reset</th>
            </tr>
          </thead>
          <tbody>
            {ALL_ACTIONS.map((action) => {
              const { roles, isOverride } = permissionMap[action];
              return (
                <tr key={action} className="border-b">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {formatAction(action)}
                    {isOverride && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-xs text-blue-600"
                      >
                        {t("team.customBadge")}
                      </Badge>
                    )}
                  </td>
                  {ALL_ROLES.map((role) => {
                    const allowed = roles.includes(role);
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        <button
                          disabled={!isOwner || toggleRole.isPending}
                          onClick={() =>
                            toggleRole.mutate({
                              action,
                              role,
                              enabled: !allowed,
                            })
                          }
                          className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
                            allowed
                              ? isOverride
                                ? "bg-blue-100 text-blue-700"
                                : "bg-green-100 text-green-700"
                              : "bg-muted text-muted-foreground"
                          } ${isOwner ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                        >
                          {allowed ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center">
                    {isOverride && isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetAction.mutate(action)}
                        disabled={resetAction.isPending}
                      >
                        Reset
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Delegations Tab ─────────────────────────────────────────

function DelegationsTab({
  orgId,
  isOwner,
}: {
  orgId: string;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState("");
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [validTo, setValidTo] = useState("");

  const { data: members = [] } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () =>
      organisationsApi.members(orgId).then((r) =>
        r.data.map((m) => ({
          id: m.id,
          userId: m.userId ?? m.user?.id ?? m.id,
          name: m.user?.name ?? "Unknown",
          email: m.user?.email ?? "",
          orgRole: m.orgRole,
        })),
      ),
  });

  const { data: delegations = [], isLoading } = useQuery({
    queryKey: ["org-delegations", orgId],
    queryFn: () => organisationsApi.getDelegations(orgId).then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () =>
      organisationsApi.createDelegation(orgId, {
        delegateUserId,
        actions: selectedActions,
        validTo,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-delegations", orgId] });
      setShowCreate(false);
      setDelegateUserId("");
      setSelectedActions([]);
      setValidTo("");
    },
  });

  const revoke = useMutation({
    mutationFn: (delegationId: string) =>
      organisationsApi.revokeDelegation(orgId, delegationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["org-delegations", orgId] }),
  });

  if (isLoading) {
    return (
      <p className="text-muted-foreground">{t("team.loadingDelegations")}</p>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5" />{" "}
                {t("team.delegationsCount", { count: delegations.length })}
              </CardTitle>
              <CardDescription>
                {t("team.delegationsDescription")}
              </CardDescription>
            </div>
            {isOwner && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="mr-1 h-4 w-4" /> {t("team.newDelegation")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {delegations.length === 0 ? (
            <p className="text-muted-foreground">{t("team.noDelegations")}</p>
          ) : (
            <div className="space-y-3">
              {delegations.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm">
                      <strong>{d.delegator?.name ?? "Unknown"}</strong>
                      {" → "}
                      <strong>{d.delegate?.name ?? "Unknown"}</strong>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.actions.map((a) => (
                        <Badge key={a} variant="outline" className="text-xs">
                          {formatAction(a)}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(d.validFrom).toLocaleDateString()} –{" "}
                      {new Date(d.validTo).toLocaleDateString()}
                    </p>
                  </div>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => revoke.mutate(d.id)}
                      disabled={revoke.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create delegation dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.createDelegation")}</DialogTitle>
            <DialogDescription>
              {t("team.createDelegationDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>{t("team.delegateTo")}</Label>
              <Select value={delegateUserId} onValueChange={setDelegateUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("team.selectMember")} />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.orgRole !== "OWNER")
                    .map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name} ({m.orgRole})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t("team.delegationActions")}</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {ALL_ACTIONS.map((action) => {
                  const selected = selectedActions.includes(action);
                  return (
                    <button
                      key={action}
                      onClick={() =>
                        setSelectedActions((prev) =>
                          selected
                            ? prev.filter((a) => a !== action)
                            : [...prev, action],
                        )
                      }
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted text-muted-foreground hover:border-foreground"
                      }`}
                    >
                      {formatAction(action)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>{t("team.validUntil")}</Label>
              <Input
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                max={
                  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .split("T")[0]
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={
                !delegateUserId ||
                selectedActions.length === 0 ||
                !validTo ||
                create.isPending
              }
            >
              {t("team.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
