"use client";

import { usePasskey } from "@/lib/use-passkey";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Fingerprint, X } from "lucide-react";
import { useState } from "react";

/**
 * Banner prompting the user to register a passkey for cryptographic signing.
 * Shown in the dashboard layout after login if the user has no passkey.
 * Can be dismissed for the current session.
 */
export function PasskeyBanner() {
  const { hasPasskey, statusLoading, registering, register } = usePasskey();
  const [dismissed, setDismissed] = useState(false);

  // Don't show while loading, if user already has a passkey, or if dismissed
  if (statusLoading || hasPasskey || dismissed) return null;

  return (
    <Alert className="relative mb-4 border-primary/30 bg-primary/5">
      <Fingerprint className="h-4 w-4" />
      <AlertTitle className="font-semibold">Enable passkey signing</AlertTitle>
      <AlertDescription className="mt-1 text-sm">
        Register a passkey to cryptographically sign your actions with
        biometrics (Face ID, Touch ID, or PIN). This provides non-repudiation
        for all ledger events.
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={() => register()} disabled={registering}>
            <Fingerprint className="mr-2 h-3 w-3" />
            {registering ? "Registering…" : "Register Passkey"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Maybe later
          </Button>
        </div>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-6 w-6"
        onClick={() => setDismissed(true)}
      >
        <X className="h-3 w-3" />
      </Button>
    </Alert>
  );
}
