"use client";

import { UserButton } from "@clerk/nextjs";
import { useApiAuth, useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  Armchair,
  ArrowLeft,
  BarChart3,
  BriefcaseMedical,
  Building2,
  CreditCard,
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
  useEffect,
  useRef,
  useState,
} from "react";
import { AccountDeactivatedCard } from "@/components/auth/account-deactivated-card";
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
import { formatDate, getErrorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/dentists", label: "Dentists & Shifts", icon: Stethoscope },
  { href: "/admin/chairs", label: "Operatory Chairs", icon: Armchair },
  { href: "/admin/services", label: "Dental Services", icon: BriefcaseMedical },
  { href: "/admin/staff", label: "Staff & Invites", icon: Users },
  { href: "/admin/settings", label: "Clinic Settings", icon: Settings },
  { href: "/admin/billing", label: "Subscription & Billing", icon: CreditCard },
  { href: "/admin/reports", label: "Local Reports", icon: BarChart3 },
] as const;

type ClinicAdminContextValue = {
  overrideClinicId: Id<"clinics"> | undefined;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  isSuperAdminOverride: boolean;
  buildHref: (path: string) => string;
};

const ClinicAdminContext = createContext<ClinicAdminContextValue>({
  overrideClinicId: undefined,
  isReadOnly: false,
  readOnlyReason: null,
  isSuperAdminOverride: false,
  buildHref: (p) => p,
});

export function useClinicAdminContext(): ClinicAdminContextValue {
  return useContext(ClinicAdminContext);
}

function useViewAsClinicId(): Id<"clinics"> | undefined {
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAsClinicId")?.trim() || undefined;
  return viewAs as Id<"clinics"> | undefined;
}

function buildClinicHref(
  path: string,
  overrideClinicId?: Id<"clinics">
): string {
  return overrideClinicId
    ? `${path}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
    : path;
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
    <nav
      className="flex flex-col gap-1 px-3 py-2"
      aria-label="Clinic Admin navigation"
    >
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

function useActiveWorkspace(overrideClinicId?: Id<"clinics">) {
  const { isAuthenticated } = useApiAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const canQueryWorkspace = Boolean(
    isAuthenticated &&
      user?.isActive &&
      ((user.role === "clinic_admin" && Boolean(user.clinicId)) ||
        (user.role === "super_admin" && Boolean(overrideClinicId)))
  );
  return useQuery(
    api.clinicAdmin.getClinicWorkspace,
    canQueryWorkspace ? { overrideClinicId } : "skip"
  );
}

function ClinicAdminPageSkeleton() {
  return (
    <div className="space-y-5 py-1">
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border bg-muted/40"
          />
        ))}
      </div>
    </div>
  );
}

function ClinicAdminPageGuard({ children }: { children: ReactNode }) {
  const overrideClinicId = useViewAsClinicId();
  const { isAuthenticated, isLoading: authLoading } = useApiAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncStartedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || user !== null || syncStartedRef.current) return;
    let cancelled = false;
    syncStartedRef.current = true;
    void ensureUser()
      .then(() => {
        if (!cancelled) setSyncError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSyncError(
            getErrorMessage(err, "Unable to sync your user account.")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, ensureUser]);

  const canAccessAdmin = Boolean(
    user?.isActive &&
      ((user.role === "clinic_admin" && Boolean(user.clinicId)) ||
        (user.role === "super_admin" && Boolean(overrideClinicId)))
  );

  const workspace = useQuery(
    api.clinicAdmin.getClinicWorkspace,
    isAuthenticated && canAccessAdmin ? { overrideClinicId } : "skip"
  );

  if (authLoading || (isAuthenticated && user === undefined)) {
    return <ClinicAdminPageSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto my-12 max-w-md px-4">
        <Alert className="p-6">
          <ShieldCheck className="size-4" />
          <AlertTitle>Clinic Admin sign-in required</AlertTitle>
          <AlertDescription className="mt-2 space-y-4">
            <p>
              Sign in with your Clinic Admin account to manage dentists,
              operatory chairs, dental services, staff, billing, and reports.
            </p>
            <Button
              className="w-full"
              render={<Link href="/sign-in?redirect_url=%2Fadmin" />}
            >
              Sign in to Clinic Admin
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (user && !user.isActive) {
    return <AccountDeactivatedCard />;
  }

  if (!user) {
    if (syncError) {
      return <AccountDeactivatedCard reason={syncError} />;
    }

    return (
      <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="size-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">
          Syncing your clinic account…
        </p>
      </div>
    );
  }

  if (user.role === "super_admin" && !overrideClinicId) {
    return (
      <div className="mx-auto my-12 max-w-md px-4">
        <Alert className="p-6">
          <Building2 className="size-4" />
          <AlertTitle>Select a clinic to inspect</AlertTitle>
          <AlertDescription className="mt-2 space-y-4">
            <p>
              You are signed in as a <strong>Super Admin</strong> ({user.email}
              ). Open the Clinics directory and choose{" "}
              <strong>View As Clinic</strong> to inspect a tenant&apos;s{" "}
              <code>/admin</code> workspace.
            </p>
            <Button
              className="w-full"
              render={<Link href="/super-admin/clinics" />}
            >
              Open Super Admin Clinics
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!canAccessAdmin) {
    return (
      <div className="mx-auto my-12 max-w-md px-4">
        <Alert variant="destructive" className="p-6">
          <ShieldAlert className="size-4" />
          <AlertTitle>Clinic Admin access required</AlertTitle>
          <AlertDescription className="mt-2 space-y-4">
            <p>
              Your signed-in account (<code>{user.email}</code>) currently has
              the{" "}
              <strong className="capitalize">
                {user.role.replace("_", " ")}
              </strong>{" "}
              role
              {user.role === "clinic_admin" && !user.clinicId
                ? " without an assigned clinic"
                : ""}{" "}
              and cannot open <code>/admin</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" render={<Link href="/post-login" />}>
                Go to My Workspace
              </Button>
              <Button size="sm" variant="outline" render={<Link href="/" />}>
                Back to Home
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const buildHref = (path: string) => buildClinicHref(path, overrideClinicId);

  return (
    <ClinicAdminContext.Provider
      value={{
        overrideClinicId,
        isReadOnly: workspace?.isReadOnly ?? false,
        readOnlyReason: workspace?.readOnlyReason ?? null,
        isSuperAdminOverride: workspace?.isSuperAdminOverride ?? false,
        buildHref,
      }}
    >
      {workspace?.announcements && workspace.announcements.length > 0 ? (
        <div className="space-y-2">
          {workspace.announcements.slice(0, 2).map((ann) => (
            <Alert
              key={ann._id}
              variant={ann.severity === "critical" ? "destructive" : "default"}
            >
              <Megaphone className="size-4" />
              <AlertTitle>{ann.title}</AlertTitle>
              <AlertDescription>{ann.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}
      {children}
    </ClinicAdminContext.Provider>
  );
}

export function ClinicAdminEnvGate({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <Alert className="max-w-2xl">
        <ShieldCheck className="size-4" />
        <AlertTitle>Connect Clerk &amp; Smile API to activate Clinic Admin</AlertTitle>
        <AlertDescription>
          Populate <code>NEXT_PUBLIC_API_URL</code>,{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>, and{" "}
          <code>CLERK_SECRET_KEY</code> in <code>.env.local</code>, then run{" "}
          <code>npm run dev:api</code> to manage your clinic&apos;s dentists,
          operatory chairs, dental services, and operating hours.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Suspense fallback={<ClinicAdminPageSkeleton />}>
      <ClinicAdminPageGuard>{children}</ClinicAdminPageGuard>
    </Suspense>
  );
}

function SidebarChromeContent({ pathname }: { pathname: string }) {
  const overrideClinicId = useViewAsClinicId();
  const workspace = useActiveWorkspace(overrideClinicId);
  const buildHref = (path: string) => buildClinicHref(path, overrideClinicId);

  return (
    <>
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link
          href={buildHref("/admin")}
          className="flex min-w-0 items-center gap-2 font-semibold tracking-tight"
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{
              backgroundColor: workspace?.clinic.primaryColorHex ?? "#0284c7",
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
          <Link
            href={buildHref("/admin/billing")}
            className="block space-y-1 rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/60"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">
                {workspace.plan.name}
              </span>
              <ClinicStatusBadge status={workspace.clinic.status} />
            </div>
            <p>Renews {formatDate(workspace.clinic.subscriptionEndsAt)}</p>
          </Link>
        ) : (
          <p>Clinic Setup Portal</p>
        )}
      </div>
    </>
  );
}

function SidebarChromeFallback({ pathname }: { pathname: string }) {
  return (
    <>
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link
          href="/admin"
          className="flex min-w-0 items-center gap-2 font-semibold tracking-tight"
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: "#0284c7" }}
          >
            S
          </span>
          <span className="truncate">Clinic Admin</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        <NavLinks pathname={pathname} buildHref={(p) => p} />
      </div>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <p>Clinic Setup Portal</p>
      </div>
    </>
  );
}

function TopStatusBanners() {
  const overrideClinicId = useViewAsClinicId();
  const workspace = useActiveWorkspace(overrideClinicId);
  if (!workspace) return null;

  const buildHref = (path: string) => buildClinicHref(path, overrideClinicId);
  const { isReadOnly, readOnlyReason, isSuperAdminOverride } = workspace;

  return (
    <>
      {/* Super Admin Read-Only Banner */}
      {isSuperAdminOverride ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-900 dark:text-sky-200 lg:px-6">
          <div className="flex items-center gap-2">
            <Eye className="size-4 shrink-0" />
            <span>
              <strong>Super Admin View-As-Clinic (Read-Only):</strong>{" "}
              Inspecting{" "}
              <span className="font-semibold">{workspace.clinic.name}</span>.
              All write actions are disabled.
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

      {/* Past Due Renewal Banner (Law #4 — inside grace period) */}
      {workspace.clinic.status === "past_due" && !isReadOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200 lg:px-6">
          <div className="flex items-center gap-2">
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            render={<Link href={buildHref("/admin/billing")} />}
          >
            View Billing
          </Button>
        </div>
      ) : null}

      {/* Suspended, Archived, Expired Trial, Expired Active, or Grace-Expired Read-Only Banner (Law #4) */}
      {isReadOnly && !isSuperAdminOverride ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-900 dark:text-rose-200 lg:px-6">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" />
            <span>
              <strong>
                Read-Only Mode ({workspace.clinic.status.replace("_", " ")}):
              </strong>{" "}
              {readOnlyReason ??
                "Existing records remain accessible, while editing and public bookings are paused until renewal."}{" "}
              (<code>/c/{workspace.clinic.slug}</code> paused)
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            render={<Link href={buildHref("/admin/billing")} />}
          >
            View Billing &amp; Invoices
          </Button>
        </div>
      ) : null}
    </>
  );
}

function MobileDrawerNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  const overrideClinicId = useViewAsClinicId();
  const workspace = useActiveWorkspace(overrideClinicId);
  const buildHref = (path: string) => buildClinicHref(path, overrideClinicId);

  return (
    <>
      <SheetHeader className="border-b px-4 py-3">
        <SheetTitle>{workspace?.clinic.name ?? "Clinic Admin"}</SheetTitle>
      </SheetHeader>
      <NavLinks
        pathname={pathname}
        buildHref={buildHref}
        onNavigate={onNavigate}
      />
    </>
  );
}

function ConnectedHeaderIdentity() {
  const { isAuthenticated } = useApiAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  return (
    <div className="flex items-center gap-3">
      {user?.isActive ? (
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">
            {`${user.firstName} ${user.lastName}`.trim() || user.email}
          </p>
          <p className="text-[11px] capitalize text-muted-foreground">
            {user.role.replace("_", " ")}
          </p>
        </div>
      ) : null}
      <UserButton />
    </div>
  );
}

function ConnectedClinicAdminDeactivatedGate({
  children,
}: {
  children: ReactNode;
}) {
  const { isAuthenticated } = useApiAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  if (user && !user.isActive) {
    return <AccountDeactivatedCard />;
  }

  return <>{children}</>;
}

function ClinicAdminShellLayout({
  children,
  isConfigured,
}: {
  children: ReactNode;
  isConfigured: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-1 bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        {isConfigured ? (
          <Suspense fallback={<SidebarChromeFallback pathname={pathname} />}>
            <SidebarChromeContent pathname={pathname} />
          </Suspense>
        ) : (
          <>
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold tracking-tight">Clinic Admin</span>
              <Badge variant="outline">Setup</Badge>
            </div>
            <div className="flex-1 py-3">
              <NavLinks pathname={pathname} buildHref={(p) => p} />
            </div>
          </>
        )}
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {isConfigured ? (
          <Suspense fallback={null}>
            <TopStatusBanners />
          </Suspense>
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
                <Suspense
                  fallback={
                    <>
                      <SheetHeader className="border-b px-4 py-3">
                        <SheetTitle>Clinic Admin</SheetTitle>
                      </SheetHeader>
                      <NavLinks
                        pathname={pathname}
                        buildHref={(p) => p}
                        onNavigate={() => setMobileOpen(false)}
                      />
                    </>
                  }
                >
                  <MobileDrawerNav
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </Suspense>
              </SheetContent>
            </Sheet>
            <span className="text-sm font-semibold tracking-tight">
              Clinic Administration
            </span>
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

export function ClinicAdminShell({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (isConfigured) {
    return (
      <ConnectedClinicAdminDeactivatedGate>
        <ClinicAdminShellLayout isConfigured={true}>
          {children}
        </ClinicAdminShellLayout>
      </ConnectedClinicAdminDeactivatedGate>
    );
  }

  return (
    <ClinicAdminShellLayout isConfigured={false}>
      {children}
    </ClinicAdminShellLayout>
  );
}
