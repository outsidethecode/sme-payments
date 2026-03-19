"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
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
import {
  Building2,
  Package,
  Landmark,
  Settings,
} from "lucide-react";

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

const GROUP_CONFIG: Record<string, { label: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }> = {
  buyer: { label: "Buyer Team – Al-Rajhi Trading Co", Icon: Building2 },
  supplier: { label: "Supplier Team – Noor Supply Chain", Icon: Package },
  lp: { label: "LP Team – Tamweel Capital", Icon: Landmark },
  admin: { label: "Platform", Icon: Settings },
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Logged in successfully");
      router.push("/dashboard");
    } catch {
      toast.error("Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(demoEmail: string) {
    setLoading(true);
    try {
      await login(demoEmail, "password123");
      toast.success("Logged in successfully");
      router.push("/dashboard");
    } catch {
      toast.error("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Programmable SME Settlement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Event-Driven B2B Payments with Embedded Liquidity and Verifiable
            Digital Trust
          </p>
        </div>

        {/* Login Form */}
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Enter your credentials or choose a demo account below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.co.uk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo Accounts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              KSA Demo Accounts
            </CardTitle>
            <CardDescription>
              Click to sign in as any team member role – test PO approvals,
              escrow, settlement & more
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["buyer", "supplier", "lp", "admin"] as const).map((group) => {
              const accounts = DEMO_ACCOUNTS.filter(
                (a) => a.group === group,
              );
              if (accounts.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {(() => { const cfg = GROUP_CONFIG[group]; return cfg ? <><cfg.Icon className="h-3.5 w-3.5" />{cfg.label}</> : null; })()}
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
