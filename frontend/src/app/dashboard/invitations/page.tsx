"use client";

import { useAuth } from "@/lib/auth-context";
import { invitationsApi, type Invitation } from "@/lib/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  UserPlus,
  Copy,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";

const STATUS_BADGE: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "outline";
    labelKey: string;
  }
> = {
  PENDING: { variant: "outline", labelKey: "invitations.statusPending" },
  ACCEPTED: { variant: "default", labelKey: "invitations.statusAccepted" },
  EXPIRED: { variant: "secondary", labelKey: "invitations.statusExpired" },
  CANCELLED: {
    variant: "destructive",
    labelKey: "invitations.statusCancelled",
  },
};

export default function InvitationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"SUPPLIER" | "LIQUIDITY_PARTNER">(
    "SUPPLIER",
  );
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const { t } = useTranslation();

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => invitationsApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      invitationsApi.create({ inviteeEmail: email, inviteeRole: role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      setEmail("");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invitationsApi.cancel(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["invitations"] }),
  });

  const copyInviteLink = (token: string) => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    navigator.clipboard.writeText(`${baseUrl}/invite/${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const pendingCount = invitations.filter(
    (inv) => inv.status === "PENDING",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {t("invitations.title")}
        </h2>
        <p className="text-muted-foreground">{t("invitations.subtitle")}</p>
      </div>

      {/* Create Invitation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("invitations.sendInvitation")}
          </CardTitle>
          <CardDescription>
            {t("invitations.sendInvitationDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invEmail">{t("invitations.emailAddress")}</Label>
              <Input
                id="invEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("invitations.emailPlaceholder")}
              />
            </div>
            {user?.role === "ADMIN" && (
              <div className="w-44 space-y-1">
                <Label>{t("invitations.role")}</Label>
                <Select
                  value={role}
                  onValueChange={(v) =>
                    setRole(v as "SUPPLIER" | "LIQUIDITY_PARTNER")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SUPPLIER">
                      {t("invitations.roleSupplier")}
                    </SelectItem>
                    <SelectItem value="LIQUIDITY_PARTNER">
                      {t("invitations.roleLiquidityPartner")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!email || createMutation.isPending}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {createMutation.isPending
                ? t("invitations.sending")
                : t("invitations.sendInvite")}
            </Button>
          </div>
          {createMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {(createMutation.error as any)?.response?.data?.message ||
                t("invitations.invitationFailed")}
            </p>
          )}
          {createMutation.isSuccess && (
            <p className="mt-2 text-sm text-green-600">
              {t("invitations.invitationSent")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invitation List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("invitations.title")}{" "}
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {t("invitations.pendingCount", { count: pendingCount })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("invitations.noInvitations")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invitations.colEmail")}</TableHead>
                  <TableHead>{t("invitations.colRole")}</TableHead>
                  <TableHead>{t("invitations.colStatus")}</TableHead>
                  <TableHead>{t("invitations.colSent")}</TableHead>
                  <TableHead>{t("invitations.colExpires")}</TableHead>
                  <TableHead className="text-right">
                    {t("invitations.colActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.inviteeEmail}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {inv.inviteeRole === "LIQUIDITY_PARTNER"
                          ? t("invitations.lpBadge")
                          : t("invitations.roleSupplier")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_BADGE[inv.status]?.variant || "outline"}
                      >
                        {STATUS_BADGE[inv.status]?.labelKey
                          ? t(STATUS_BADGE[inv.status].labelKey)
                          : inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {inv.status === "PENDING" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyInviteLink(inv.token)}
                            >
                              {copiedToken === inv.token ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelMutation.mutate(inv.id)}
                              disabled={cancelMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
