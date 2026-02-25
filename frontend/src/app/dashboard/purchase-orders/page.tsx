"use client";

import { useQuery } from "@tanstack/react-query";
import { poApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
import Link from "next/link";
import { Plus, Eye } from "lucide-react";

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { data: pos, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => poApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "BUYER"
              ? "Manage orders you've created"
              : "View orders sent to you"}
          </p>
        </div>
        {user?.role === "BUYER" && (
          <Link href="/dashboard/purchase-orders/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New PO
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Orders</CardTitle>
          <CardDescription>
            {pos?.length ?? 0} purchase order
            {(pos?.length ?? 0) !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !pos?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <p>No purchase orders yet</p>
              {user?.role === "BUYER" && (
                <Link href="/dashboard/purchase-orders/new">
                  <Button variant="outline" className="mt-4">
                    Create your first PO
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>
                    {user?.role === "BUYER" ? "Supplier" : "Buyer"}
                  </TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-sm">
                      {po.reference}
                    </TableCell>
                    <TableCell>
                      {user?.role === "BUYER"
                        ? (po.supplier?.companyName ?? "—")
                        : (po.buyer?.companyName ?? "—")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(po.totalAmountPennies)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(po.status)}>
                        {statusLabel(po.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(po.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/purchase-orders/${po.id}`}>
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
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
