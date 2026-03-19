"use client";

import { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { disputesApi, evidenceApi, type EvidenceAttachment } from "@/lib/api";
import { formatCurrency, formatDateTime, statusLabel } from "@/lib/format";
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import Link from "next/link";
import {
  ArrowLeft,
  Scale,
  Upload,
  Download,
  FileText,
  Image as ImageIcon,
  Package,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";

/* ── constants ──────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-yellow-100 text-yellow-800",
  EVIDENCE_SUBMITTED: "bg-blue-100 text-blue-800",
  UNDER_REVIEW: "bg-purple-100 text-purple-800",
  RESOLVED: "bg-green-100 text-green-800",
};

const OUTCOME_LABELS: Record<string, string> = {
  FULL_REFUND: "Full Refund",
  PARTIAL_REFUND: "Partial Refund",
  RELEASE_TO_SUPPLIER: "Released to Supplier",
  REWORK: "Rework Required",
};

const EVIDENCE_TYPES = [
  { value: "DELIVERY_NOTE", label: "Delivery Note" },
  { value: "SIGNED_RECEIPT", label: "Signed Receipt" },
  { value: "PHOTO_PROOF", label: "Photo Proof" },
  { value: "INVOICE", label: "Invoice" },
  { value: "INSPECTION_REPORT", label: "Inspection Report" },
  { value: "SHIPPING_DOCUMENT", label: "Shipping Document" },
  { value: "PO_DOCUMENT", label: "PO Document" },
  { value: "OTHER", label: "Other" },
];

function evidenceTypeLabel(type: string) {
  return EVIDENCE_TYPES.find((t) => t.value === type)?.label ?? type;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
  return <Package className="h-4 w-4" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── page ───────────────────────────────────────────────────── */

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // evidence upload state
  const [selectedType, setSelectedType] = useState("DELIVERY_NOTE");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // resolve dialog state
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState("FULL_REFUND");
  const [refundAmount, setRefundAmount] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");

  /* ── queries ── */

  const { data: dispute, isLoading } = useQuery({
    queryKey: ["dispute", id],
    queryFn: () => disputesApi.getById(id).then((r) => r.data),
  });

  const poId = dispute?.purchaseOrderId;

  const { data: attachments = [] } = useQuery({
    queryKey: ["evidence", poId],
    queryFn: () => evidenceApi.listByPO(poId!).then((r) => r.data),
    enabled: !!poId,
  });

  /* ── mutations ── */

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      evidenceApi.upload({
        purchaseOrderId: poId!,
        type: selectedType,
        description: description || undefined,
        file,
      }),
    onSuccess: (res) => {
      // After uploading, attach to the dispute
      const evidenceId = res.data.id;
      submitEvidenceMutation.mutate([evidenceId]);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      toast.error(msg || "Upload failed");
    },
  });

  const submitEvidenceMutation = useMutation({
    mutationFn: (evidenceIds: string[]) =>
      disputesApi.submitEvidence(id, evidenceIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispute", id] });
      queryClient.invalidateQueries({ queryKey: ["evidence", poId] });
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      toast.success("Evidence submitted to the dispute");
      setSelectedFile(null);
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      toast.error(msg || "Failed to submit evidence");
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => disputesApi.markUnderReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispute", id] });
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      toast.success("Dispute marked as Under Review");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (data: {
      outcome: string;
      refundAmount?: number;
      resolutionNotes?: string;
    }) =>
      disputesApi.resolve(id, {
        outcome: data.outcome as
          | "FULL_REFUND"
          | "PARTIAL_REFUND"
          | "RELEASE_TO_SUPPLIER"
          | "REWORK",
        refundAmount: data.refundAmount,
        resolutionNotes: data.resolutionNotes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispute", id] });
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      toast.success("Dispute resolved");
      setResolveOpen(false);
    },
  });

  /* ── handlers ── */

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error("Select a file first");
      return;
    }
    uploadMutation.mutate(selectedFile);
  }

  async function handleDownload(att: EvidenceAttachment) {
    try {
      const res = await evidenceApi.download(att.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = att.filename;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  }

  /* ── derived ── */

  const isAdmin = user?.role === "ADMIN";
  const isBuyer = user?.role === "BUYER";
  const isSupplier = user?.role === "SUPPLIER";
  const canSubmitEvidence =
    (isBuyer || isSupplier) && dispute?.status !== "RESOLVED";

  const buyerEvidenceIds = new Set(dispute?.buyerEvidence ?? []);
  const supplierEvidenceIds = new Set(dispute?.supplierEvidence ?? []);
  const buyerAttachments = attachments.filter((a) =>
    buyerEvidenceIds.has(a.id),
  );
  const supplierAttachments = attachments.filter((a) =>
    supplierEvidenceIds.has(a.id),
  );

  /* ── loading / error ── */

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading dispute…</div>;
  }

  if (!dispute) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <p className="text-muted-foreground">Dispute not found.</p>
      </div>
    );
  }

  const currency = (dispute.purchaseOrder?.currency as "GBP" | "SAR") ?? "SAR";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {dispute.purchaseOrder?.referenceNumber ?? "Dispute"}
            </h1>
            <Badge className={STATUS_COLORS[dispute.status] ?? ""}>
              {statusLabel(dispute.status)}
            </Badge>
            {dispute.outcome && (
              <Badge variant="outline">
                {OUTCOME_LABELS[dispute.outcome] ??
                  statusLabel(dispute.outcome)}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Raised by {dispute.raisedBy?.name ?? "Unknown"} on{" "}
            {formatDateTime(dispute.createdAt)}
          </p>
        </div>
        <Link href={`/dashboard/purchase-orders/${dispute.purchaseOrderId}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-2 h-4 w-4" />
            View PO
          </Button>
        </Link>
      </div>

      {/* Dispute Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-red-600" />
            Dispute Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm font-medium text-muted-foreground">
              Reason
            </span>
            <p className="mt-1">{dispute.reason}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <span className="text-muted-foreground">PO Amount</span>
              <p className="font-medium">
                {dispute.purchaseOrder
                  ? formatCurrency(dispute.purchaseOrder.amount, currency)
                  : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">{statusLabel(dispute.status)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Buyer Evidence</span>
              <p className="font-medium">
                {(dispute.buyerEvidence ?? []).length} file(s)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Supplier Evidence</span>
              <p className="font-medium">
                {(dispute.supplierEvidence ?? []).length} file(s)
              </p>
            </div>
          </div>

          {dispute.refundAmount !== null &&
            dispute.refundAmount !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">Refund Amount:</span>{" "}
                <span className="font-medium">
                  {formatCurrency(dispute.refundAmount, currency)}
                </span>
              </div>
            )}

          {dispute.resolutionNotes && (
            <div className="rounded bg-muted p-3 text-sm">
              <span className="font-medium">Resolution Notes:</span>{" "}
              {dispute.resolutionNotes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidence Upload — buyer / supplier only */}
      {canSubmitEvidence && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-blue-600" />
              Submit Evidence
            </CardTitle>
            <CardDescription>
              Upload a file to support your side of the dispute. Files are
              SHA-256 hashed and recorded on the immutable ledger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Evidence Type</Label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description (optional)</Label>
                  <Input
                    placeholder="Brief note about this file"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">File</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx"
                    onChange={(e) =>
                      setSelectedFile(e.target.files?.[0] || null)
                    }
                  />
                </div>
                <Button
                  type="submit"
                  disabled={
                    !selectedFile ||
                    uploadMutation.isPending ||
                    submitEvidenceMutation.isPending
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploadMutation.isPending || submitEvidenceMutation.isPending
                    ? "Uploading…"
                    : "Upload & Submit"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Already-submitted evidence */}
      <div className="grid gap-6 md:grid-cols-2">
        <EvidenceList
          title="Buyer Evidence"
          attachments={buyerAttachments}
          allAttachments={attachments}
          evidenceIds={dispute.buyerEvidence ?? []}
          onDownload={handleDownload}
          emptyText="No buyer evidence submitted yet"
        />
        <EvidenceList
          title="Supplier Evidence"
          attachments={supplierAttachments}
          allAttachments={attachments}
          evidenceIds={dispute.supplierEvidence ?? []}
          onDownload={handleDownload}
          emptyText="No supplier evidence submitted yet"
        />
      </div>

      {/* Admin Actions */}
      {isAdmin && dispute.status !== "RESOLVED" && (
        <Card className="border-purple-200 dark:border-purple-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-purple-600" />
              Admin Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {dispute.status !== "UNDER_REVIEW" && (
              <Button
                variant="outline"
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending}
              >
                <Clock className="mr-2 h-4 w-4" />
                {reviewMutation.isPending ? "Updating…" : "Mark Under Review"}
              </Button>
            )}

            <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
              <DialogTrigger asChild>
                <Button>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Resolve Dispute
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Resolve Dispute</DialogTitle>
                  <DialogDescription>
                    Choose an outcome for this dispute. PO:{" "}
                    {dispute.purchaseOrder?.referenceNumber}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Outcome
                    </label>
                    <select
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={resolveOutcome}
                      onChange={(e) => setResolveOutcome(e.target.value)}
                    >
                      <option value="FULL_REFUND">Full Refund to Buyer</option>
                      <option value="PARTIAL_REFUND">Partial Refund</option>
                      <option value="RELEASE_TO_SUPPLIER">
                        Release to Supplier
                      </option>
                      <option value="REWORK">Rework Required</option>
                    </select>
                  </div>

                  {resolveOutcome === "PARTIAL_REFUND" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Refund Amount (smallest unit)
                      </label>
                      <input
                        type="number"
                        className="w-full rounded border px-3 py-2 text-sm"
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        placeholder={`e.g. 50000 for ${currency === "SAR" ? "SAR 500.00" : "£500.00"}`}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Resolution Notes
                    </label>
                    <textarea
                      className="w-full rounded border px-3 py-2 text-sm"
                      rows={3}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Explain the resolution decision…"
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() =>
                      resolveMutation.mutate({
                        outcome: resolveOutcome,
                        refundAmount: refundAmount
                          ? parseInt(refundAmount)
                          : undefined,
                        resolutionNotes: resolutionNotes || undefined,
                      })
                    }
                    disabled={resolveMutation.isPending}
                  >
                    {resolveMutation.isPending
                      ? "Resolving…"
                      : "Confirm Resolution"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      {/* Helpful guidance */}
      {dispute.status !== "RESOLVED" && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>How dispute resolution works</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>
              1. Both the <strong>buyer</strong> and <strong>supplier</strong>{" "}
              can upload evidence to support their case.
            </p>
            <p>
              2. Once both sides have submitted evidence, the status changes to{" "}
              <strong>Evidence Submitted</strong>.
            </p>
            <p>
              3. A platform <strong>admin</strong> reviews the evidence and
              resolves the dispute with one of four outcomes: Full Refund,
              Partial Refund, Release to Supplier, or Rework.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/* ── Evidence list sub-component ────────────────────────────── */

function EvidenceList({
  title,
  attachments,
  allAttachments,
  evidenceIds,
  onDownload,
  emptyText,
}: {
  title: string;
  attachments: EvidenceAttachment[];
  allAttachments: EvidenceAttachment[];
  evidenceIds: string[];
  onDownload: (att: EvidenceAttachment) => void;
  emptyText: string;
}) {
  // If we have loaded attachments matching the IDs, show them.
  // Otherwise fall back to a count.
  const displayAttachments =
    attachments.length > 0
      ? attachments
      : allAttachments.filter((a) => evidenceIds.includes(a.id));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">
          {evidenceIds.length} file(s) submitted
        </CardDescription>
      </CardHeader>
      <CardContent>
        {displayAttachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {displayAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {fileIcon(att.mimeType)}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{att.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {att.type ? evidenceTypeLabel(att.type) : "—"} ·{" "}
                      {formatBytes(att.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDownload(att)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
