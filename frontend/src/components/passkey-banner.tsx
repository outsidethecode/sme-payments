"use client";

import { usePasskey } from "@/lib/use-passkey";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Fingerprint, X } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

/**
 * Banner prompting the user to register a passkey.
 *
 * - If user has NO passkey at all → strong prompt (onboarding should catch this,
 *   but belt-and-suspenders).
 * - If user HAS a passkey → don't show anything (they can manage extras from /security).
 */
export function PasskeyBanner() {
  const { hasPasskey, statusLoading } = usePasskey();
  const [dismissed, setDismissed] = useState(false);

  // Don't show while loading, if user already has a passkey, or if dismissed
  if (statusLoading || hasPasskey || dismissed) return null;

  return (
    <Alert className="relative mb-4 border-destructive/30 bg-destructive/5">
      <Fingerprint className="h-4 w-4" />
      <AlertTitle className="font-semibold">Passkey required</AlertTitle>
      <AlertDescription className="mt-1 text-sm">
        You must register a passkey to use this platform. All actions require a
        cryptographic signature from your device biometrics.
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" asChild>
            <Link href="/dashboard/onboarding">
              <Fingerprint className="mr-2 h-3 w-3" />
              Go to Onboarding
            </Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            <X className="mr-1 h-3 w-3" /> Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
