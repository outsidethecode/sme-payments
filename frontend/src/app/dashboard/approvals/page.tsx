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
import { useTranslation } from "@/i18n";

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
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t("approvals.title")}
        </h1>
        <p className="text-muted-foreground">{t("approvals.subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">
          {t("approvals.loadingApprovals")}
        </div>
      ) : pendingRequests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {t("approvals.noPendingApprovals")}
            </p>
            <p className="text-sm text-muted-foreground/70">
              {t("approvals.noPendingDescription")}
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
                            ? t("approvals.purchaseOrderApproval")
                            : req.entityType}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={badge.variant}>
                      {t(
                        `approvals.status${req.status.charAt(0)}${req.status.slice(1).toLowerCase()}`,
                      )}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {po && (
                      <>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t("approvals.amount")}
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
                            {t("approvals.supplierLabel")}
                          </p>
                          <p className="font-medium">
                            {po.supplier?.companyName || "—"}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("approvals.progress")}
                      </p>
                      <p className="font-medium">
                        {req.currentApprovals} / {req.requiredApprovals}{" "}
                        approvals
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("approvals.requiredRoles")}
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
                      <p className="text-sm font-medium">
                        {t("approvals.decisions")}
                      </p>
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

                  {(req.status === "PENDING" || req.status === "ESCALATED") &&
                    (() => {
                      const requiredRoles = req.policyRule?.requiredRoles ?? [];
                      const canDecide =
                        requiredRoles.length === 0 ||
                        (user?.orgRole != null &&
                          requiredRoles.includes(user.orgRole));

                      // Check if the current user has already voted
                      const alreadyVoted = req.approvals?.some(
                        (a) => a.user.id === user?.id,
                      );

                      if (alreadyVoted) {
                        return (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                            <span>{t("approvals.alreadySubmitted")}</span>
                          </div>
                        );
                      }

                      if (!canDecide) {
                        return (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>{t("approvals.roleRestriction")}</span>
                          </div>
                        );
                      }

                      return (
                        <div className="flex items-center gap-2">
                          {req.status === "ESCALATED" && (
                            <Badge variant="destructive" className="mr-2">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              {t("approvals.statusEscalated")}
                            </Badge>
                          )}
                          {req.expiresAt && (
                            <span className="text-xs text-muted-foreground mr-2">
                              Expires{" "}
                              {new Date(req.expiresAt).toLocaleDateString()}
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
                            {t("approvals.approve")}
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
                            {t("approvals.reject")}
                          </Button>
                        </div>
                      );
                    })()}
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
              {decision === "APPROVE"
                ? t("approvals.approve")
                : t("approvals.reject")}{" "}
              Purchase Order
            </DialogTitle>
            <DialogDescription>
              {decision === "APPROVE"
                ? "This will record your approval. The PO will be sent to the supplier once all required approvals are met."
                : "This will reject the PO and block it from being sent to the supplier."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {t("approvals.commentOptional")}
              </label>
              <Textarea
                placeholder={
                  decision === "APPROVE"
                    ? t("approvals.approvePlaceholder")
                    : t("approvals.rejectPlaceholder")
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
                ? t("approvals.submitting")
                : decision === "APPROVE"
                  ? t("approvals.confirmApproval")
                  : t("approvals.confirmRejection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
