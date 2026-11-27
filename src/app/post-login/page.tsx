"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { AlertTriangle, LifeBuoy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountDeactivatedCard } from "@/components/auth/account-deactivated-card";
import { SmileLogo } from "@/components/landing/smile-logo";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";

const ROLE_HOME = {
  super_admin: "/super-admin",
  clinic_admin: "/admin",
  receptionist: "/front-desk",
  dentist: "/staff",
  patient: "/patient",
} as const;

function isDeactivatedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("deactivated") || lower.includes("inactive");
}

function PostLoginRedirector() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const syncStartedRef = useRef(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || user !== null || syncStartedRef.current) return;
    let cancelled = false;
    syncStartedRef.current = true;
    void ensureUser().catch((err: unknown) => {
      if (!cancelled) {
        setSyncError(getErrorMessage(err, "Unable to sync your account."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, ensureUser]);

  useEffect(() => {
    if (user && user.isActive) router.replace(ROLE_HOME[user.role]);
  }, [user, router]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);

  if (user && !user.isActive) {
    return <AccountDeactivatedCard />;
  }

  if (syncError) {
    if (isDeactivatedMessage(syncError)) {
      return <AccountDeactivatedCard reason={syncError} />;
    }

    return (
      <div className="flex min-h-screen w-full flex-1 flex-col bg-[#F6F8FB] text-slate-950">
        <header className="flex items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/">
            <SmileLogo />
          </Link>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-8">
          <section className="w-full overflow-hidden rounded-[26px] border border-slate-200/85 bg-white">
            <div className="h-1.5 w-full bg-amber-500" />
            <div className="space-y-5 p-6 text-center sm:p-8">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600">
                <AlertTriangle className="size-6" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-950">
                  Unable to open your account
                </h1>
                <p className="text-sm text-slate-600">{syncError}</p>
              </div>
              <div className="space-y-2">
                <Button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="h-10 w-full rounded-full bg-[#6C5CE7] text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                >
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Try Again
                </Button>
                <Button
                  variant="outline"
                  render={<Link href="/support" />}
                  className="h-10 w-full rounded-full border-slate-200 text-xs font-semibold"
                >
                  <LifeBuoy className="mr-1.5 size-3.5" />
                  Contact User Support
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-3 bg-[#F6F8FB] p-6 text-sm text-slate-500">
      <div className="size-7 animate-spin rounded-full border-2 border-slate-300 border-t-[#6C5CE7]" />
      <span>Setting up your account…</span>
    </main>
  );
}

/** Post-sign-in landing: waits for the Clerk webhook/sync, then routes by role. */
export default function PostLoginPage() {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Configure Clerk and Convex keys in <code>.env.local</code> to complete
        sign-in routing.
      </main>
    );
  }

  return <PostLoginRedirector />;
}
