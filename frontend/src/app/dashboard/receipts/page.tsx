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
      toast.error("Failed to load local receipts");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  async function verifyAll() {
    if (receipts.length === 0) {
      toast.info("No receipts to verify");
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
        toast.success(`All ${data.verified} receipts verified ✓`);
      } else {
        toast.warning(
          `${data.verified}/${data.total} verified — ${data.missing + data.mismatched} issues found`,
        );
      }
    } catch {
      toast.error("Failed to verify receipts against ledger");
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
      toast.success("Receipts exported");
    } catch {
      toast.error("Failed to export receipts");
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
            Verified
          </Badge>
        );
      case "MISSING":
        return <Badge variant="destructive">Missing</Badge>;
      case "HASH_MISMATCH":
        return <Badge variant="destructive">Hash Mismatch</Badge>;
      case "SEQUENCE_MISMATCH":
        return <Badge variant="destructive">Seq Mismatch</Badge>;
      default:
        return <Badge variant="secondary">Not Checked</Badge>;
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
            My Receipts
          </h1>
          <p className="text-sm text-muted-foreground">
            Locally stored, platform-signed event receipts — Layer 4
            non-repudiation proof
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
            Export JSON
          </Button>
          <Button
            size="sm"
            onClick={verifyAll}
            disabled={verifying || receipts.length === 0}
          >
            <ShieldCheck className="h-4 w-4 mr-1" />
            {verifying ? "Verifying…" : "Verify All"}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Receipts</CardDescription>
            <CardTitle className="text-3xl">{count}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Stored in browser IndexedDB
            </p>
          </CardContent>
        </Card>

        {verificationSummary && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Verified</CardDescription>
                <CardTitle className="text-3xl text-green-600">
                  {verificationSummary.verified}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Match platform ledger
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Missing</CardDescription>
                <CardTitle className="text-3xl text-red-600">
                  {verificationSummary.missing}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Not found in ledger
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mismatched</CardDescription>
                <CardTitle className="text-3xl text-amber-600">
                  {verificationSummary.mismatched}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Hash or sequence differs
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
                  All {verificationSummary.verified} local receipts match the
                  platform ledger. No events have been omitted or altered.
                </p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {verificationSummary.missing + verificationSummary.mismatched}{" "}
                  receipt(s) do not match the platform ledger. This may indicate
                  tampering or data loss.
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
            <p className="text-lg font-medium">No receipts stored yet</p>
            <p className="text-sm mt-1">
              Receipts are automatically captured when you perform signed
              actions (send POs, accept deliveries, fund early payments, etc.)
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Receipt Log</CardTitle>
            <CardDescription>
              Each row is a platform-signed receipt stored in your browser at
              the moment you performed the action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Seq</TableHead>
                  <TableHead>Signed</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event Hash</TableHead>
                  <TableHead className="text-center">Status</TableHead>
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
          <CardTitle className="text-lg">About Local Receipts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Layer 4 — "Can't Omit":</strong> Every time you perform a
            signed action, the platform returns a receipt containing the event
            hash, sequence number, and an ECDSA P-256 platform signature. This
            receipt is stored in your browser's IndexedDB.
          </p>
          <p>
            <strong>Why it matters:</strong> If the platform were to ever remove
            or alter an event, your locally held receipt provides cryptographic
            proof of what was committed. The platform cannot deny issuing the
            receipt because it is signed with its private key.
          </p>
          <p>
            <strong>Verification:</strong> Click "Verify All" to check each
            receipt against the live platform ledger. Green = the event hash and
            sequence match. Red = a discrepancy was found.
          </p>
          <p>
            <strong>Export:</strong> Download receipts as JSON for external
            backup or independent verification. The exported file includes
            platform signatures that can be verified with the platform's public
            key.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
