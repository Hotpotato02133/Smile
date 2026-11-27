"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import {
  ArrowRight,
  Home,
  LifeBuoy,
  LogOut,
  Mail,
  ShieldOff,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SmileLogo } from "@/components/landing/smile-logo";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function SignedInEmailSummary() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "";

  const supportHref = email
    ? `/support?topic=account-reactivation&email=${encodeURIComponent(email)}`
    : "/support?topic=account-reactivation";

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut({ redirectUrl: "/sign-in" });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      {email ? (
        <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <Mail className="size-3.5" />
              Account Email
            </span>
            <span className="truncate font-mono font-semibold text-slate-900">
              {email}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Access Status</span>
            <Badge
              variant="outline"
              className="rounded-full border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700"
            >
              Deactivated
            </Badge>
          </div>
        </div>
      ) : null}

      <div className="space-y-2.5 pt-1">
        <Button
          render={<Link href={supportHref} />}
          className="h-11 w-full rounded-full bg-[#6C5CE7] text-sm font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <LifeBuoy className="mr-1.5 size-4" />
          Contact User Support
          <ArrowRight className="ml-1.5 size-4" />
        </Button>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            disabled={signingOut}
            onClick={handleSignOut}
            className="h-10 rounded-full border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <LogOut className="mr-1.5 size-3.5" />
            {signingOut ? "Signing out…" : "Switch Account"}
          </Button>
          <Button
            variant="outline"
            render={<Link href="/" />}
            className="h-10 rounded-full border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Home className="mr-1.5 size-3.5" />
            Back to Home
          </Button>
        </div>
      </div>
    </>
  );
}

function StaticSupportActions() {
  return (
    <div className="space-y-2.5 pt-1">
      <Button
        render={<Link href="/support?topic=account-reactivation" />}
        className="h-11 w-full rounded-full bg-[#6C5CE7] text-sm font-semibold text-white hover:bg-[#5B4BD6]"
      >
        <LifeBuoy className="mr-1.5 size-4" />
        Contact User Support
        <ArrowRight className="ml-1.5 size-4" />
      </Button>
      <Button
        variant="outline"
        render={<Link href="/" />}
        className="h-10 w-full rounded-full border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
      >
        <Home className="mr-1.5 size-3.5" />
        Back to Home
      </Button>
    </div>
  );
}

export function AccountDeactivatedCard({
  reason,
}: {
  reason?: string | null;
}) {
  const { hasClerk } = useEnvConfig();

  return (
    <div className="flex min-h-screen w-full flex-1 flex-col bg-[#F6F8FB] text-slate-950">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/">
          <SmileLogo />
        </Link>
        <Link
          href="/support?topic=account-reactivation"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-[#6C5CE7]"
        >
          <LifeBuoy className="size-3.5" />
          User Support
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-8 sm:px-6">
        <section className="w-full overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.04)]">
          <div className="space-y-5 p-6 sm:p-8">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-rose-200/80 bg-rose-50 text-rose-600">
                <ShieldOff className="size-6" aria-hidden="true" />
              </div>

              <div className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                  Your account has been deactivated
                </h1>
                <p className="text-sm leading-relaxed text-slate-600">
                  A Smile platform or clinic administrator has temporarily
                  disabled portal access for this account. Your historical
                  records remain safely preserved.
                </p>
              </div>
            </div>

            {reason &&
            reason.toLowerCase() !== "user account is deactivated." &&
            reason.toLowerCase() !== "user account is inactive or missing." ? (
              <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 px-3.5 py-2.5 text-xs text-rose-900">
                {reason}
              </div>
            ) : null}

            {hasClerk ? <SignedInEmailSummary /> : <StaticSupportActions />}

            <p className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
              Think this was a mistake? Reach out to{" "}
              <Link
                href="/support?topic=account-reactivation"
                className="font-semibold text-[#6C5CE7] underline-offset-4 hover:underline"
              >
                Smile User Support
              </Link>{" "}
              to request account reactivation.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
