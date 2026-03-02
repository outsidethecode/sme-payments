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

const STATUS_BADGE: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "outline";
    label: string;
  }
> = {
  PENDING: { variant: "outline", label: "Pending" },
  ACCEPTED: { variant: "default", label: "Accepted" },
  EXPIRED: { variant: "secondary", label: "Expired" },
  CANCELLED: { variant: "destructive", label: "Cancelled" },
};

export default function InvitationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"SUPPLIER" | "LIQUIDITY_PARTNER">(
    "SUPPLIER",
  );
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

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
        <h2 className="text-2xl font-bold tracking-tight">Invitations</h2>
        <p className="text-muted-foreground">
          Invite suppliers to join your supply chain
        </p>
      </div>

      {/* Create Invitation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send Invitation</CardTitle>
          <CardDescription>
            Invited suppliers will receive a 1-click registration link
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invEmail">Email Address</Label>
              <Input
                id="invEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="supplier@example.com"
              />
            </div>
            {user?.role === "ADMIN" && (
              <div className="w-44 space-y-1">
                <Label>Role</Label>
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
                    <SelectItem value="SUPPLIER">Supplier</SelectItem>
                    <SelectItem value="LIQUIDITY_PARTNER">
                      Liquidity Partner
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
              {createMutation.isPending ? "Sending…" : "Send Invite"}
            </Button>
          </div>
          {createMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {(createMutation.error as any)?.response?.data?.message ||
                "Failed to create invitation"}
            </p>
          )}
          {createMutation.isSuccess && (
            <p className="mt-2 text-sm text-green-600">
              Invitation sent successfully!
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invitation List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Invitations{" "}
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingCount} pending
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invitations sent yet
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                          ? "LP"
                          : "Supplier"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_BADGE[inv.status]?.variant || "outline"}
                      >
                        {STATUS_BADGE[inv.status]?.label || inv.status}
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
