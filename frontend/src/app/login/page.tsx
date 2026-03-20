"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Building2, Package, Landmark, Settings, Globe } from "lucide-react";

const DEMO_ACCOUNTS = [
  // ── KSA Buyer Team – Al-Rajhi Trading Co ────────────────
  {
    email: "buyer@alrajhi.sa",
    label: "Ahmed Al-Rashid (Owner)",
    role: "BUYER",
    group: "buyer",
  },
  {
    email: "approver@alrajhi.sa",
    label: "Khalid Al-Harbi (Approver)",
    role: "BUYER",
    group: "buyer",
  },
  {
    email: "finance@alrajhi.sa",
    label: "Layla Al-Qahtani (Finance)",
    role: "BUYER",
    group: "buyer",
  },
  {
    email: "member@alrajhi.sa",
    label: "Omar Al-Dosari (Member)",
    role: "BUYER",
    group: "buyer",
  },
  {
    email: "viewer@alrajhi.sa",
    label: "Sara Al-Ghamdi (Viewer)",
    role: "BUYER",
    group: "buyer",
  },
  // ── KSA Supplier Team – Noor Supply Chain ───────────────
  {
    email: "supplier@noorsupply.sa",
    label: "Noor Al-Fahad (Owner)",
    role: "SUPPLIER",
    group: "supplier",
  },
  {
    email: "approver@noorsupply.sa",
    label: "Faisal Al-Otaibi (Approver)",
    role: "SUPPLIER",
    group: "supplier",
  },
  {
    email: "finance@noorsupply.sa",
    label: "Hana Al-Mutairi (Finance)",
    role: "SUPPLIER",
    group: "supplier",
  },
  {
    email: "member@noorsupply.sa",
    label: "Yusuf Al-Shammari (Member)",
    role: "SUPPLIER",
    group: "supplier",
  },
  {
    email: "viewer@noorsupply.sa",
    label: "Mona Al-Zahrani (Viewer)",
    role: "SUPPLIER",
    group: "supplier",
  },
  // ── KSA LP Team – Tamweel Capital ───────────────────────
  {
    email: "lp@tamweel.sa",
    label: "Tamweel Capital (Owner)",
    role: "LP",
    group: "lp",
  },
  {
    email: "approver@tamweel.sa",
    label: "Abdulaziz Al-Subaie (Approver)",
    role: "LP",
    group: "lp",
  },
  {
    email: "finance@tamweel.sa",
    label: "Reem Al-Anazi (Finance)",
    role: "LP",
    group: "lp",
  },
  {
    email: "member@tamweel.sa",
    label: "Tariq Al-Dossary (Member)",
    role: "LP",
    group: "lp",
  },
  {
    email: "viewer@tamweel.sa",
    label: "Nouf Al-Rajhi (Viewer)",
    role: "LP",
    group: "lp",
  },
  // ── Admin ───────────────────────────────────────────────
  {
    email: "admin@platform.co.uk",
    label: "Platform Admin (Admin)",
    role: "ADMIN",
    group: "admin",
  },
];

const GROUP_CONFIG: Record<
  string,
  { labelKey: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }
> = {
  buyer: { labelKey: "login.buyerTeam", Icon: Building2 },
  supplier: { labelKey: "login.supplierTeam", Icon: Package },
  lp: { labelKey: "login.lpTeam", Icon: Landmark },
  admin: { labelKey: "login.platform", Icon: Settings },
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t, locale, setLocale } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success(t("login.loginSuccess"));
      router.push("/dashboard");
    } catch {
      toast.error(t("login.loginInvalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(demoEmail: string) {
    setLoading(true);
    try {
      await login(demoEmail, "password123");
      toast.success(t("login.loginSuccess"));
      router.push("/dashboard");
    } catch {
      toast.error(t("login.loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          >
            <Globe className="h-4 w-4 mr-1" />
            {locale === "en" ? "العربية" : "English"}
          </Button>
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            {t("common.appName")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("login.tagline")}
          </p>
        </div>

        {/* Login Form */}
        <Card>
          <CardHeader>
            <CardTitle>{t("login.signIn")}</CardTitle>
            <CardDescription>{t("login.signInDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("login.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("login.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("login.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("login.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("login.signingIn") : t("login.signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo Accounts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("login.ksaDemoAccounts")}
            </CardTitle>
            <CardDescription>{t("login.ksaDemoDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["buyer", "supplier", "lp", "admin"] as const).map((group) => {
              const accounts = DEMO_ACCOUNTS.filter((a) => a.group === group);
              if (accounts.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {(() => {
                      const cfg = GROUP_CONFIG[group];
                      return cfg ? (
                        <>
                          <cfg.Icon className="h-3.5 w-3.5" />
                          {t(cfg.labelKey)}
                        </>
                      ) : null;
                    })()}
                  </p>
                  <div className="grid gap-1.5">
                    {accounts.map((acc) => (
                      <Button
                        key={acc.email}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start text-left"
                        disabled={loading}
                        onClick={() => handleDemoLogin(acc.email)}
                      >
                        {acc.label}
                      </Button>
                    ))}
                  </div>
                  {group !== "admin" && <Separator className="mt-3" />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
