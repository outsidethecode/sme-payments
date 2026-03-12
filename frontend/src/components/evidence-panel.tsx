"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { evidenceApi, type EvidenceAttachment } from "@/lib/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload,
  Download,
  ShieldCheck,
  FileText,
  Image,
  Package,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Lock,
} from "lucide-react";

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
  if (mimeType.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
  return <Package className="h-4 w-4" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidencePanel({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedType, setSelectedType] = useState("DELIVERY_NOTE");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: attachments, isLoading } = useQuery({
    queryKey: ["evidence", purchaseOrderId],
    queryFn: () => evidenceApi.listByPO(purchaseOrderId).then((r) => r.data),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      evidenceApi.upload({
        purchaseOrderId,
        type: selectedType,
        description: description || undefined,
        file,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["evidence", purchaseOrderId],
      });
      queryClient.invalidateQueries({ queryKey: ["ledger", purchaseOrderId] });
      toast.success("Evidence uploaded successfully");
      setSelectedFile(null);
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Upload failed");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => evidenceApi.verify(id),
    onSuccess: (res) => {
      if (res.data.valid) {
        toast.success("File integrity verified — hash matches ✓");
      } else {
        toast.error(
          "Integrity check FAILED — file may have been tampered with",
        );
      }
    },
  });

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evidence & Attachments</CardTitle>
        <CardDescription>
          Upload delivery notes, photos, invoices — files are hashed (SHA-256)
          and recorded in the immutable ledger
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Form */}
        <form
          onSubmit={handleUpload}
          className="space-y-3 rounded-md border p-3"
        >
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
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!selectedFile || uploadMutation.isPending}
            >
              <Upload className="mr-1 h-3 w-3" />
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>

        <Separator />

        {/* Attachments List */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading attachments…</p>
        ) : !attachments?.length ? (
          <p className="text-sm text-muted-foreground">
            No evidence uploaded yet
          </p>
        ) : (
          <div className="space-y-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-3 rounded-md border p-3 text-sm"
              >
                <div className="text-muted-foreground">
                  {fileIcon(att.mimeType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{att.filename}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {evidenceTypeLabel(att.type)}
                    </Badge>
                    <span>{formatBytes(att.sizeBytes)}</span>
                    <span>by {att.uploader?.name || "Unknown"}</span>
                    <span>{formatDateTime(att.createdAt)}</span>
                  </div>
                  {att.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {att.description}
                    </p>
                  )}
                  <code className="text-[9px] text-muted-foreground font-mono block mt-1">
                    SHA-256: {att.sha256Hash.slice(0, 16)}…
                  </code>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDownload(att)}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => verifyMutation.mutate(att.id)}
                    disabled={verifyMutation.isPending}
                    title="Verify integrity"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EvidencePackButton({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const [loading, setLoading] = useState(false);

  async function downloadPack() {
    setLoading(true);
    try {
      const res = await evidenceApi.pack(purchaseOrderId);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `evidence-pack-${purchaseOrderId.slice(0, 8)}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Evidence pack downloaded");
    } catch {
      toast.error("Failed to generate evidence pack");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={downloadPack}
      disabled={loading}
    >
      <Download className="mr-1 h-3 w-3" />
      {loading ? "Generating…" : "Evidence Pack"}
    </Button>
  );
}

// ── Instrument Lifecycle Card ─────────────────────────────────

interface InstrumentLifecycleStep {
  status: string;
  at: string;
  bankRef?: string | null;
}

interface InstrumentData {
  instrumentId: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  escrowReference: string | null;
  bankReference: string | null;
  lifecycle: InstrumentLifecycleStep[];
}

interface ReconciliationData {
  lastChecked: string;
  status: string;
  bankBalance: number | null;
  ledgerBalance: number | null;
  variance: number | null;
}

function lifecycleIcon(status: string) {
  switch (status) {
    case "CREATED":
      return <Clock className="h-3.5 w-3.5 text-blue-500" />;
    case "LOCKED":
      return <Lock className="h-3.5 w-3.5 text-amber-500" />;
    case "RELEASED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "FAILED":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatCurrencyAmount(amount: number, currency: string) {
  const major = amount / 100;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(major);
}

/**
 * Displays the payment instrument lifecycle and latest reconciliation status.
 * Designed to sit alongside the evidence panel in the PO detail page.
 */
export function InstrumentLifecycleCard({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const { data: pack, isLoading } = useQuery({
    queryKey: ["evidence-pack", purchaseOrderId],
    queryFn: () => evidenceApi.pack(purchaseOrderId).then((r) => r.data),
    staleTime: 60_000,
  });

  const instrument: InstrumentData | null = pack?.paymentInstrument ?? null;
  const reconciliation: ReconciliationData | null =
    pack?.reconciliation ?? null;

  if (isLoading) return null;
  if (!instrument && !reconciliation) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Financial Instrument & Reconciliation
        </CardTitle>
        <CardDescription>
          Payment instrument lifecycle and system reconciliation status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {instrument && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Payment Instrument</span>
              <Badge
                variant={
                  instrument.status === "RELEASED"
                    ? "default"
                    : instrument.status === "LOCKED"
                      ? "secondary"
                      : instrument.status === "FAILED"
                        ? "destructive"
                        : "outline"
                }
              >
                {instrument.status}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
              <span>
                Type: <span className="text-foreground">{instrument.type}</span>
              </span>
              <span>
                Amount:{" "}
                <span className="text-foreground">
                  {formatCurrencyAmount(instrument.amount, instrument.currency)}
                </span>
              </span>
              {instrument.escrowReference && (
                <span>
                  Escrow:{" "}
                  <span className="font-mono text-foreground text-xs">
                    {instrument.escrowReference}
                  </span>
                </span>
              )}
              {instrument.bankReference && (
                <span>
                  Bank Ref:{" "}
                  <span className="font-mono text-foreground text-xs">
                    {instrument.bankReference}
                  </span>
                </span>
              )}
            </div>

            {/* Lifecycle timeline */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Lifecycle
              </p>
              <div className="space-y-2">
                {instrument.lifecycle.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {lifecycleIcon(step.status)}
                    <span className="font-medium w-20">{step.status}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(step.at)}
                    </span>
                    {step.bankRef && (
                      <span className="text-xs font-mono text-muted-foreground">
                        ({step.bankRef})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {instrument && reconciliation && <Separator />}

        {reconciliation && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Reconciliation</span>
              <Badge
                variant={
                  reconciliation.status === "CONSISTENT"
                    ? "default"
                    : "destructive"
                }
              >
                {reconciliation.status === "CONSISTENT"
                  ? "Consistent"
                  : "Mismatch Detected"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
              <span>
                Last Checked:{" "}
                <span className="text-foreground">
                  {formatDateTime(reconciliation.lastChecked)}
                </span>
              </span>
              {reconciliation.variance !== null && (
                <span>
                  Variance:{" "}
                  <span
                    className={
                      reconciliation.variance === 0
                        ? "text-green-600"
                        : "text-red-600"
                    }
                  >
                    {reconciliation.variance === 0
                      ? "None"
                      : reconciliation.variance.toLocaleString()}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
