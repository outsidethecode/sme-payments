"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { disputesApi, type Dispute } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/format";
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
import { useState } from "react";

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

export default function DisputesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [resolveDialogId, setResolveDialogId] = useState<string | null>(null);
  const [resolveOutcome, setResolveOutcome] = useState<string>("FULL_REFUND");
  const [refundAmount, setRefundAmount] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");

  const { data: disputes = [], isLoading } = useQuery({
    queryKey: ["disputes", statusFilter],
    queryFn: () =>
      disputesApi
        .list(statusFilter ? { status: statusFilter } : undefined)
        .then((r) => r.data),
  });

  const reviewMutation = useMutation({
    mutationFn: (id: string) => disputesApi.markUnderReview(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["disputes"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      outcome,
      refundAmount,
      resolutionNotes,
    }: {
      id: string;
      outcome: string;
      refundAmount?: number;
      resolutionNotes?: string;
    }) =>
      disputesApi.resolve(id, {
        outcome: outcome as any,
        refundAmount,
        resolutionNotes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      setResolveDialogId(null);
      setResolutionNotes("");
      setRefundAmount("");
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading disputes…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Disputes</h1>
          <p className="text-muted-foreground">
            Manage purchase order disputes and resolutions
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {["", "OPEN", "EVIDENCE_SUBMITTED", "UNDER_REVIEW", "RESOLVED"].map(
          (s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s || "All"}
            </Button>
          ),
        )}
      </div>

      {disputes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No disputes found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {disputes.map((d: Dispute) => (
            <Card key={d.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {d.purchaseOrder?.referenceNumber ?? d.purchaseOrderId}
                    </CardTitle>
                    <CardDescription>
                      Raised by {d.raisedBy?.name ?? d.raisedById} on{" "}
                      {formatDateTime(d.createdAt)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_COLORS[d.status] ?? ""}>
                      {d.status.replace(/_/g, " ")}
                    </Badge>
                    {d.outcome && (
                      <Badge variant="outline">
                        {OUTCOME_LABELS[d.outcome] ?? d.outcome}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">Reason:</span> {d.reason}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">PO Amount:</span>{" "}
                    {d.purchaseOrder
                      ? formatCurrency(
                          d.purchaseOrder.amount,
                          d.purchaseOrder.currency as "GBP" | "SAR",
                        )
                      : "—"}
                  </div>
                  {d.refundAmount !== null && (
                    <div>
                      <span className="text-muted-foreground">
                        Refund Amount:
                      </span>{" "}
                      {formatCurrency(
                        d.refundAmount,
                        (d.purchaseOrder?.currency as "GBP" | "SAR") ?? "GBP",
                      )}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">
                      Buyer Evidence:
                    </span>{" "}
                    {(d.buyerEvidence ?? []).length} items
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Supplier Evidence:
                    </span>{" "}
                    {(d.supplierEvidence ?? []).length} items
                  </div>
                </div>

                {d.resolutionNotes && (
                  <div className="rounded bg-muted p-3 text-sm">
                    <span className="font-medium">Resolution Notes:</span>{" "}
                    {d.resolutionNotes}
                  </div>
                )}

                {/* Admin actions */}
                {user?.role === "ADMIN" && d.status !== "RESOLVED" && (
                  <div className="flex gap-2 pt-2">
                    {d.status !== "UNDER_REVIEW" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewMutation.mutate(d.id)}
                        disabled={reviewMutation.isPending}
                      >
                        Mark Under Review
                      </Button>
                    )}

                    <Dialog
                      open={resolveDialogId === d.id}
                      onOpenChange={(open) =>
                        setResolveDialogId(open ? d.id : null)
                      }
                    >
                      <DialogTrigger asChild>
                        <Button size="sm">Resolve Dispute</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Resolve Dispute</DialogTitle>
                          <DialogDescription>
                            Choose an outcome for this dispute. PO:{" "}
                            {d.purchaseOrder?.referenceNumber}
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
                              onChange={(e) =>
                                setResolveOutcome(e.target.value)
                              }
                            >
                              <option value="FULL_REFUND">
                                Full Refund to Buyer
                              </option>
                              <option value="PARTIAL_REFUND">
                                Partial Refund
                              </option>
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
                                onChange={(e) =>
                                  setRefundAmount(e.target.value)
                                }
                                placeholder="e.g. 50000 for £500.00"
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
                              onChange={(e) =>
                                setResolutionNotes(e.target.value)
                              }
                              placeholder="Explain the resolution decision…"
                            />
                          </div>

                          <Button
                            className="w-full"
                            onClick={() =>
                              resolveMutation.mutate({
                                id: d.id,
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
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
