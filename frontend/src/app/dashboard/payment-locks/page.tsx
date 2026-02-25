"use client";

import { useQuery } from "@tanstack/react-query";
import { paymentLocksApi } from "@/lib/api";
import {
  formatCurrency,
  formatDate,
  statusVariant,
  statusLabel,
} from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function PaymentLocksPage() {
  const { user } = useAuth();
  const { data: locks, isLoading } = useQuery({
    queryKey: ["payment-locks"],
    queryFn: () => paymentLocksApi.list().then((r) => r.data),
  });

  const activeLocks = locks?.filter((l) => l.status === "LOCKED") ?? [];
  const releasedLocks = locks?.filter((l) => l.status === "RELEASED") ?? [];
  const totalLockedPennies = activeLocks.reduce(
    (sum, l) => sum + l.amountPennies,
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payment Locks</h1>
        <p className="text-sm text-muted-foreground">
          Conditional escrow locks for purchase orders
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  Active Locks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{activeLocks.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Total Locked
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {formatCurrency(totalLockedPennies)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <LockOpen className="h-3.5 w-3.5" />
                  Released
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{releasedLocks.length}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" />
                {user?.role === "BUYER"
                  ? "Your Payment Locks"
                  : "Payment Locks on Your POs"}
              </CardTitle>
              <CardDescription>
                {user?.role === "BUYER"
                  ? "Funds locked when suppliers accept your purchase orders"
                  : "Buyer funds locked against your accepted purchase orders"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!locks?.length ? (
                <div className="py-8 text-center text-muted-foreground">
                  <p>No payment locks found.</p>
                  <p className="text-xs mt-1">
                    Payment locks are created automatically when a supplier
                    accepts a purchase order.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Reference</TableHead>
                      <TableHead>
                        {user?.role === "BUYER" ? "Supplier" : "Buyer"}
                      </TableHead>
                      <TableHead>Locked Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Locked At</TableHead>
                      <TableHead>Released At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locks.map((lock) => (
                      <TableRow key={lock.id}>
                        <TableCell className="font-mono text-sm">
                          {lock.purchaseOrder?.reference ?? "—"}
                        </TableCell>
                        <TableCell>
                          {user?.role === "BUYER"
                            ? (lock.purchaseOrder?.supplier?.companyName ?? "—")
                            : (lock.purchaseOrder?.buyer?.companyName ?? "—")}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(lock.amountPennies)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(lock.status)}>
                            {lock.status === "LOCKED" ? (
                              <Lock className="mr-1 h-3 w-3" />
                            ) : (
                              <LockOpen className="mr-1 h-3 w-3" />
                            )}
                            {statusLabel(lock.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(lock.lockedAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {lock.releasedAt ? formatDate(lock.releasedAt) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
