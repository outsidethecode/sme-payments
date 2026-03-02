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

const DEMO_ACCOUNTS = [
  { email: "buyer@acme.co.uk", label: "Buyer – Acme Retail", role: "BUYER" },
  {
    email: "buyer@greenfield.co.uk",
    label: "Buyer – Greenfield Mfg",
    role: "BUYER",
  },
  {
    email: "supplier@swiftlogistics.co.uk",
    label: "Supplier – Swift Logistics",
    role: "SUPPLIER",
  },
  {
    email: "supplier@brightworks.co.uk",
    label: "Supplier – Brightworks Eng",
    role: "SUPPLIER",
  },
  {
    email: "lp@capitalbridge.co.uk",
    label: "Liquidity Partner – Capital Bridge",
    role: "LP",
  },
  { email: "admin@platform.co.uk", label: "Platform Admin", role: "ADMIN" },
];

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
            <CardTitle className="text-base">Demo Accounts</CardTitle>
            <CardDescription>
              Click to instantly sign in as any role
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Separator className="mb-3" />
            <div className="grid gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <Button
                  key={acc.email}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left"
                  disabled={loading}
                  onClick={() => handleDemoLogin(acc.email)}
                >
                  <span className="mr-2 inline-block w-2 h-2 rounded-full bg-primary" />
                  {acc.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
