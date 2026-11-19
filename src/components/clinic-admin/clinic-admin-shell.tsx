"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Armchair,
  ArrowLeft,
  BarChart3,
  BriefcaseMedical,
  Eye,
  LayoutDashboard,
  Megaphone,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  Suspense,
  useContext,
  useState,
} from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { ClinicStatusBadge } from "@/components/super-admin/status-badges";
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/dentists", label: "Dentists & Shifts", icon: Stethoscope },
  { href: "/admin/chairs", label: "Operatory Chairs", icon: Armchair },
  { href: "/admin/services", label: "Dental Services", icon: BriefcaseMedical },
  { href: "/admin/staff", label: "Staff & Invites", icon: Users },
  { href: "/admin/settings", label: "Clinic Settings", icon: Settings },
  { href: "/admin/reports", label: "Local Reports", icon: BarChart3 },
] as const;

type ClinicAdminContextValue = {
  overrideClinicId: Id<"clinics"> | undefined;
  isReadOnly: boolean;
  isSuperAdminOverride: boolean;
  buildHref: (path: string) => string;
};

const ClinicAdminContext = createContext<ClinicAdminContextValue>({
  overrideClinicId: undefined,
  isReadOnly: false,
  isSuperAdminOverride: false,
  buildHref: (p) => p,
});

export function useClinicAdminContext(): ClinicAdminContextValue {
  return useContext(ClinicAdminContext);
}

function NavLinks({
  pathname,
  buildHref,
  onNavigate,
}: {
  pathname: string;
  buildHref: (p: string) => string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-2" aria-label="Clinic Admin navigation">
      {NAV_ITEMS.map((item) => {
        const isActive =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={buildHref(item.href)}
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

export function ClinicAdminEnvGate({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <Alert className="max-w-2xl">
        <ShieldCheck className="size-4" />
        <AlertTitle>Connect Clerk & Convex to activate Clinic Admin</AlertTitle>
        <AlertDescription>
          Populate <code>NEXT_PUBLIC_CONVEX_URL</code>,{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>, and{" "}
          <code>CLERK_SECRET_KEY</code> in <code>.env.local</code>, then run{" "}
          <code>npx convex dev</code> to manage your clinic&apos;s dentists,
          operatory chairs, dental services, and operating hours.
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
}

function ConnectedShellInner({
  children,
  overrideClinicId,
}: {
  children: ReactNode;
  overrideClinicId: Id<"clinics"> | undefined;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const workspace = useQuery(api.clinicAdmin.getClinicWorkspace, {
    overrideClinicId,
  });

  const buildHref = (path: string) =>
    overrideClinicId
      ? `${path}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
      : path;

  const isReadOnly = workspace?.isReadOnly ?? false;
  const isSuperAdminOverride = workspace?.isSuperAdminOverride ?? false;

  return (
    <ClinicAdminContext.Provider
      value={{
        overrideClinicId,
        isReadOnly,
        isSuperAdminOverride,
        buildHref,
      }}
    >
      <div className="flex min-h-screen flex-1 bg-background">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <div className="flex h-14 items-center justify-between border-b px-4">
            <Link
              href={buildHref("/admin")}
              className="flex min-w-0 items-center gap-2 font-semibold tracking-tight"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                style={{
                  backgroundColor:
                    workspace?.clinic.primaryColorHex ?? "#0284c7",
                }}
              >
                {(workspace?.clinic.name ?? "S").slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">
                {workspace?.clinic.name ?? "Clinic Admin"}
              </span>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto py-3">
            <NavLinks pathname={pathname} buildHref={buildHref} />
          </div>

          <div className="border-t p-3 text-xs text-muted-foreground">
            {workspace?.plan ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {workspace.plan.name}
                  </span>
                  <ClinicStatusBadge status={workspace.clinic.status} />
                </div>
                <p>
                  Renews {formatDate(workspace.clinic.subscriptionEndsAt)}
                </p>
              </div>
            ) : (
              <p>Clinic Setup Portal</p>
            )}
          </div>
        </aside>

        {/* Main Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Super Admin Read-Only Banner */}
          {isSuperAdminOverride ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-900 dark:text-sky-200 lg:px-6">
              <div className="flex items-center gap-2">
                <Eye className="size-4 shrink-0" />
                <span>
                  <strong>Super Admin View-As-Clinic (Read-Only):</strong>{" "}
                  Inspecting{" "}
                  <span className="font-semibold">
                    {workspace?.clinic.name ?? "tenant"}
                  </span>
                  . All write actions are disabled.
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                render={<Link href="/super-admin/clinics" />}
              >
                <ArrowLeft className="mr-1 size-3.5" />
                Back to Super Admin
              </Button>
            </div>
          ) : null}

          {/* Past Due Renewal Banner (Law #4) */}
          {workspace?.clinic.status === "past_due" ? (
            <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200 lg:px-6">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                <strong>Subscription Past Due:</strong> Your clinic is in its
                3-day grace period
                {workspace.clinic.gracePeriodEndsAt
                  ? ` (ends ${formatDate(workspace.clinic.gracePeriodEndsAt)})`
                  : ""}
                . Renew now to avoid automatic Read-Only suspension.
              </span>
            </div>
          ) : null}

          {/* Suspended / Archived Read-Only Banner (Law #4) */}
          {workspace &&
          (workspace.clinic.status === "suspended" ||
            workspace.clinic.status === "archived") ? (
            <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-900 dark:text-rose-200 lg:px-6">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                <strong>Read-Only Mode ({workspace.clinic.status}):</strong>{" "}
                Existing records remain accessible, but creating or editing
                resources and public bookings on{" "}
                <code>/c/{workspace.clinic.slug}</code> are paused until renewal.
              </span>
            </div>
          ) : null}

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
                    <SheetTitle>
                      {workspace?.clinic.name ?? "Clinic Admin"}
                    </SheetTitle>
                  </SheetHeader>
                  <NavLinks
                    pathname={pathname}
                    buildHref={buildHref}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </SheetContent>
              </Sheet>
              <span className="text-sm font-semibold tracking-tight">
                Clinic Administration
              </span>
            </div>

            <div className="flex items-center gap-3">
              {workspace?.user ? (
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-medium leading-tight">
                    {`${workspace.user.firstName} ${workspace.user.lastName}`.trim() ||
                      workspace.user.email}
                  </p>
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {workspace.user.role.replace("_", " ")}
                  </p>
                </div>
              ) : null}
              <UserButton />
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 lg:p-6">
            {/* Active System Announcements */}
            {workspace?.announcements && workspace.announcements.length > 0 ? (
              <div className="space-y-2">
                {workspace.announcements.slice(0, 2).map((ann) => (
                  <Alert
                    key={ann._id}
                    variant={
                      ann.severity === "critical" ? "destructive" : "default"
                    }
                  >
                    <Megaphone className="size-4" />
                    <AlertTitle>{ann.title}</AlertTitle>
                    <AlertDescription>{ann.message}</AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : null}

            {children}
          </main>
        </div>
      </div>
    </ClinicAdminContext.Provider>
  );
}

function UnconfiguredShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen flex-1 bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="font-semibold tracking-tight">Clinic Admin</span>
          <Badge variant="outline">Setup</Badge>
        </div>
        <div className="flex-1 py-3">
          <NavLinks pathname={pathname} buildHref={(p) => p} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm font-semibold">Clinic Administration</span>
          <Badge variant="outline">Setup Mode</Badge>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SearchParamsShellResolver({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAsClinicId")?.trim() || undefined;
  const overrideClinicId = viewAs as Id<"clinics"> | undefined;

  if (!isConfigured) {
    return <UnconfiguredShell>{children}</UnconfiguredShell>;
  }

  return (
    <ConnectedShellInner overrideClinicId={overrideClinicId}>
      {children}
    </ConnectedShellInner>
  );
}

export function ClinicAdminShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex flex-1 p-6 text-sm text-muted-foreground">Loading clinic workspace…</div>}>
      <SearchParamsShellResolver>{children}</SearchParamsShellResolver>
    </Suspense>
  );
}
