"use client";

import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n";
import { usePasskey } from "@/lib/use-passkey";
import { onboardingApi, type OnboardingStatus } from "@/lib/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowRight,
  Shield,
  Building2,
  CreditCard,
  BadgeCheck,
  Fingerprint,
  Loader2,
  KeyRound,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";

const STATUS_I18N_KEY: Record<string, string> = {
  NOT_STARTED: "onboarding.statusNotStarted",
  IN_PROGRESS: "onboarding.statusInProgress",
  KYB_PENDING: "onboarding.statusKybPending",
  KYB_VERIFIED: "onboarding.statusKybVerified",
  KYB_FAILED: "onboarding.statusKybFailed",
  COMPLETED: "onboarding.statusCompleted",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  NOT_STARTED: "outline",
  IN_PROGRESS: "secondary",
  KYB_PENDING: "secondary",
  KYB_VERIFIED: "default",
  KYB_FAILED: "destructive",
  COMPLETED: "default",
};

function StepIcon({ complete }: { complete: boolean }) {
  return complete ? (
    <CheckCircle2 className="h-5 w-5 text-green-600" />
  ) : (
    <Circle className="h-5 w-5 text-muted-foreground" />
  );
}

// ── Identity Verification (Step 0 — shared by all roles) ──

function IdentityVerificationStep({ status }: { status: OnboardingStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [nationalId, setNationalId] = useState("");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [randomCode, setRandomCode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nationalIdRef = useRef("");

  const identityDone = status.steps?.identity?.complete;
  const verifiedName = status.steps?.identity?.verifiedName as string | null;

  const initiateMutation = useMutation({
    mutationFn: () => onboardingApi.initiateIdentity({ nationalId }),
    onSuccess: (res) => {
      const d = res.data;
      if (d.verified) {
        // Already verified (shouldn't happen on initiate, but just in case)
        queryClient.invalidateQueries({ queryKey: ["onboarding"] });
        setPolling(false);
        return;
      }
      if (d.transactionId) {
        setTransactionId(d.transactionId);
        nationalIdRef.current = nationalId;
        setRandomCode(d.random ?? null);
        setPolling(true);
        setError(null);
      }
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || "Identity verification failed");
    },
  });

  const pollStatus = useCallback(async () => {
    if (!transactionId) return;
    try {
      const res = await onboardingApi.checkIdentityStatus(
        transactionId,
        nationalIdRef.current,
      );
      if (res.data.verified) {
        setPolling(false);
        queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      } else if (
        res.data.errorMessage &&
        !res.data.errorMessage.includes("WAITING")
      ) {
        setPolling(false);
        setError(res.data.errorMessage || "Verification rejected");
      }
      // PENDING — keep polling
    } catch {
      // network error, keep polling
    }
  }, [transactionId, queryClient]);

  useEffect(() => {
    if (polling && transactionId) {
      pollRef.current = setInterval(pollStatus, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [polling, transactionId, pollStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (identityDone) {
    return (
      <Card className="border-green-200">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">
              {t("onboarding.step0TitleComplete")}
            </CardTitle>
          </div>
          <CardDescription>
            {verifiedName
              ? `Verified as ${verifiedName}`
              : "Your identity has been verified"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <StepIcon complete={false} />
          <CardTitle className="text-base">
            {t("onboarding.step0Title")}
          </CardTitle>
        </div>
        <CardDescription>{t("onboarding.identityDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!polling ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="nationalId">{t("onboarding.nationalId")}</Label>
              <Input
                id="nationalId"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="e.g. 1234567890"
                maxLength={10}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setError(null);
                  initiateMutation.mutate();
                }}
                disabled={
                  nationalId.length !== 10 || initiateMutation.isPending
                }
                size="sm"
              >
                {initiateMutation.isPending
                  ? t("onboarding.startingVerification")
                  : t("onboarding.startVerification")}
                <Fingerprint className="ml-2 h-4 w-4" />
              </Button>
              {nationalId.length > 0 && nationalId.length < 10 && (
                <span className="text-xs text-muted-foreground">
                  {10 - nationalId.length} digits remaining
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {randomCode && (
              <div className="rounded-md border bg-muted p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("onboarding.nafathPrompt")}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-wide">
                  {randomCode}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("onboarding.waitingForVerification")}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Passkey Registration (Step 0.5 — shared by all roles) ──

function PasskeyRegistrationStep({
  status,
  identityDone,
}: {
  status: OnboardingStatus;
  identityDone: boolean;
}) {
  const { t } = useTranslation();
  const { hasPasskey, statusLoading, registering, register } = usePasskey();
  const passkeyDone = status.steps?.passkey?.complete || hasPasskey;

  if (passkeyDone) {
    return (
      <Card className="border-green-200">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">
              {t("onboarding.step1TitleComplete")}
            </CardTitle>
          </div>
          <CardDescription>{t("onboarding.passkeyActive")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={!identityDone ? "opacity-50 pointer-events-none" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <StepIcon complete={false} />
          <CardTitle className="text-base">
            {t("onboarding.step1Title")}
          </CardTitle>
        </div>
        <CardDescription>
          Register a passkey to cryptographically sign all your platform actions
          using biometrics (Face ID, Touch ID, or PIN). This provides
          non-repudiation in the evidence pack.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
          <p>
            <strong>{t("onboarding.whyRequired")}</strong>
          </p>
          <p>{t("onboarding.whyRequiredExplanation")}</p>
        </div>
        <Button
          onClick={() => register()}
          disabled={registering || statusLoading}
          size="sm"
        >
          {registering
            ? t("onboarding.registeringPasskey")
            : t("onboarding.registerPasskey")}
          <KeyRound className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Buyer Onboarding ──

function BuyerOnboarding({
  status,
  onComplete,
}: {
  status: OnboardingStatus;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [regNo, setRegNo] = useState(status.registrationNo || "");
  const [signatory, setSignatory] = useState(status.authorizedSignatory || "");
  const [iban, setIban] = useState(status.bankIban || "");

  const kybMutation = useMutation({
    mutationFn: () =>
      onboardingApi.buyerKyb({
        registrationNo: regNo,
        authorizedSignatory: signatory,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const paymentMutation = useMutation({
    mutationFn: () => onboardingApi.buyerPayment({ bankIban: iban }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const completeMutation = useMutation({
    mutationFn: () => onboardingApi.buyerComplete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      onComplete();
    },
  });

  const kybDone = status.steps?.kyb?.complete;
  const paymentDone = status.steps?.paymentMethod?.complete;
  const identityDone = status.steps?.identity?.complete;
  const passkeyDone = status.steps?.passkey?.complete;
  const preReqsDone = identityDone && passkeyDone;

  return (
    <div className="space-y-4">
      {/* Step 0: Identity */}
      <IdentityVerificationStep status={status} />

      {/* Step 1: Passkey */}
      <PasskeyRegistrationStep status={status} identityDone={!!identityDone} />

      {/* Step 2: KYB-lite */}
      <Card className={!preReqsDone ? "opacity-50 pointer-events-none" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon complete={!!kybDone} />
            <CardTitle className="text-base">
              {t("onboarding.step2Title")}
            </CardTitle>
          </div>
          <CardDescription>
            Submit your commercial registration number and authorized signatory
          </CardDescription>
        </CardHeader>
        {!kybDone && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="regNo">Registration Number (CR)</Label>
              <Input
                id="regNo"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                placeholder="e.g. 1010123456"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="signatory">Authorized Signatory</Label>
              <Input
                id="signatory"
                value={signatory}
                onChange={(e) => setSignatory(e.target.value)}
                placeholder="Full name of authorized person"
              />
            </div>
            {kybMutation.isError && (
              <p className="text-sm text-destructive">
                KYB verification failed. Please check your details.
              </p>
            )}
            <Button
              onClick={() => kybMutation.mutate()}
              disabled={!regNo || !signatory || kybMutation.isPending}
              size="sm"
            >
              {kybMutation.isPending
                ? t("onboarding.verifyingBusiness")
                : t("onboarding.verifyBusiness")}
              <Shield className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Step 3: Payment Method */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon complete={!!paymentDone} />
            <CardTitle className="text-base">
              {t("onboarding.step3Title")}
            </CardTitle>
          </div>
          <CardDescription>Link your bank IBAN for settlements</CardDescription>
        </CardHeader>
        {!paymentDone && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="iban">Bank IBAN</Label>
              <Input
                id="iban"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="e.g. SA0380000000608010167519"
              />
            </div>
            <Button
              onClick={() => paymentMutation.mutate()}
              disabled={!iban || paymentMutation.isPending}
              size="sm"
            >
              {paymentMutation.isPending
                ? t("onboarding.connectingBank")
                : t("onboarding.connectBank")}
              <CreditCard className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Complete Button */}
      {kybDone && paymentDone && status.onboardingStatus !== "COMPLETED" && (
        <Button
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
          className="w-full"
        >
          {completeMutation.isPending
            ? t("onboarding.completingOnboarding")
            : t("onboarding.completeOnboarding")}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// ── Supplier Onboarding ──

function SupplierOnboarding({ status }: { status: OnboardingStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [regNo, setRegNo] = useState(status.registrationNo || "");
  const [iban, setIban] = useState(status.bankIban || "");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const tier1Mutation = useMutation({
    mutationFn: () =>
      onboardingApi.supplierTier1({
        registrationNo: regNo,
        bankIban: iban,
        termsAccepted,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const tier2Mutation = useMutation({
    mutationFn: () =>
      onboardingApi.supplierTier2({ uboDisclosure: { acknowledged: true } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const tier1Done = status.steps?.tier1?.complete;
  const tier2Done = status.steps?.tier2?.complete;
  const identityDone = status.steps?.identity?.complete;
  const passkeyDone = status.steps?.passkey?.complete;
  const preReqsDone = identityDone && passkeyDone;

  return (
    <div className="space-y-4">
      {/* Step 0: Identity */}
      <IdentityVerificationStep status={status} />

      {/* Step 1: Passkey */}
      <PasskeyRegistrationStep status={status} identityDone={!!identityDone} />

      {/* Tier 1 */}
      <Card className={!preReqsDone ? "opacity-50 pointer-events-none" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon complete={!!tier1Done} />
            <CardTitle className="text-base">
              {t("onboarding.tier1Title")}
            </CardTitle>
            {tier1Done && (
              <Badge variant="default" className="ml-auto">
                {t("onboarding.tier1Badge")}
              </Badge>
            )}
          </div>
          <CardDescription>
            CR number + bank IBAN + platform terms → can receive POs
          </CardDescription>
        </CardHeader>
        {!tier1Done && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="supRegNo">Registration Number (CR)</Label>
              <Input
                id="supRegNo"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                placeholder="e.g. 1010654321"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="supIban">Bank IBAN</Label>
              <Input
                id="supIban"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="e.g. SA0380000000608010167520"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="terms"
                checked={termsAccepted}
                onCheckedChange={(v: boolean | "indeterminate") =>
                  setTermsAccepted(!!v)
                }
              />
              <Label htmlFor="terms" className="text-sm">
                {t("onboarding.acceptTerms")}
              </Label>
            </div>
            {tier1Mutation.isError && (
              <p className="text-sm text-destructive">
                Onboarding failed. Please check your details.
              </p>
            )}
            <Button
              onClick={() => tier1Mutation.mutate()}
              disabled={
                !regNo || !iban || !termsAccepted || tier1Mutation.isPending
              }
              size="sm"
            >
              {tier1Mutation.isPending
                ? t("onboarding.submittingTier1")
                : t("onboarding.completeTier1")}
              <Building2 className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Tier 2 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon complete={!!tier2Done} />
            <CardTitle className="text-base">
              {t("onboarding.tier2Title")}
            </CardTitle>
            {tier2Done && (
              <Badge variant="default" className="ml-auto">
                {t("onboarding.tier2Badge")}
              </Badge>
            )}
          </div>
          <CardDescription>
            KYB verification + sanctions check + UBO → can request early payment
          </CardDescription>
        </CardHeader>
        {tier1Done && !tier2Done && (
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upgrading to Tier 2 will run KYB verification and sanctions
              screening on your business. This enables early payment access.
            </p>
            {tier2Mutation.isError && (
              <p className="text-sm text-destructive">
                Tier 2 upgrade failed. Verification may have been unsuccessful.
              </p>
            )}
            <Button
              onClick={() => tier2Mutation.mutate()}
              disabled={tier2Mutation.isPending}
              size="sm"
            >
              {tier2Mutation.isPending
                ? t("onboarding.verifyingBusiness")
                : t("onboarding.upgradeToTier2")}
              <BadgeCheck className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── LP Onboarding ──

function LPOnboarding({ status }: { status: OnboardingStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [fundingAccount, setFundingAccount] = useState(
    status.fundingAccountRef || "",
  );
  const [fundingLimit, setFundingLimit] = useState(
    status.fundingLimitTotal ? String(status.fundingLimitTotal / 100) : "",
  );
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  const profileMutation = useMutation({
    mutationFn: () =>
      onboardingApi.lpProfile({
        fundingAccountRef: fundingAccount,
        fundingLimitTotal: Math.round(Number(fundingLimit) * 100),
        participationAgreementAccepted: agreementAccepted,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const profileDone = status.steps?.profile?.complete;
  const identityDone = status.steps?.identity?.complete;
  const passkeyDone = status.steps?.passkey?.complete;
  const preReqsDone = identityDone && passkeyDone;

  return (
    <div className="space-y-4">
      {/* Step 0: Identity */}
      <IdentityVerificationStep status={status} />

      {/* Step 1: Passkey */}
      <PasskeyRegistrationStep status={status} identityDone={!!identityDone} />

      <Card className={!preReqsDone ? "opacity-50 pointer-events-none" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon complete={!!profileDone} />
            <CardTitle className="text-base">
              {t("onboarding.fundingProfileSetup")}
            </CardTitle>
          </div>
          <CardDescription>
            Configure funding account, limits, and accept participation
            agreement
          </CardDescription>
        </CardHeader>
        {!profileDone && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="fundAccount">Funding Account IBAN</Label>
              <Input
                id="fundAccount"
                value={fundingAccount}
                onChange={(e) => setFundingAccount(e.target.value)}
                placeholder="e.g. SA0380000000608010167521"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fundLimit">
                Total Funding Limit (
                {status.jurisdiction === "KSA" ? "SAR" : "GBP"})
              </Label>
              <Input
                id="fundLimit"
                type="number"
                value={fundingLimit}
                onChange={(e) => setFundingLimit(e.target.value)}
                placeholder="e.g. 5000000"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="agreement"
                checked={agreementAccepted}
                onCheckedChange={(v: boolean | "indeterminate") =>
                  setAgreementAccepted(!!v)
                }
              />
              <Label htmlFor="agreement" className="text-sm">
                {t("onboarding.acceptParticipation")}
              </Label>
            </div>
            {profileMutation.isError && (
              <p className="text-sm text-destructive">
                Profile setup failed. Please check your details.
              </p>
            )}
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={
                !fundingAccount ||
                !fundingLimit ||
                !agreementAccepted ||
                profileMutation.isPending
              }
              size="sm"
            >
              {profileMutation.isPending
                ? t("onboarding.settingUp")
                : t("onboarding.completeSetup")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── Main Onboarding Page ──

export default function OnboardingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => onboardingApi.status().then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground">Loading onboarding status…</div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-4 w-4" />
        Failed to load onboarding status
      </div>
    );
  }

  const isComplete = status.onboardingStatus === "COMPLETED";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.title")}
          </h2>
          <p className="text-muted-foreground">{t("onboarding.subtitle")}</p>
        </div>
        <Badge variant={STATUS_VARIANT[status.onboardingStatus] || "outline"}>
          {t(
            STATUS_I18N_KEY[status.onboardingStatus] ?? status.onboardingStatus,
          )}
        </Badge>
      </div>

      {isComplete && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                {t("onboarding.complete")}
              </p>
              <p className="text-sm text-green-700 dark:text-green-300">
                {t("onboarding.completeDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status.type === "BUYER" && (
        <BuyerOnboarding
          status={status}
          onComplete={() =>
            queryClient.invalidateQueries({ queryKey: ["onboarding"] })
          }
        />
      )}

      {status.type === "SUPPLIER" && <SupplierOnboarding status={status} />}

      {status.type === "LIQUIDITY_PARTNER" && <LPOnboarding status={status} />}
    </div>
  );
}
