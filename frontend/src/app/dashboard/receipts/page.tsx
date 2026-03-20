"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getReceipts,
  getReceiptCount,
  exportReceipts,
  type StoredReceipt,
} from "@/lib/receipt-store";
import { ledgerApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
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
import { toast } from "sonner";
import {
  Receipt,
  ShieldCheck,
  Download,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Fingerprint,
} from "lucide-react";
import { useTranslation } from "@/i18n";

type VerificationStatus =
  | "PENDING"
  | "VERIFIED"
  | "MISSING"
  | "HASH_MISMATCH"
  | "SEQUENCE_MISMATCH";

interface ReceiptWithStatus extends StoredReceipt {
  verificationStatus?: VerificationStatus;
}

export default function ReceiptsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState<ReceiptWithStatus[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationSummary, setVerificationSummary] = useState<{
    total: number;
    verified: number;
    missing: number;
    mismatched: number;
    allVerified: boolean;
  } | null>(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const [allReceipts, totalCount] = await Promise.all([
        getReceipts(user?.id),
        getReceiptCount(),
      ]);
      setReceipts(allReceipts);
      setCount(totalCount);
    } catch {
      toast.error(t("receipts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  async function verifyAll() {
    if (receipts.length === 0) {
      toast.info(t("receipts.noReceiptsToVerify"));
      return;
    }

    setVerifying(true);
    setVerificationSummary(null);

    try {
      const stubs = receipts.map((r) => ({
        eventId: r.eventId,
        eventHash: r.eventHash,
        entityId: r.entityId,
        entitySequence: r.entitySequence,
      }));

      const { data } = await ledgerApi.verifyReceipts(stubs);

      // Map verification results back to receipts
      const statusMap = new Map(data.results.map((r) => [r.eventId, r.status]));
      setReceipts((prev) =>
        prev.map((receipt) => ({
          ...receipt,
          verificationStatus:
            statusMap.get(receipt.eventId) ?? ("PENDING" as VerificationStatus),
        })),
      );

      setVerificationSummary({
        total: data.total,
        verified: data.verified,
        missing: data.missing,
        mismatched: data.mismatched,
        allVerified: data.allVerified,
      });

      if (data.allVerified) {
        toast.success(t("receipts.allVerifiedToast", { count: data.verified }));
      } else {
        toast.warning(
          t("receipts.partialVerifiedToast", {
            verified: data.verified,
            total: data.total,
            issues: data.missing + data.mismatched,
          }),
        );
      }
    } catch {
      toast.error(t("receipts.verifyFailed"));
    } finally {
      setVerifying(false);
    }
  }

  async function handleExport() {
    try {
      const json = await exportReceipts();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipts-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("receipts.receiptsExported"));
    } catch {
      toast.error(t("receipts.exportFailed"));
    }
  }

  function statusIcon(status?: VerificationStatus) {
    switch (status) {
      case "VERIFIED":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "MISSING":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "HASH_MISMATCH":
      case "SEQUENCE_MISMATCH":
        return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      default:
        return <span className="h-4 w-4 text-muted-foreground">—</span>;
    }
  }

  function statusBadge(status?: VerificationStatus) {
    switch (status) {
      case "VERIFIED":
        return (
          <Badge variant="default" className="bg-green-600">
            {t("receipts.statusVerified")}
          </Badge>
        );
      case "MISSING":
        return (
          <Badge variant="destructive">{t("receipts.statusMissing")}</Badge>
        );
      case "HASH_MISMATCH":
        return (
          <Badge variant="destructive">
            {t("receipts.statusHashMismatch")}
          </Badge>
        );
      case "SEQUENCE_MISMATCH":
        return (
          <Badge variant="destructive">{t("receipts.statusSeqMismatch")}</Badge>
        );
      default:
        return (
          <Badge variant="secondary">{t("receipts.statusNotChecked")}</Badge>
        );
    }
  }

  function eventLabel(eventType: string) {
    return eventType
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="h-6 w-6" />
            {t("receipts.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("receipts.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadReceipts}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={receipts.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {t("receipts.exportJSON")}
          </Button>
          <Button
            size="sm"
            onClick={verifyAll}
            disabled={verifying || receipts.length === 0}
          >
            <ShieldCheck className="h-4 w-4 mr-1" />
            {verifying ? t("receipts.verifying") : t("receipts.verifyAll")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("receipts.totalReceipts")}</CardDescription>
            <CardTitle className="text-3xl">{count}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {t("receipts.storedInIndexedDB")}
            </p>
          </CardContent>
        </Card>

        {verificationSummary && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("receipts.verified")}</CardDescription>
                <CardTitle className="text-3xl text-green-600">
                  {verificationSummary.verified}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t("receipts.matchPlatformLedger")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("receipts.missing")}</CardDescription>
                <CardTitle className="text-3xl text-red-600">
                  {verificationSummary.missing}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t("receipts.notFoundInLedger")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("receipts.mismatched")}</CardDescription>
                <CardTitle className="text-3xl text-amber-600">
                  {verificationSummary.mismatched}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t("receipts.hashOrSequenceDiffers")}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Verification Banner */}
      {verificationSummary && (
        <Card
          className={
            verificationSummary.allVerified
              ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
          }
        >
          <CardContent className="flex items-center gap-3 py-4">
            {verificationSummary.allVerified ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {t("receipts.allVerified", {
                    count: verificationSummary.verified,
                  })}
                </p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {t("receipts.verificationIssues", {
                    count:
                      verificationSummary.missing +
                      verificationSummary.mismatched,
                  })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Receipts Table */}
      {receipts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Receipt className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">{t("receipts.noReceipts")}</p>
            <p className="text-sm mt-1">
              {t("receipts.noReceiptsDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("receipts.receiptLogTitle")}
            </CardTitle>
            <CardDescription>
              {t("receipts.receiptLogDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">{t("receipts.colNum")}</TableHead>
                  <TableHead>{t("receipts.colEvent")}</TableHead>
                  <TableHead>{t("receipts.colEntity")}</TableHead>
                  <TableHead>{t("receipts.colSeq")}</TableHead>
                  <TableHead>{t("receipts.colSigned")}</TableHead>
                  <TableHead>{t("receipts.colTimestamp")}</TableHead>
                  <TableHead>{t("receipts.colEventHash")}</TableHead>
                  <TableHead className="text-center">
                    {t("receipts.colStatus")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt, i) => (
                  <TableRow key={receipt.eventId}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">
                        {eventLabel(receipt.eventType)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">
                        {receipt.entityId.slice(0, 8)}…
                      </code>
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      {receipt.entitySequence}
                    </TableCell>
                    <TableCell>
                      {receipt.signed ? (
                        <Fingerprint className="h-4 w-4 text-green-600" />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(receipt.timestamp)}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">
                        {receipt.eventHash.slice(0, 16)}…
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {statusIcon(receipt.verificationStatus)}
                        {statusBadge(receipt.verificationStatus)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Technical Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("receipts.aboutTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("receipts.aboutLayer4")}</p>
          <p>{t("receipts.aboutWhyMatters")}</p>
          <p>{t("receipts.aboutVerification")}</p>
          <p>{t("receipts.aboutExport")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
