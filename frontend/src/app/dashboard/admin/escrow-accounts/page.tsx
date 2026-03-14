"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type EscrowAccount } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Building2, Plus, Power, PowerOff } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

export default function EscrowAccountsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["escrow-accounts"],
    queryFn: () => adminApi.listEscrowAccounts().then((r) => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      adminApi.updateEscrowAccount(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow-accounts"] });
      toast.success("Escrow account updated");
    },
    onError: () => toast.error("Failed to update escrow account"),
  });

  const activeAccounts = accounts?.filter((a) => a.active) ?? [];
  const totalBalance = activeAccounts.reduce(
    (sum, a) => sum + a.balanceMinor,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escrow Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Manage segregated escrow accounts per country and currency
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Account
            </Button>
          </DialogTrigger>
          <CreateEscrowDialog
            onCreated={() => {
              setCreateOpen(false);
              queryClient.invalidateQueries({ queryKey: ["escrow-accounts"] });
            }}
          />
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              Total Accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{accounts?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeAccounts.length} active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Shadow Balance (GBP)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(
                activeAccounts
                  .filter((a) => a.currency === "GBP")
                  .reduce((s, a) => s + a.balanceMinor, 0),
                "GBP",
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Shadow Balance (SAR)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(
                activeAccounts
                  .filter((a) => a.currency === "SAR")
                  .reduce((s, a) => s + a.balanceMinor, 0),
                "SAR",
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Accounts list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            All Escrow Accounts
          </CardTitle>
          <CardDescription>
            Each escrow account holds funds for a specific country/currency pair
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !accounts?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              No escrow accounts created yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Shadow Balance</TableHead>
                  <TableHead className="text-right">Instruments</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acct) => (
                  <TableRow key={acct.id}>
                    <TableCell className="font-medium">{acct.label}</TableCell>
                    <TableCell>{acct.bank}</TableCell>
                    <TableCell>{acct.country}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{acct.currency}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(
                        acct.balanceMinor,
                        acct.currency as "GBP" | "SAR",
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {acct._count?.instruments ?? 0}
                    </TableCell>
                    <TableCell>
                      {acct.active ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(acct.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/admin/escrow-accounts/${acct.id}/statement`}
                        >
                          <Button variant="ghost" size="sm" className="text-xs">
                            Statement
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            toggleMutation.mutate({
                              id: acct.id,
                              active: !acct.active,
                            })
                          }
                          disabled={toggleMutation.isPending}
                        >
                          {acct.active ? (
                            <PowerOff className="h-4 w-4 text-destructive" />
                          ) : (
                            <Power className="h-4 w-4 text-emerald-600" />
                          )}
                        </Button>
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

// ── Create Dialog ─────────────────────────────────────────────

function CreateEscrowDialog({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [bank, setBank] = useState("");
  const [country, setCountry] = useState("GB");
  const [currency, setCurrency] = useState("GBP");

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createEscrowAccount({ label, bank, country, currency }),
    onSuccess: () => {
      toast.success("Escrow account created");
      onCreated();
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(
        err.response?.data?.message || "Failed to create escrow account",
      );
    },
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Escrow Account</DialogTitle>
        <DialogDescription>
          Add a new segregated escrow account for a country/currency pair.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="space-y-2">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            placeholder="e.g. UK GBP Primary"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank">Bank</Label>
          <Input
            id="bank"
            placeholder="e.g. Barclays PLC"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GB">GB — United Kingdom</SelectItem>
                <SelectItem value="SA">SA — Saudi Arabia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GBP">GBP (£)</SelectItem>
                <SelectItem value="SAR">SAR (﷼)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          className="w-full"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !label.trim() || !bank.trim()}
        >
          {createMutation.isPending ? "Creating…" : "Create Account"}
        </Button>
      </div>
    </DialogContent>
  );
}
