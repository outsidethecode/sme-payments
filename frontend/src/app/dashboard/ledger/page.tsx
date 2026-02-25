"use client";

import { useQuery } from "@tanstack/react-query";
import { ledgerApi } from "@/lib/api";
import { formatDateTime, statusLabel } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, ShieldCheck } from "lucide-react";

export default function LedgerPage() {
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
            and is immediately detectable.
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
              {events.map((event, i) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {statusLabel(event.eventType)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {event.entityType} · {formatDateTime(event.createdAt)}
                      </p>
                    </div>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
