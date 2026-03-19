"use client";

import { useAuth } from "@/lib/auth-context";
import { approvalsApi, poApi, type ApprovalRequest } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ShieldCheck,
  ShieldX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";

const STATUS_BADGE: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "outline";
    label: string;
  }
> = {
  PENDING: { variant: "outline", label: "Pending" },
  APPROVED: { variant: "default", label: "Approved" },
  REJECTED: { variant: "destructive", label: "Rejected" },
  EXPIRED: { variant: "secondary", label: "Expired" },
  ESCALATED: { variant: "secondary", label: "Escalated" },
};

export default function ApprovalsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] =
    useState<ApprovalRequest | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [comment, setComment] = useState("");

  const { data: pendingRequests = [], isLoading } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => approvalsApi.pending().then((r) => r.data),
  });

  // Fetch PO details for each approval request
  const poIds = pendingRequests
    .filter((r) => r.entityType === "PURCHASE_ORDER")
    .map((r) => r.entityId);

  const { data: poDetails = {} } = useQuery({
    queryKey: ["approval-pos", poIds],
    queryFn: async () => {
      const entries: Record<
        string,
        {
          reference: string;
          totalAmountPennies: number;
          currency?: string;
          description: string | null;
          buyer?: { companyName: string };
          supplier?: { companyName: string };
        }
      > = {};
      for (const id of poIds) {
        try {
          const po = (await poApi.get(id)).data;
          entries[id] = po;
        } catch {
          /* skip */
        }
      }
      return entries;
    },
    enabled: poIds.length > 0,
  });

  const decideMutation = useMutation({
    mutationFn: (params: {
      id: string;
      decision: "APPROVE" | "REJECT";
      comment?: string;
    }) => approvalsApi.decide(params.id, params.decision, params.comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setSelectedRequest(null);
      setDecision(null);
      setComment("");
    },
  });

  const userCurrency: "GBP" | "SAR" =
    (user?.currency as "GBP" | "SAR") || "GBP";

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground">
          Review and approve pending purchase orders for your organisation.
        </p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading approvals…</div>
      ) : pendingRequests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No pending approvals</p>
            <p className="text-sm text-muted-foreground/70">
              All caught up! Approval requests will appear here when POs exceed
              your organisation&apos;s auto-approve threshold.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pendingRequests.map((req) => {
            const po = poDetails[req.entityId];
            const badge = STATUS_BADGE[req.status] || STATUS_BADGE.PENDING;

            return (
              <Card
                key={req.id}
                className="hover:border-primary/30 transition-colors"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-amber-500" />
                      <div>
                        <CardTitle className="text-lg">
                          {po ? po.reference : req.entityId.substring(0, 8)}
                        </CardTitle>
                        <CardDescription>
                          {req.entityType === "PURCHASE_ORDER"
                            ? "Purchase Order Approval"
                            : req.entityType}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {po && (
                      <>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Amount
                          </p>
                          <p className="font-semibold">
                            {formatCurrency(
                              po.totalAmountPennies,
                              (po.currency as "GBP" | "SAR") ?? userCurrency,
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Supplier
                          </p>
                          <p className="font-medium">
                            {po.supplier?.companyName || "—"}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground">Progress</p>
                      <p className="font-medium">
                        {req.currentApprovals} / {req.requiredApprovals}{" "}
                        approvals
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Required Roles
                      </p>
                      <div className="flex gap-1 flex-wrap">
                        {req.policyRule?.requiredRoles?.map((role) => (
                          <Badge
                            key={role}
                            variant="outline"
                            className="text-xs"
                          >
                            {role}
                          </Badge>
                        )) || <span className="text-muted-foreground">—</span>}
                      </div>
                    </div>
                  </div>

                  {/* Existing approvals */}
                  {req.approvals && req.approvals.length > 0 && (
                    <div className="mb-4 space-y-2">
                      <p className="text-sm font-medium">Decisions</p>
                      {req.approvals.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          {a.decision === "APPROVE" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium">{a.user.name}</span>
                          <span className="text-muted-foreground">
                            {a.decision.toLowerCase()}d
                          </span>
                          {a.comment && (
                            <span className="text-muted-foreground italic">
                              — &quot;{a.comment}&quot;
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(req.status === "PENDING" || req.status === "ESCALATED") && (
                    <div className="flex items-center gap-2">
                      {req.status === "ESCALATED" && (
                        <Badge variant="destructive" className="mr-2">
                          ⚡ Escalated
                        </Badge>
                      )}
                      {req.expiresAt && (
                        <span className="text-xs text-muted-foreground mr-2">
                          Expires {new Date(req.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => {
                          setSelectedRequest(req);
                          setDecision("APPROVE");
                          setComment("");
                        }}
                      >
                        <ShieldCheck className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setSelectedRequest(req);
                          setDecision("REJECT");
                          setComment("");
                        }}
                      >
                        <ShieldX className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Approval/Rejection confirmation dialog */}
      <Dialog
        open={!!selectedRequest && !!decision}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequest(null);
            setDecision(null);
            setComment("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decision === "APPROVE" ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              {decision === "APPROVE" ? "Approve" : "Reject"} Purchase Order
            </DialogTitle>
            <DialogDescription>
              {decision === "APPROVE"
                ? "This will record your approval. The PO will be sent to the supplier once all required approvals are met."
                : "This will reject the PO and block it from being sent to the supplier."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Comment (optional)</label>
              <Textarea
                placeholder={
                  decision === "APPROVE"
                    ? "Approved — looks good."
                    : "Reason for rejection…"
                }
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedRequest(null);
                setDecision(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={decision === "APPROVE" ? "default" : "destructive"}
              disabled={decideMutation.isPending}
              onClick={() => {
                if (selectedRequest && decision) {
                  decideMutation.mutate({
                    id: selectedRequest.id,
                    decision,
                    comment: comment || undefined,
                  });
                }
              }}
            >
              {decideMutation.isPending
                ? "Submitting…"
                : decision === "APPROVE"
                  ? "Confirm Approval"
                  : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
