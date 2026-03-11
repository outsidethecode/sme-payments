"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { passkeysApi, ledgerApi } from "@/lib/api";
import { toast } from "sonner";

/**
 * Hook for passkey registration, status checking, and action signing.
 *
 * Usage:
 *   const { hasPasskey, register, signAction } = usePasskey();
 *
 *   // Register a new passkey (triggers biometric prompt)
 *   await register();
 *
 *   // Sign a PO action with passkey
 *   await signAction("PO_SENT", poId);
 */
export function usePasskey() {
  const queryClient = useQueryClient();
  const [registering, setRegistering] = useState(false);
  const [signing, setSigning] = useState(false);

  // Check if user has a passkey registered
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ["passkey-status"],
    queryFn: () => passkeysApi.status().then((r) => r.data),
    staleTime: 60_000,
  });

  const hasPasskey = statusData?.hasPasskey ?? false;

  /**
   * Register a new passkey. Triggers browser WebAuthn dialog (biometric/PIN).
   */
  const register = useCallback(async () => {
    setRegistering(true);
    try {
      // 1. Get registration options from server
      const { data: options } = await passkeysApi.registerOptions();

      // 2. Trigger browser passkey creation (biometric prompt)
      const attestation = await startRegistration(options);

      // 3. Send attestation to server for verification
      const { data: result } = await passkeysApi.registerVerify(attestation);

      if (result.verified) {
        toast.success(
          "Passkey registered! Your actions are now cryptographically signed.",
        );
        queryClient.invalidateQueries({ queryKey: ["passkey-status"] });
      }

      return result;
    } catch (err: any) {
      // User cancelled the dialog
      if (err.name === "NotAllowedError") {
        toast.error("Passkey registration was cancelled");
      } else {
        toast.error(
          err.response?.data?.message ||
            err.message ||
            "Passkey registration failed",
        );
      }
      throw err;
    } finally {
      setRegistering(false);
    }
  }, [queryClient]);

  /**
   * Sign a ledger action with a passkey. Two-step flow:
   * 1. Request challenge from server
   * 2. Browser triggers biometric prompt, returns signed assertion
   *
   * Returns the assertion data to be passed along with the action API call.
   */
  const signAction = useCallback(
    async (
      eventType: string,
      entityId: string,
    ): Promise<{
      purpose: string;
      assertion: any;
      intentHash: string;
    } | null> => {
      // If no passkey, skip signing (backend will use SYSTEM)
      if (!hasPasskey) {
        return null;
      }

      setSigning(true);
      try {
        // 1. Request signing challenge (challenge = SHA-256 of business intent)
        const { data: challengeData } = await ledgerApi.challenge(
          entityId,
          eventType,
        );

        // 2. Trigger browser assertion (biometric prompt)
        const assertion = await startAuthentication(challengeData.options);

        return {
          purpose: challengeData.purpose,
          intentHash: challengeData.intentHash,
          assertion,
        };
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          // User explicitly cancelled — abort the action entirely
          const cancelled = new Error("Signing cancelled by user");
          cancelled.name = "SigningCancelled";
          throw cancelled;
        }
        console.error("Passkey signing error:", err);
        // Technical failure — fall back to unsigned so the action isn't blocked
        toast.error("Passkey signing failed — action will proceed unsigned");
        return null;
      } finally {
        setSigning(false);
      }
    },
    [hasPasskey],
  );

  return {
    hasPasskey,
    statusLoading,
    registering,
    signing,
    register,
    signAction,
  };
}
