"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BellRing,
  Calendar,
  FileHeart,
  Home,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "cn";
import { AccountDeactivatedCard } from "@/components/auth/account-deactivated-card";
import { SmileLogo } from "@/components/landing/smile-logo";
import { getErrorMessage } from "@/lib/format";
import { AppointmentsView } from "@/components/patient/appointments-view";
import { FamilyHealthView } from "@/components/patient/family-health-view";
import { OverviewView } from "@/components/patient/overview-view";
import { RecordsView } from "@/components/patient/records-view";
import type { PatientNavTab } from "@/components/patient/types";
import { WaitlistView } from "@/components/patient/waitlist-view";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "../../../convex/_generated/api";

const NAV_ITEMS: Array<{
  id: PatientNavTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "appointments", label: "Appointments", icon: Calendar },
  { id: "family", label: "Family & Health", icon: Users },
  { id: "records", label: "Dental Records", icon: FileHeart },
  { id: "waitlist", label: "Waitlist", icon: BellRing },
];

function ConnectedPatientPortal() {
  const [activeTab, setActiveTab] = useState<PatientNavTab>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [familyCreateOpen, setFamilyCreateOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(0);
  const [deactivatedReason, setDeactivatedReason] = useState<string | null>(
    null
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      setNowMs(Math.floor(Date.now() / 60_000) * 60_000);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const currentUser = useQuery(
    api.users.current,
    isAuthenticated ? {} : "skip"
  );
  const isDeactivated = Boolean(
    deactivatedReason || (currentUser && !currentUser.isActive)
  );

  const data = useQuery(
    api.patientPortal.getDashboardData,
    isAuthenticated &&
      nowMs > 0 &&
      currentUser !== undefined &&
      !isDeactivated
      ? { nowMs }
      : "skip"
  );

  useEffect(() => {
    if (!isAuthenticated || currentUser !== null) return;
    let cancelled = false;
    void ensureUser()
      .then((res) => {
        if (!cancelled && res && !res.isActive) {
          setDeactivatedReason("User account is deactivated.");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = getErrorMessage(err, "");
        if (
          msg.toLowerCase().includes("deactivated") ||
          msg.toLowerCase().includes("inactive")
        ) {
          setDeactivatedReason(msg);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentUser, ensureUser]);

  const upcomingCount = (data?.appointments ?? []).filter(
    (a) =>
      a.status === "checked_in" ||
      a.status === "in_chair" ||
      ((a.status === "confirmed" || a.status === "pending_approval") &&
        a.endTimeUtc >= nowMs)
  ).length;

  const notifiedWaitlistCount = (data?.waitlist ?? []).filter(
    (w) => w.status === "notified"
  ).length;

  const handleQuickAddFamily = () => {
    setActiveTab("family");
    setFamilyCreateOpen(true);
  };

  if (isDeactivated) {
    return <AccountDeactivatedCard reason={deactivatedReason} />;
  }

  if (authLoading || (isAuthenticated && currentUser === undefined)) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#F6F8FB] p-6">
        <div className="space-y-4 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#6C5CE7]" />
          <p className="text-sm font-medium text-slate-500">Loading your patient workspace…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col bg-[#F6F8FB]">
        <header className="flex items-center justify-between px-6 py-4">
          <Link href="/">
            <SmileLogo />
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-9 items-center rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white shadow-sm"
          >
            Sign In
          </Link>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 items-center p-6">
          <Alert className="rounded-[24px] bg-white p-6 shadow-sm border-slate-200">
            <ShieldCheck className="size-5 text-[#6C5CE7]" />
            <AlertTitle className="text-base font-bold text-slate-900">Sign-in Required</AlertTitle>
            <AlertDescription className="mt-1 text-xs text-slate-600">
              Please sign in to your Smile account to view and manage your dental appointments and family profiles.
            </AlertDescription>
            <div className="mt-4">
              <Link
                href="/sign-in"
                className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-slate-950 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Sign In to Patient Portal
              </Link>
            </div>
          </Alert>
        </main>
      </div>
    );
  }

  const renderNavLinks = (onSelect?: () => void) => (
    <nav aria-label="Patient portal sections" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        const badgeCount =
          item.id === "appointments"
            ? upcomingCount
            : item.id === "waitlist"
              ? notifiedWaitlistCount
              : 0;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              onSelect?.();
            }}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-medium transition-colors cursor-pointer",
              isActive
                ? "bg-[#E9ECF2] font-semibold text-slate-950"
                : "text-slate-600 hover:bg-[#EDF1F7] hover:text-slate-950"
            )}
          >
            <span className="inline-flex items-center gap-2.5">
              <Icon
                className={cn(
                  "size-4",
                  isActive ? "text-[#6C5CE7]" : "text-slate-500"
                )}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </span>
            {badgeCount > 0 ? (
              <span
                className={cn(
                  "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                  item.id === "waitlist"
                    ? "bg-[#6C5CE7] text-white"
                    : "bg-white text-slate-900"
                )}
              >
                {badgeCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full bg-[#F6F8FB] text-slate-950">
      {/* Desktop Tinted-Frame Sidebar Rail */}
      <aside className="hidden w-[252px] shrink-0 flex-col justify-between p-4 lg:flex">
        <div className="space-y-6">
          {/* Brand + Workspace Scope */}
          <div className="flex items-center justify-between px-2 pt-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <SmileLogo />
            </Link>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
              Patient
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="px-3 text-xs font-medium text-slate-500">
              Care Workspace
            </p>
            {renderNavLinks()}
          </div>

          <div className="space-y-1.5 pt-2">
            <p className="px-3 text-xs font-medium text-slate-500">Explore</p>
            <Link
              href="/clinics"
              className="flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950"
            >
              <span className="inline-flex items-center gap-2.5">
                <Search className="size-4 text-slate-500" aria-hidden="true" />
                <span>Find Clinics</span>
              </span>
              <ArrowUpRight className="size-3.5 text-slate-400" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-[#EDF1F7] hover:text-slate-950"
            >
              <Home className="size-4 text-slate-500" aria-hidden="true" />
              <span>Smile Home</span>
            </Link>
          </div>
        </div>

        {/* Bottom Signed-In User Row */}
        <div className="rounded-2xl bg-white p-3 border border-slate-200/70">
          <div className="flex items-center gap-2.5">
            <UserButton />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-slate-950">
                {data
                  ? `${data.user.firstName} ${data.user.lastName}`.trim() ||
                    "Patient Account"
                  : "Loading…"}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {data?.user.email ?? "Signed in"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Inset White Sheet on Desktop, Full Width on Mobile) */}
      <div className="flex min-w-0 flex-1 flex-col lg:py-2.5 lg:pr-2.5">
        {/* Mobile Top Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-[#F6F8FB]/95 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger
                aria-label="Open patient navigation"
                className="inline-flex size-9 items-center justify-center rounded-full bg-white text-slate-800 border border-slate-200/80 cursor-pointer"
              >
                <Menu className="size-4" aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="left" className="w-[82vw] max-w-xs bg-[#F6F8FB] p-0">
                <SheetHeader className="border-b border-slate-200/70 px-5 py-4 text-left">
                  <SheetTitle>
                    <SmileLogo />
                  </SheetTitle>
                </SheetHeader>
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div className="space-y-5">
                    {renderNavLinks(() => setMobileMenuOpen(false))}
                    <div className="border-t border-slate-200/70 pt-4 space-y-1">
                      <Link
                        href="/clinics"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex h-10 items-center justify-between rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-white"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <Search className="size-4" aria-hidden="true" />
                          <span>Find Clinics</span>
                        </span>
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                      <Link
                        href="/"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-white"
                      >
                        <Home className="size-4" aria-hidden="true" />
                        <span>Smile Home</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Link href="/">
              <SmileLogo />
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/clinics"
              className="inline-flex h-8 items-center gap-1 rounded-full bg-[#6C5CE7] px-3.5 text-xs font-semibold text-white"
            >
              <span>Book</span>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
            <UserButton />
          </div>
        </header>

        {/* Mobile Horizontal Tab Switcher */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 lg:hidden">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  isActive
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-700 border border-slate-200/75"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* White Sheet Canvas */}
        <main className="flex-1 bg-white px-4 py-6 sm:px-7 sm:py-7 lg:rounded-[24px] lg:border lg:border-slate-200/80 lg:px-9 lg:py-8">
          <div className="mx-auto w-full max-w-[1160px] space-y-6">
            {/* System Announcements targeted to all_users */}
            {data && data.announcements.length > 0 ? (
              <div className="space-y-2">
                {data.announcements.map((a) => (
                  <div
                    key={a._id}
                    className={cn(
                      "flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs",
                      a.severity === "critical"
                        ? "border-rose-200 bg-rose-50 text-rose-900"
                        : a.severity === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-sky-200/80 bg-[#EEF7FD] text-slate-800"
                    )}
                  >
                    <AlertCircle
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <span className="font-bold">{a.title}: </span>
                      <span>{a.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Loading Skeleton or Active Workspace View */}
            {data === undefined ? (
              <div className="space-y-5">
                <div className="h-14 w-72 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-24 w-full animate-pulse rounded-[20px] bg-slate-100" />
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                  <div className="h-72 animate-pulse rounded-[24px] bg-slate-100 lg:col-span-7" />
                  <div className="h-72 animate-pulse rounded-[24px] bg-slate-100 lg:col-span-5" />
                </div>
              </div>
            ) : activeTab === "overview" ? (
              <OverviewView
                data={data}
                nowMs={nowMs}
                onNavigate={setActiveTab}
                onQuickAddFamily={handleQuickAddFamily}
              />
            ) : activeTab === "appointments" ? (
              <AppointmentsView
                data={data}
                nowMs={nowMs}
                onRefreshNow={() => setNowMs(Date.now())}
              />
            ) : activeTab === "family" ? (
              <FamilyHealthView
                data={data}
                createDialogOpen={familyCreateOpen}
                onCreateDialogOpenChange={setFamilyCreateOpen}
              />
            ) : activeTab === "records" ? (
              <RecordsView data={data} />
            ) : (
              <WaitlistView data={data} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export function PatientPortal() {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <div className="flex min-h-screen flex-col bg-[#F6F8FB]">
        <header className="flex items-center justify-between px-6 py-4">
          <Link href="/">
            <SmileLogo />
          </Link>
          <Link
            href="/clinics"
            className="inline-flex h-9 items-center rounded-full bg-white px-4 text-xs font-semibold text-slate-900 border border-slate-200"
          >
            Find Clinics
          </Link>
        </header>
        <main className="mx-auto flex w-full max-w-xl flex-1 items-center p-6">
          <Alert className="rounded-[24px] bg-white">
            <ShieldCheck className="size-4 text-[#6C5CE7]" />
            <AlertTitle>Connect Clerk &amp; Convex to open Patient Portal</AlertTitle>
            <AlertDescription>
              Configure <code>.env.local</code> and run{" "}
              <code>npx convex dev</code> to view your live appointments, family
              dependents, and dental records.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return <ConnectedPatientPortal />;
}
