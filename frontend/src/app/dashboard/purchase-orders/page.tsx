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
import { Plus, Eye, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "@/i18n";

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { data: pos, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => poApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("purchaseOrders.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "BUYER"
              ? t("purchaseOrders.buyerSubtitle")
              : t("purchaseOrders.supplierSubtitle")}
          </p>
        </div>
        {user?.role === "BUYER" && (
          <div className="flex gap-2">
            <Link href="/dashboard/purchase-orders/import">
              <Button variant="outline">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {t("purchaseOrders.importCSV")}
              </Button>
            </Link>
            <Link href="/dashboard/purchase-orders/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("purchaseOrders.newPO")}
              </Button>
            </Link>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("purchaseOrders.allOrders")}</CardTitle>
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
              <p>{t("purchaseOrders.noPurchaseOrders")}</p>
              {user?.role === "BUYER" && (
                <Link href="/dashboard/purchase-orders/new">
                  <Button variant="outline" className="mt-4">
                    {t("purchaseOrders.createFirstPO")}
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("purchaseOrders.colReference")}</TableHead>
                  <TableHead>
                    {user?.role === "BUYER"
                      ? t("purchaseOrders.colSupplier")
                      : t("purchaseOrders.colBuyer")}
                  </TableHead>
                  <TableHead>{t("purchaseOrders.colAmount")}</TableHead>
                  <TableHead>{t("purchaseOrders.colStatus")}</TableHead>
                  <TableHead>{t("purchaseOrders.colDate")}</TableHead>
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
                      {formatCurrency(
                        po.totalAmountPennies,
                        po.currency as "GBP" | "SAR",
                      )}
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
