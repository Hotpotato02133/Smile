"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  Activity,
  Building2,
  CreditCard,
  Layers,
  LayoutDashboard,
  Megaphone,
  Menu,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

const NAV_ITEMS = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/super-admin/clinics", label: "Clinics", icon: Building2 },
  { href: "/super-admin/billing", label: "Billing & Invoices", icon: CreditCard },
  { href: "/super-admin/plans", label: "Subscription Plans", icon: Layers },
  { href: "/super-admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/super-admin/audit-logs", label: "Audit Logs", icon: Activity },
] as const;

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-2" aria-label="Super Admin navigation">
      {NAV_ITEMS.map((item) => {
        const isActive =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectedHeaderIdentity() {
  const user = useQuery(api.users.current);
  return (
    <div className="flex items-center gap-3">
      {user ? (
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">
            {`${user.firstName} ${user.lastName}`.trim() || user.email}
          </p>
          <p className="text-[11px] text-muted-foreground">{user.email}</p>
        </div>
      ) : null}
      <UserButton />
    </div>
  );
}

export function SuperAdminEnvGate({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <Alert className="max-w-2xl">
        <ShieldCheck className="size-4" />
        <AlertTitle>Connect Clerk & Convex to activate Super Admin</AlertTitle>
        <AlertDescription>
          Populate <code>NEXT_PUBLIC_CONVEX_URL</code>,{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>,{" "}
          <code>CLERK_SECRET_KEY</code>, and <code>SUPER_ADMIN_EMAIL</code> in{" "}
          <code>.env.local</code>, push your schema with <code>npx convex dev</code>,
          and seed plans via <code>npx convex run seed:initializePlatform</code>.
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
}

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isConfigured } = useEnvConfig();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-1 bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/super-admin" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              S
            </span>
            <span>Smile SaaS</span>
          </Link>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
            Owner
          </Badge>
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Zero-Cost Guardrails</p>
          <p className="mt-0.5">Convex 1 GB storage · Resend 3k/mo</p>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="lg:hidden"
                    aria-label="Open menu"
                  />
                }
              >
                <Menu className="size-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetHeader className="border-b px-4 py-3">
                  <SheetTitle>Smile SaaS · Owner</SheetTitle>
                </SheetHeader>
                <NavLinks
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">
                Super Admin Command Center
              </span>
            </div>
          </div>

          {isConfigured ? (
            <ConnectedHeaderIdentity />
          ) : (
            <Badge variant="outline">Setup Mode</Badge>
          )}
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
