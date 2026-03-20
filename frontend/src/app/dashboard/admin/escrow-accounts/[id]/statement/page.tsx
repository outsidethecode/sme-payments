"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
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
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  MinusCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "@/i18n";

const TX_TYPE_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    icon: typeof ArrowDownCircle;
    sign: "+" | "-";
  }
> = {
  DEPOSIT: {
    label: "Deposit",
    color: "bg-green-100 text-green-800",
    icon: ArrowDownCircle,
    sign: "+",
  },
  RELEASE_SUPPLIER: {
    label: "Release (Supplier)",
    color: "bg-blue-100 text-blue-800",
    icon: ArrowUpCircle,
    sign: "-",
  },
  RELEASE_LP: {
    label: "Release (LP)",
    color: "bg-indigo-100 text-indigo-800",
    icon: ArrowUpCircle,
    sign: "-",
  },
  REFUND_BUYER: {
    label: "Refund",
    color: "bg-orange-100 text-orange-800",
    icon: MinusCircle,
    sign: "-",
  },
  FEE_DEDUCTION: {
    label: "Platform Fee",
    color: "bg-purple-100 text-purple-800",
    icon: MinusCircle,
    sign: "-",
  },
};

const TX_TYPE_I18N_KEY: Record<string, string> = {
  DEPOSIT: "escrowStatement.txDeposit",
  RELEASE_SUPPLIER: "escrowStatement.txReleaseSupplier",
  RELEASE_LP: "escrowStatement.txReleaseLP",
  REFUND_BUYER: "escrowStatement.txRefund",
  FEE_DEDUCTION: "escrowStatement.txPlatformFee",
};

export default function EscrowStatementPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const accountId = params.id;
  const { t } = useTranslation();

  const {
    data: statement,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["escrow-statement", accountId],
    queryFn: () => adminApi.getEscrowStatement(accountId).then((r) => r.data),
    enabled: !!accountId,
  });

  const { data: verification, refetch: refetchVerification } = useQuery({
    queryKey: ["escrow-verify", accountId],
    queryFn: () => adminApi.verifyEscrowBalance(accountId).then((r) => r.data),
    enabled: !!accountId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboard/admin/escrow-accounts")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("escrowStatement.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {statement?.label} &middot; {statement?.currency}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            refetchVerification();
          }}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("escrowStatement.currentBalance")}
            </CardDescription>
            <CardTitle className="text-2xl">
              {statement
                ? formatCurrency(
                    statement.currentBalance,
                    statement.currency as "GBP" | "SAR",
                  )
                : "—"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("escrowStatement.totalTransactions")}
            </CardDescription>
            <CardTitle className="text-2xl">
              {statement?.transactions.length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("escrowStatement.journalVerification")}
            </CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {verification ? (
                verification.match ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="text-green-700">
                      {t("escrowStatement.balanced")}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-600" />
                    <span className="text-red-700">
                      {t("escrowStatement.mismatch")}
                    </span>
                  </>
                )
              ) : (
                "—"
              )}
            </CardTitle>
          </CardHeader>
          {verification && !verification.match && (
            <CardContent>
              <p className="text-sm text-destructive">
                {t("escrowStatement.shadowJournal", {
                  shadow: verification.shadowBalance,
                  journal: verification.computedBalance,
                })}
              </p>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Transaction table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("escrowStatement.transactionJournal")}</CardTitle>
          <CardDescription>
            {t("escrowStatement.transactionJournalDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statement?.transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("escrowStatement.noTransactions")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("escrowStatement.colDate")}</TableHead>
                  <TableHead>{t("escrowStatement.colType")}</TableHead>
                  <TableHead>{t("escrowStatement.colReference")}</TableHead>
                  <TableHead className="text-right">
                    {t("escrowStatement.colAmount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("escrowStatement.colBalanceAfter")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement?.transactions.map((tx) => {
                  const config = TX_TYPE_CONFIG[tx.type] ?? {
                    label: tx.type,
                    color: "bg-gray-100 text-gray-800",
                    icon: MinusCircle,
                    sign: "-" as const,
                  };
                  const Icon = config.icon;

                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`${config.color} gap-1`}
                        >
                          <Icon className="h-3 w-3" />
                          {TX_TYPE_I18N_KEY[tx.type]
                            ? t(TX_TYPE_I18N_KEY[tx.type])
                            : config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {tx.reference}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          config.sign === "+"
                            ? "text-green-700"
                            : "text-red-700"
                        }`}
                      >
                        {config.sign}
                        {statement
                          ? formatCurrency(
                              tx.amountMinor,
                              statement.currency as "GBP" | "SAR",
                            )
                          : tx.amountMinor}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {statement
                          ? formatCurrency(
                              tx.balanceAfter,
                              statement.currency as "GBP" | "SAR",
                            )
                          : tx.balanceAfter}
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
