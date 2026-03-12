"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  ClipboardCheck,
  ArrowRightLeft,
  Scale,
  AlertTriangle,
  Receipt,
} from "lucide-react";
import { PasskeyBanner } from "@/components/passkey-banner";
import { HealthIndicator } from "@/components/health-indicator";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/onboarding",
    label: "Onboarding",
    icon: ClipboardCheck,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER"],
  },
  {
    href: "/dashboard/purchase-orders",
    label: "Purchase Orders",
    icon: FileText,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    icon: ShieldCheck,
    roles: ["BUYER", "ADMIN"],
  },
  {
    href: "/dashboard/invitations",
    label: "Invitations",
    icon: UserPlus,
    roles: ["BUYER", "ADMIN"],
  },
  {
    href: "/dashboard/payment-locks",
    label: "Payment Locks",
    icon: Lock,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/early-payments",
    label: "Early Payments",
    icon: Zap,
    roles: ["SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/settlements",
    label: "Settlements",
    icon: ArrowRightLeft,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/disputes",
    label: "Disputes",
    icon: Scale,
    roles: ["BUYER", "SUPPLIER", "ADMIN"],
  },
  {
    href: "/dashboard/risk",
    label: "Risk Controls",
    icon: AlertTriangle,
    roles: ["ADMIN", "LIQUIDITY_PARTNER"],
  },
  {
    href: "/dashboard/ledger",
    label: "Ledger",
    icon: BookOpen,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/receipts",
    label: "My Receipts",
    icon: Receipt,
    roles: ["BUYER", "SUPPLIER", "LIQUIDITY_PARTNER", "ADMIN"],
  },
  {
    href: "/dashboard/admin/reconciliation",
    label: "Reconciliation",
    icon: ArrowRightLeft,
    roles: ["ADMIN"],
  },
  {
    href: "/dashboard/admin",
    label: "Admin",
    icon: Settings,
    roles: ["ADMIN"],
  },
  {
    href: "/verify",
    label: "Verify Evidence",
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

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
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
            Programmable SME Settlement
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
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={active ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                  size="sm"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
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
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <header className="flex h-14 items-center justify-between border-b px-4 md:hidden">
          <span className="text-lg font-bold">Programmable SME Settlement</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        <div className="p-6">
          <PasskeyBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
