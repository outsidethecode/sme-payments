"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ledgerApi, type EventLogEntry } from "@/lib/api";
import { formatCurrency, formatDateTime, statusLabel } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  ShieldCheck,
  Fingerprint,
  ChevronRight,
  Banknote,
  ArrowRightLeft,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

/* ── Helpers ───────────────────────────────────────────────── */

/** Keys in event payload that represent minor units → format as currency */
const CURRENCY_KEYS = new Set([
  "amount",
  "faceValue",
  "serviceFee",
  "netAdvance",
  "totalAmount",
  "feeAmount",
  "recipientReceives",
]);

function formatPayloadValue(
  key: string,
  value: unknown,
  currencyHint?: string,
): string {
  if (CURRENCY_KEYS.has(key) && typeof value === "number") {
    return formatCurrency(value, (currencyHint as "GBP" | "SAR") ?? "GBP");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (
    value instanceof Date ||
    (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
  ) {
    return formatDateTime(value as string);
  }
  return String(value);
}

function payloadLabel(key: string): string {
  const labels: Record<string, string> = {
    amount: "Amount",
    faceValue: "Face Value",
    serviceFee: "Platform Fee",
    netAdvance: "Net Advance",
    totalAmount: "Total Amount",
    feeAmount: "Platform Fee",
    recipientReceives: "Recipient Receives",
    earlyPaySettlement: "Early Pay Settlement",
    recipientId: "Recipient ID",
    purchaseOrderId: "Purchase Order ID",
    reference: "Reference",
    supplierId: "Supplier ID",
    buyerId: "Buyer ID",
    lineItemCount: "Line Items",
    openBankingRef: "Open Banking Ref",
    verifiedAt: "Verified At",
  };
  return (
    labels[key] ||
    key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())
  );
}

/* ── Event Detail Dialog ───────────────────────────────────── */

function EventDetailDialog({
  event,
  open,
  onOpenChange,
}: {
  event: EventLogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!event) return null;

  const payload = event.payload || {};
  const payloadEntries = Object.entries(payload).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  const hasCurrencyFields = payloadEntries.some(([k]) => CURRENCY_KEYS.has(k));
  const isSigned = event.actorSignature && event.actorSignature !== "SYSTEM";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {statusLabel(event.eventType)}
            {isSigned ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Fingerprint className="h-3 w-3" />
                Passkey Signed
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                System
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* ── Summary Row ─────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Entity Type</span>
              <p className="font-medium">{statusLabel(event.entityType)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Timestamp</span>
              <p className="font-medium">{formatDateTime(event.createdAt)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Actor Role</span>
              <p className="font-medium">{statusLabel(event.actorRole)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Sequence</span>
              <p className="font-medium">
                #{event.sequence} (entity #{event.entitySequence})
              </p>
            </div>
          </div>

          {/* ── Financial Details ────────────────────────── */}
          {hasCurrencyFields && (
            <>
              <Separator />
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  <Banknote className="h-3.5 w-3.5" />
                  Financial Details
                </h4>
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                  {payloadEntries
                    .filter(([k]) => CURRENCY_KEYS.has(k))
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between"
                      >
                        <span className="text-muted-foreground text-xs">
                          {payloadLabel(key)}
                        </span>
                        <span className="font-mono font-semibold text-sm">
                          {formatPayloadValue(
                            key,
                            value,
                            (payload as Record<string, unknown>)
                              .currency as string,
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}

          {/* ── Other Payload Fields ─────────────────────── */}
          {payloadEntries.filter(([k]) => !CURRENCY_KEYS.has(k)).length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Event Data
                </h4>
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                  {payloadEntries
                    .filter(([k]) => !CURRENCY_KEYS.has(k))
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {payloadLabel(key)}
                        </span>
                        <span className="font-mono text-xs text-right truncate max-w-[250px]">
                          {formatPayloadValue(
                            key,
                            value,
                            (payload as Record<string, unknown>)
                              .currency as string,
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}

          {/* ── Hash Chain ────────────────────────────────── */}
          <Separator />
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Hash Chain
            </h4>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
              <div>
                <span className="text-muted-foreground text-xs">
                  Event Hash
                </span>
                <p className="font-mono text-[11px] break-all">
                  {event.eventHash}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">
                  Previous Hash
                </span>
                <p className="font-mono text-[11px] break-all">
                  {event.previousHash || "GENESIS"}
                </p>
              </div>
            </div>
          </div>

          {/* ── Signature Details (if signed) ────────────── */}
          {isSigned && (
            <>
              <Separator />
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  <Fingerprint className="h-3.5 w-3.5" />
                  Passkey Signature
                </h4>
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-[11px]">
                  <div>
                    <span className="text-muted-foreground text-xs">
                      Signature
                    </span>
                    <p className="font-mono break-all">
                      {event.actorSignature.slice(0, 64)}…
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">
                      Public Key
                    </span>
                    <p className="font-mono break-all">
                      {event.actorPublicKey.slice(0, 64)}…
                    </p>
                  </div>
                  {event.credentialId && (
                    <div>
                      <span className="text-muted-foreground text-xs">
                        Credential ID
                      </span>
                      <p className="font-mono break-all">
                        {event.credentialId}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ─────────────────────────────────────────────── */

export default function LedgerPage() {
  const [selected, setSelected] = useState<EventLogEntry | null>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ["ledger"],
    queryFn: () => ledgerApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Immutable, cryptographically linked audit trail of all platform events
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Hash-Chained Events
          </CardTitle>
          <CardDescription>
            Every event is hashed with SHA-256 and linked to the previous event,
            creating a tamper-evident chain. Any modification breaks the chain
            and is immediately detectable. Click any event to see full details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !events?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <BookOpen className="mx-auto mb-2 h-8 w-8" />
              <p>No events recorded yet</p>
              <p className="text-xs">
                Events will appear as purchase orders are created and processed
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event, i) => {
                const isSigned =
                  event.actorSignature && event.actorSignature !== "SYSTEM";
                const hasMoney = Object.keys(event.payload || {}).some((k) =>
                  CURRENCY_KEYS.has(k),
                );

                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelected(event)}
                    className="w-full rounded-md border p-3 text-sm text-left transition-colors hover:bg-muted/50 hover:border-primary/30 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">
                            {statusLabel(event.eventType)}
                          </p>
                          {isSigned ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1"
                            >
                              <Fingerprint className="h-3 w-3" />
                              Passkey Signed
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              System
                            </Badge>
                          )}
                          {hasMoney && (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1 text-emerald-600 border-emerald-200"
                            >
                              <Banknote className="h-3 w-3" />
                              Financial
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {statusLabel(event.entityType)} · {formatDateTime(event.createdAt)}{" "}
                          · {statusLabel(event.actorRole)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {event.eventHash.slice(0, 16)}…
                          </p>
                          {event.previousHash && (
                            <p className="font-mono text-[10px] text-muted-foreground">
                              ← {event.previousHash.slice(0, 16)}…
                            </p>
                          )}
                          {!event.previousHash && i === events.length - 1 && (
                            <p className="text-[10px] text-primary">Genesis</p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <EventDetailDialog
        event={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
