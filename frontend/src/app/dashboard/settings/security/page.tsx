"use client";

import { usePasskey } from "@/lib/use-passkey";
import { passkeysApi } from "@/lib/api";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Fingerprint,
  Plus,
  Pencil,
  Trash2,
  Monitor,
  Smartphone,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "@/i18n";

// ── Types ──

interface Passkey {
  id: string;
  credentialId: string;
  deviceType: string | null;
  deviceName: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

// ── Helpers ──

function DeviceIcon({ deviceType }: { deviceType: string | null }) {
  if (deviceType === "singleDevice") {
    return <Smartphone className="h-5 w-5 text-muted-foreground" />;
  }
  return <Monitor className="h-5 w-5 text-muted-foreground" />;
}

function timeAgo(date: string | null, neverText = "Never") {
  if (!date) return neverText;
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

// ── Passkey Card ──

function PasskeyCard({
  passkey,
  isOnly,
}: {
  passkey: Passkey;
  isOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.deviceName || "");

  const renameMutation = useMutation({
    mutationFn: (deviceName: string) =>
      passkeysApi.rename(passkey.id, deviceName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      setEditing(false);
      toast.success(t("security.passkeyRenamed"));
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.message || t("security.renameFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => passkeysApi.delete(passkey.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      queryClient.invalidateQueries({ queryKey: ["passkey-status"] });
      toast.success(t("security.passkeyDeleted"));
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.message || t("security.deleteFailed")),
  });

  const displayName =
    passkey.deviceName ||
    (passkey.deviceType === "singleDevice"
      ? t("security.singleDevice")
      : t("security.syncedPasskey"));

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <DeviceIcon deviceType={passkey.deviceType} />
        <div className="flex-1 min-w-0">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) renameMutation.mutate(name.trim());
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("security.deviceNameShortPlaceholder")}
                className="h-8 text-sm"
                autoFocus
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!name.trim() || renameMutation.isPending}
              >
                {t("common.save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setName(passkey.deviceName || "");
                }}
              >
                {t("common.cancel")}
              </Button>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{displayName}</span>
                {passkey.backedUp && (
                  <Badge variant="secondary" className="text-xs">
                    {t("security.syncedBadge")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("security.createdTimeAgo", {
                    timeAgo: timeAgo(passkey.createdAt, t("security.never")),
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t("security.usedTimeAgo", {
                    timeAgo: timeAgo(passkey.lastUsedAt, t("security.never")),
                  })}
                </span>
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setEditing(true)}
              title={t("security.rename")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={isOnly}
                  title={
                    isOnly
                      ? t("security.cannotDeleteOnly")
                      : t("security.deletePasskeyTooltip")
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("security.deletePasskeyTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("security.deletePasskeyDescription", {
                      name: displayName,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteMutation.isPending
                      ? t("security.deleting")
                      : t("security.delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const { register, registering } = usePasskey();
  const { t } = useTranslation();
  const [deviceName, setDeviceName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const {
    data: passkeys,
    isLoading,
    error,
  } = useQuery<Passkey[]>({
    queryKey: ["passkeys"],
    queryFn: () => passkeysApi.list().then((r) => r.data),
  });

  const handleRegister = async () => {
    try {
      await register(deviceName.trim() || undefined);
      setDeviceName("");
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    } catch {
      // Error already handled by register()
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {t("security.title")}
        </h2>
        <p className="text-muted-foreground">{t("security.subtitle")}</p>
      </div>

      {/* Info card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm space-y-1">
            <p className="font-medium">{t("security.multiDeviceSupport")}</p>
            <p className="text-muted-foreground">
              {t("security.multiDeviceDescription")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Passkey list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {t("security.registeredPasskeys")}
            {passkeys && (
              <Badge variant="secondary" className="ml-2">
                {passkeys.length}
              </Badge>
            )}
          </h3>
          {!showAddForm && (
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("security.addDevice")}
            </Button>
          )}
        </div>

        {/* Add new passkey form */}
        {showAddForm && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Fingerprint className="h-4 w-4" />
                {t("security.registerNewPasskey")}
              </CardTitle>
              <CardDescription>{t("security.biometricPrompt")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t("security.deviceNamePlaceholder")}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleRegister}
                  disabled={registering}
                  size="sm"
                >
                  <Fingerprint className="mr-2 h-4 w-4" />
                  {registering
                    ? t("security.registering")
                    : t("security.registerPasskey")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setDeviceName("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading / error states */}
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            {t("security.loadingPasskeys")}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {t("security.failedToLoadPasskeys")}
          </p>
        )}

        {/* Passkey cards */}
        {passkeys?.map((pk) => (
          <PasskeyCard key={pk.id} passkey={pk} isOnly={passkeys.length <= 1} />
        ))}

        {passkeys && passkeys.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <Fingerprint className="mx-auto h-8 w-8 mb-2 opacity-40" />
              <p>{t("security.noPasskeysRegistered")}</p>
              <p className="text-sm">{t("security.noPasskeysHint")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
