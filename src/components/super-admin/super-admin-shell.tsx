"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Activity,
  Building2,
  CreditCard,
  ExternalLink,
  Home,
  Layers,
  LayoutDashboard,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { AccountDeactivatedCard } from "@/components/auth/account-deactivated-card";
import { SmileLogo } from "@/components/landing/smile-logo";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

const SIDEBAR_STORAGE_KEY = "smile.superAdmin.sidebarOpen";
const SIDEBAR_EVENT = "smile-super-admin-sidebar-change";

function subscribeSidebarState(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SIDEBAR_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SIDEBAR_EVENT, callback);
  };
}

function getSidebarSnapshot(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function getSidebarServerSnapshot(): boolean {
  return true;
}

function setPersistedSidebarOpen(next: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  } catch {
    // Ignore storage errors in restricted environments
  }
}

const NAV_ITEMS = [
  {
    href: "/super-admin",
    label: "Overview",
    shortLabel: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/super-admin/clinics",
    label: "Clinics",
    shortLabel: "Clinics",
    icon: Building2,
  },
  {
    href: "/super-admin/users",
    label: "Users & Invites",
    shortLabel: "Users",
    icon: UserPlus,
  },
  {
    href: "/super-admin/billing",
    label: "Billing & Invoices",
    shortLabel: "Billing",
    icon: CreditCard,
  },
  {
    href: "/super-admin/plans",
    label: "Subscription Plans",
    shortLabel: "Plans",
    icon: Layers,
  },
  {
    href: "/super-admin/announcements",
    label: "Announcements",
    shortLabel: "Notices",
    icon: Megaphone,
  },
  {
    href: "/super-admin/audit-logs",
    label: "Audit Logs",
    shortLabel: "Audit",
    icon: Activity,
  },
] as const;

function isRouteActive(pathname: string, item: (typeof NAV_ITEMS)[number]) {
  return "exact" in item && item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function getPageBreadcrumb(pathname: string): string {
  const active = NAV_ITEMS.find((item) => isRouteActive(pathname, item));
  return active ? active.label : "Command Center";
}

function NavLinks({
  pathname,
  onNavigate,
  billingQueueCount,
  pendingInvitesCount,
}: {
  pathname: string;
  onNavigate?: () => void;
  billingQueueCount: number;
  pendingInvitesCount: number;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Super Admin navigation">
      {NAV_ITEMS.map((item) => {
        const active = isRouteActive(pathname, item);
        const Icon = item.icon;
        const badgeCount =
          item.href === "/super-admin/billing"
            ? billingQueueCount
            : item.href === "/super-admin/users"
              ? pendingInvitesCount
              : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-medium transition-colors",
              active
                ? "bg-[#E9ECF2] font-semibold text-slate-950"
                : "text-slate-600 hover:bg-[#EDF1F7] hover:text-slate-950"
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-2.5">
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  active ? "text-[#6C5CE7]" : "text-slate-500"
                )}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </span>
            {badgeCount > 0 ? (
              <span
                title={`${badgeCount} billing items need attention`}
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-900"
              >
                {badgeCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectedSidebarFooter({
  onQueueCounts,
}: {
  onQueueCounts?: (counts: { billing: number; invites: number }) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const isSuperAdmin = Boolean(user?.isActive && user.role === "super_admin");
  const overview = useQuery(
    api.platformAnalytics.getDashboardOverview,
    isAuthenticated && isSuperAdmin ? {} : "skip"
  );
  const freeTier = useQuery(
    api.platformAnalytics.getFreeTierUsage,
    isAuthenticated && isSuperAdmin ? {} : "skip"
  );

  const billingCount =
    (overview?.renewalQueue.length ?? 0) +
    (overview?.pendingPaymentsCount ?? 0);
  const invitesCount = overview?.pendingInvitationsCount ?? 0;

  useEffect(() => {
    onQueueCounts?.({ billing: billingCount, invites: invitesCount });
  }, [billingCount, invitesCount, onQueueCounts]);

  const storagePct = freeTier?.storage.percentUsed ?? 0;
  const emailPct = freeTier?.emails.percentUsed ?? 0;
  const mauPct = freeTier?.clerkMau.percentUsed ?? 0;

  return (
    <div className="space-y-3">
      {/* Live Free-Tier Mini Telemetry */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
          <span>Zero-Cost Ceiling</span>
          <span className="text-[11px] font-medium text-emerald-700">$0/mo</span>
        </div>
        <div className="mt-2.5 space-y-2">
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Convex Storage</span>
              <span className="tabular-nums font-medium text-slate-700">
                {storagePct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  storagePct >= 85
                    ? "bg-rose-500"
                    : storagePct >= 65
                      ? "bg-amber-500"
                      : "bg-[#6C5CE7]"
                )}
                style={{
                  width: `${storagePct === 0 ? 0 : Math.min(100, Math.max(storagePct, 2))}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Resend Emails</span>
              <span className="tabular-nums font-medium text-slate-700">
                {emailPct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  emailPct >= 85
                    ? "bg-rose-500"
                    : emailPct >= 65
                      ? "bg-amber-500"
                      : "bg-sky-600"
                )}
                style={{
                  width: `${emailPct === 0 ? 0 : Math.min(100, Math.max(emailPct, 2))}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Clerk MAU</span>
              <span className="tabular-nums font-medium text-slate-700">
                {mauPct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  mauPct >= 85
                    ? "bg-rose-500"
                    : mauPct >= 65
                      ? "bg-amber-500"
                      : "bg-emerald-600"
                )}
                style={{
                  width: `${mauPct === 0 ? 0 : Math.min(100, Math.max(mauPct, 2))}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Signed-in Owner Row */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-3">
        <div className="flex items-center gap-2.5">
          <UserButton />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-950">
              {user
                ? `${user.firstName} ${user.lastName}`.trim() || "Platform Owner"
                : "Loading…"}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {user?.email ?? "Super Admin"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectedTopIdentity() {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  return (
    <div className="flex items-center gap-2.5">
      {user?.isActive ? (
        <div className="hidden text-right sm:block">
          <p className="text-xs font-semibold leading-tight text-slate-950">
            {`${user.firstName} ${user.lastName}`.trim() || user.email}
          </p>
          <p className="text-[11px] text-slate-500">{user.email}</p>
        </div>
      ) : null}
      <UserButton />
    </div>
  );
}

function SuperAdminAuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isAuthenticated && user === null) {
      void ensureUser().catch(() => {});
    }
  }, [isAuthenticated, user, ensureUser]);

  if (authLoading || (isAuthenticated && user === undefined)) {
    return (
      <div className="space-y-5 py-2">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-52 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-4 w-80 animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="h-9 w-32 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100 lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto my-12 max-w-md">
        <Alert className="rounded-2xl border-slate-200 bg-white p-6">
          <ShieldCheck className="size-5 text-[#6C5CE7]" />
          <AlertTitle className="text-base font-semibold text-slate-950">
            Super Admin sign-in required
          </AlertTitle>
          <AlertDescription className="mt-1.5 text-sm text-slate-600">
            Sign in with the configured platform owner account to access tenant
            provisioning, SaaS billing, and audit logs.
          </AlertDescription>
          <div className="mt-4">
            <Link
              href="/sign-in"
              className="inline-flex h-10 w-full items-center justify-center rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
            >
              Sign in to Command Center
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  if (user && !user.isActive) {
    return <AccountDeactivatedCard />;
  }

  if (!user) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
        <div className="size-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#6C5CE7]" />
        <p className="text-sm font-medium text-slate-600">
          Syncing your platform owner account…
        </p>
      </div>
    );
  }

  if (user.role !== "super_admin") {
    return (
      <div className="mx-auto my-12 max-w-md">
        <Alert className="rounded-2xl border-rose-200 bg-rose-50/70 p-6 text-rose-950">
          <ShieldAlert className="size-5 text-rose-600" />
          <AlertTitle className="text-base font-semibold">
            Platform Owner access only
          </AlertTitle>
          <AlertDescription className="mt-1.5 text-sm text-rose-900/80">
            Your signed-in account ({user.email}) is assigned the{" "}
            <strong className="capitalize">{user.role.replace("_", " ")}</strong>{" "}
            role and cannot open the Super Admin Command Center.
          </AlertDescription>
          <div className="mt-4">
            <Link
              href="/post-login"
              className="inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Return to your workspace
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}

export function SuperAdminEnvGate({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <Alert className="max-w-2xl rounded-2xl border-slate-200 bg-white p-6">
        <ShieldCheck className="size-5 text-[#6C5CE7]" />
        <AlertTitle className="text-base font-semibold">
          Connect Clerk &amp; Convex to activate Super Admin
        </AlertTitle>
        <AlertDescription className="mt-1.5 text-sm text-slate-600">
          Configure <code>NEXT_PUBLIC_CONVEX_URL</code>,{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>,{" "}
          <code>CLERK_SECRET_KEY</code>, and <code>SUPER_ADMIN_EMAIL</code> in{" "}
          <code>.env.local</code>, then run <code>npm run dev</code>.
        </AlertDescription>
      </Alert>
    );
  }

  return <SuperAdminAuthGuard>{children}</SuperAdminAuthGuard>;
}

function ConnectedSuperAdminDeactivatedGate({
  children,
}: {
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  if (user && !user.isActive) {
    return <AccountDeactivatedCard />;
  }

  return <>{children}</>;
}

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const { isConfigured } = useEnvConfig();

  if (isConfigured) {
    return (
      <ConnectedSuperAdminDeactivatedGate>
        <SuperAdminShellLayout isConfigured={isConfigured}>
          {children}
        </SuperAdminShellLayout>
      </ConnectedSuperAdminDeactivatedGate>
    );
  }

  return (
    <SuperAdminShellLayout isConfigured={false}>
      {children}
    </SuperAdminShellLayout>
  );
}

function SuperAdminShellLayout({
  children,
  isConfigured,
}: {
  children: ReactNode;
  isConfigured: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [queueCounts, setQueueCounts] = useState({ billing: 0, invites: 0 });
  const sidebarOpen = useSyncExternalStore(
    subscribeSidebarState,
    getSidebarSnapshot,
    getSidebarServerSnapshot
  );

  const toggleDesktopSidebar = () => {
    setPersistedSidebarOpen(!getSidebarSnapshot());
  };

  // Keyboard shortcut: Ctrl+B / Cmd+B toggles sidebar on desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setPersistedSidebarOpen(!getSidebarSnapshot());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sectionTitle = getPageBreadcrumb(pathname);

  return (
    <div className="flex min-h-screen w-full bg-[#F6F8FB] text-slate-950">
      {/* Desktop Toggleable Sidebar */}
      <aside
        aria-label="Super Admin sidebar"
        aria-hidden={!sidebarOpen}
        className={cn(
          "hidden shrink-0 flex-col justify-between overflow-hidden transition-[width,opacity,padding] duration-200 ease-out lg:flex",
          sidebarOpen
            ? "w-[260px] p-4 opacity-100"
            : "pointer-events-none w-0 p-0 opacity-0"
        )}
      >
        <div className="w-[228px] space-y-6">
          {/* Brand + Owner Scope */}
          <div className="flex items-center justify-between px-1.5 pt-1">
            <Link
              href="/super-admin"
              className="inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C5CE7] rounded-lg"
            >
              <SmileLogo />
            </Link>
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
              Owner
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="px-3 text-xs font-medium text-slate-500">
              Platform SaaS
            </p>
            <NavLinks
              pathname={pathname}
              billingQueueCount={queueCounts.billing}
              pendingInvitesCount={queueCounts.invites}
            />
          </div>

          <div className="space-y-1.5 pt-1">
            <p className="px-3 text-xs font-medium text-slate-500">Portals</p>
            <Link
              href="/clinics"
              className="flex h-9 w-full items-center justify-between rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950"
            >
              <span className="inline-flex items-center gap-2.5">
                <ExternalLink
                  className="size-4 text-slate-500"
                  aria-hidden="true"
                />
                <span>Public Directory</span>
              </span>
            </Link>
            <Link
              href="/"
              className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950"
            >
              <Home className="size-4 text-slate-500" aria-hidden="true" />
              <span>Smile Home</span>
            </Link>
          </div>
        </div>

        <div className="w-[228px] pt-4">
          {isConfigured ? (
            <ConnectedSidebarFooter onQueueCounts={setQueueCounts} />
          ) : (
            <div className="rounded-2xl border border-slate-200/70 bg-white p-3 text-xs text-slate-500">
              Setup Mode · Connect environment keys
            </div>
          )}
        </div>
      </aside>

      {/* Main Column — Inset White Sheet on Desktop */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 lg:py-2.5 lg:pr-2.5",
          !sidebarOpen && "lg:pl-2.5"
        )}
      >
        <div className="flex min-h-screen flex-1 flex-col bg-white lg:min-h-[calc(100vh-1.25rem)] lg:rounded-[24px] lg:border lg:border-slate-200/80">
          {/* Unified Sticky Top Bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200/75 bg-white/95 px-4 backdrop-blur-md lg:rounded-t-[24px] lg:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Mobile Drawer Trigger */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger
                  aria-label="Open navigation menu"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-[#F6F8FB] text-slate-700 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950 lg:hidden cursor-pointer"
                >
                  <Menu className="size-4" aria-hidden="true" />
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-[82vw] max-w-xs flex-col justify-between bg-[#F6F8FB] p-0"
                >
                  <div>
                    <SheetHeader className="flex flex-row items-center justify-between border-b border-slate-200/70 px-5 py-4 text-left">
                      <SheetTitle>
                        <SmileLogo />
                      </SheetTitle>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                        Owner
                      </span>
                    </SheetHeader>
                    <div className="space-y-5 p-4">
                      <NavLinks
                        pathname={pathname}
                        billingQueueCount={queueCounts.billing}
                        pendingInvitesCount={queueCounts.invites}
                        onNavigate={() => setMobileOpen(false)}
                      />
                      <div className="space-y-1 border-t border-slate-200/70 pt-4">
                        <Link
                          href="/clinics"
                          onClick={() => setMobileOpen(false)}
                          className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-white"
                        >
                          <ExternalLink className="size-4 text-slate-500" />
                          <span>Public Directory</span>
                        </Link>
                        <Link
                          href="/"
                          onClick={() => setMobileOpen(false)}
                          className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-white"
                        >
                          <Home className="size-4 text-slate-500" />
                          <span>Smile Home</span>
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/70 p-4">
                    <div className="rounded-2xl border border-slate-200/70 bg-white p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-900">
                        Zero-Cost Guardrails
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Convex 1 GB storage · Resend 3,000/mo
                      </p>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Desktop Sidebar On/Off Toggle */}
              <button
                type="button"
                onClick={toggleDesktopSidebar}
                aria-label={
                  sidebarOpen ? "Hide navigation sidebar" : "Show navigation sidebar"
                }
                aria-expanded={sidebarOpen}
                title={`${sidebarOpen ? "Hide" : "Show"} sidebar (Ctrl+B)`}
                className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-[#F6F8FB] text-slate-700 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950 lg:inline-flex cursor-pointer"
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                )}
              </button>

              {/* Compact Brand when Desktop Sidebar is Hidden or on Mobile */}
              {!sidebarOpen ? (
                <Link
                  href="/super-admin"
                  className="hidden items-center lg:inline-flex"
                >
                  <SmileLogo markClassName="size-7" textClassName="text-xs" />
                </Link>
              ) : null}

              <div className="flex min-w-0 items-center gap-2 text-sm">
                {!sidebarOpen ? (
                  <span className="hidden text-slate-300 lg:inline">/</span>
                ) : null}
                <span className="truncate font-semibold text-slate-950">
                  {sectionTitle}
                </span>
                <span className="hidden text-xs text-slate-400 sm:inline">
                  · Super Admin Command Center
                </span>
              </div>
            </div>

            {isConfigured ? (
              <ConnectedTopIdentity />
            ) : (
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                Setup Mode
              </span>
            )}
          </header>

          {/* Mobile Horizontal Quick-Nav Strip */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 bg-[#F6F8FB]/70 px-4 py-2.5 lg:hidden">
            {NAV_ITEMS.map((item) => {
              const active = isRouteActive(pathname, item);
              const badgeCount =
                item.href === "/super-admin/billing"
                  ? queueCounts.billing
                  : item.href === "/super-admin/users"
                    ? queueCounts.invites
                    : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "bg-slate-950 text-white"
                      : "border border-slate-200/80 bg-white text-slate-700"
                  )}
                >
                  <span>{item.shortLabel}</span>
                  {badgeCount > 0 ? (
                    <span
                      className={cn(
                        "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                        active
                          ? "bg-amber-400 text-slate-950"
                          : "bg-amber-100 text-amber-900"
                      )}
                    >
                      {badgeCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>

          {/* Page Canvas */}
          <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
