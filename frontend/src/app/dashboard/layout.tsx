"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { onboardingApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  FileText,
  Lock,
  Zap,
  BookOpen,
  Settings,
  LogOut,
  ChevronDown,
  ShieldCheck,
  UserPlus,
  Users,
  ClipboardCheck,
  ArrowRightLeft,
  Scale,
  AlertTriangle,
  Receipt,
  Building2,
  ToggleLeft,
  Fingerprint,
  ChevronRight,
  Globe,
} from "lucide-react";
import { PasskeyBanner } from "@/components/passkey-banner";
import { HealthIndicator } from "@/components/health-indicator";
import { useTranslation } from "@/i18n";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    labelKey: "nav.dashboard",
    icon: LayoutDashboard,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/onboarding",
    labelKey: "nav.onboarding",
    icon: ClipboardCheck,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER"],
  },
  {
    href: "/dashboard/purchase-orders",
    labelKey: "nav.purchaseOrders",
    icon: FileText,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/approvals",
    labelKey: "nav.approvals",
    icon: ShieldCheck,
    roles: ["BUYER", "ADMIN"],
  },
  {
    href: "/dashboard/team",
    labelKey: "nav.team",
    icon: Users,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/invitations",
    labelKey: "nav.invitations",
    icon: UserPlus,
    roles: ["BUYER", "ADMIN"],
  },
  {
    href: "/dashboard/payment-locks",
    labelKey: "nav.paymentLocks",
    icon: Lock,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/early-payments",
    labelKey: "nav.earlyPayments",
    icon: Zap,
    roles: ["SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/settlements",
    labelKey: "nav.settlements",
    icon: ArrowRightLeft,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/disputes",
    labelKey: "nav.disputes",
    icon: Scale,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/risk",
    labelKey: "nav.riskControls",
    icon: AlertTriangle,
    roles: ["ADMIN", "LIQUIDITY_PARTNER"],
  },
  {
    href: "/dashboard/ledger",
    labelKey: "nav.ledger",
    icon: BookOpen,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/receipts",
    labelKey: "nav.myReceipts",
    icon: Receipt,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/admin/reconciliation",
    labelKey: "nav.reconciliation",
    icon: ArrowRightLeft,
    roles: ["ADMIN"],
  },
  {
    href: "/dashboard/admin/escrow-accounts",
    labelKey: "nav.escrowAccounts",
    icon: Building2,
    roles: ["ADMIN"],
  },
  {
    href: "/dashboard/admin/feature-flags",
    labelKey: "nav.featureFlags",
    icon: ToggleLeft,
    roles: ["ADMIN"],
  },
  {
    href: "/dashboard/policies",
    labelKey: "nav.policies",
    icon: ShieldCheck,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/admin",
    labelKey: "nav.admin",
    icon: Settings,
    roles: ["ADMIN"],
  },
  {
    href: "/verify",
    labelKey: "nav.verifyEvidence",
    icon: ShieldCheck,
    roles: ["LIQUIDITY_PARTNER", "ADMIN"],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale, setLocale } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/dashboard/settings"),
  );

  // Auto-expand when navigating into settings
  useEffect(() => {
    if (pathname.startsWith("/dashboard/settings")) {
      setSettingsOpen(true);
    }
  }, [pathname]);

  // ── Onboarding gate (must be before any early return to satisfy Rules of Hooks) ──
  const isAdmin = user?.role === "ADMIN";
  const { data: onboardingStatus } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => onboardingApi.status().then((r) => r.data),
    enabled: !isAdmin && !!user,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) return null;

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const onboardingComplete =
    isAdmin || onboardingStatus?.onboardingStatus === "COMPLETED";

  // Pages allowed before onboarding is complete
  const isAlwaysAllowed = (path: string) =>
    path === "/dashboard" ||
    path === "/dashboard/onboarding" ||
    path.startsWith("/dashboard/onboarding/") ||
    path.startsWith("/dashboard/settings");

  const isAllowedPage = isAlwaysAllowed(pathname);

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-muted/30 md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            {t("common.appName")}
          </Link>
          <div className="ml-auto">
            <HealthIndicator />
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const gated = !onboardingComplete && !isAlwaysAllowed(item.href);
            return (
              <Link key={item.href} href={gated ? "#" : item.href}>
                <Button
                  variant={active ? "secondary" : "ghost"}
                  className={`w-full justify-start gap-2 ${
                    gated ? "opacity-40 pointer-events-none" : ""
                  }`}
                  size="sm"
                  disabled={gated}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </Button>
              </Link>
            );
          })}

          {/* ── Settings group ── */}
          <div>
            <Button
              variant={
                pathname.startsWith("/dashboard/settings")
                  ? "secondary"
                  : "ghost"
              }
              className="w-full justify-start gap-2"
              size="sm"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings className="h-4 w-4" />
              {t("nav.settings")}
              <ChevronRight
                className={`ml-auto h-3 w-3 transition-transform ${
                  settingsOpen ? "rotate-90" : ""
                }`}
              />
            </Button>
            {settingsOpen && (
              <div className="ml-4 mt-1 space-y-1">
                <Link href="/dashboard/settings/security">
                  <Button
                    variant={
                      pathname.startsWith("/dashboard/settings/security")
                        ? "secondary"
                        : "ghost"
                    }
                    className="w-full justify-start gap-2"
                    size="sm"
                  >
                    <Fingerprint className="h-4 w-4" />
                    {t("nav.passkeys")}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </nav>

        <Separator />
        <div className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2"
                size="sm"
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-xs">
                  <span className="font-medium">{user.name}</span>
                  <span className="text-muted-foreground">
                    {user.companyName}
                    {user.jurisdiction &&
                      ` · ${user.jurisdiction === "KSA" ? "🇸🇦" : "🇬🇧"}`}
                  </span>
                </div>
                <ChevronDown className="ml-auto h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                {t("common.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Language switcher */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 mt-1"
            onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          >
            <Globe className="h-4 w-4" />
            {locale === "en" ? "العربية" : "English"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <header className="flex h-14 items-center justify-between border-b px-4 md:hidden">
          <span className="text-lg font-bold">{t("common.appName")}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        <div className="p-6">
          <PasskeyBanner />
          {!onboardingComplete && !isAllowedPage ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-6 text-center space-y-3">
              <ClipboardCheck className="mx-auto h-10 w-10 text-amber-600" />
              <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200">
                {t("layout.completeOnboardingFirst")}
              </h2>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t("layout.completeOnboardingDescription")}
              </p>
              <Link href="/dashboard/onboarding">
                <Button size="sm" className="mt-2">
                  {t("layout.goToOnboarding")}
                </Button>
              </Link>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
