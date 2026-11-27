"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { SmileLogo } from "@/components/landing/smile-logo";

export const SMILE_CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#6C5CE7",
    colorPrimaryForeground: "#FFFFFF",
    colorForeground: "#0F172A",
    colorMutedForeground: "#475569",
    colorBackground: "#FFFFFF",
    colorInput: "#F8FAFC",
    colorInputForeground: "#0F172A",
    colorBorder: "#E2E8F0",
    colorRing: "rgba(108, 92, 231, 0.28)",
    borderRadius: "0.875rem",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  },
  options: {
    socialButtonsVariant: "blockButton" as const,
    socialButtonsPlacement: "top" as const,
  },
  elements: {
    rootBox: "!w-full",
    cardBox:
      "!w-full !max-w-none !shadow-none !rounded-[26px] !border !border-slate-200/90 !overflow-hidden bg-white",
    card: "!w-full !max-w-none !shadow-none !border-0 !rounded-none bg-white p-6 sm:p-7",
    headerTitle:
      "font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950",
    headerSubtitle: "text-sm text-slate-600",
    socialButtonsBlockButton:
      "h-11 rounded-full border border-slate-200 bg-[#F7F9FC] text-sm font-medium text-slate-800 hover:bg-[#EEF7FD] transition-colors !shadow-none",
    socialButtonsBlockButtonText: "font-medium text-slate-800",
    dividerLine: "bg-slate-200",
    dividerText: "text-xs font-medium text-slate-500",
    formFieldLabel: "text-[13px] font-semibold text-slate-800",
    formFieldInput:
      "h-11 rounded-xl border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-950 placeholder:text-slate-400 focus:bg-white focus:border-[#6C5CE7] !shadow-none",
    formButtonPrimary:
      "h-11 rounded-full bg-[#6C5CE7] text-sm font-semibold text-white hover:bg-[#5B4BD6] !shadow-none transition-colors",
    footer:
      "bg-[#F7F9FC] border-t border-slate-100 !rounded-none px-6 py-4",
    footerActionText: "text-sm text-slate-600",
    footerActionLink: "text-sm font-semibold text-[#5B4BD6] hover:text-[#4332B8]",
    identityPreviewEditButton: "text-[#5B4BD6] hover:text-[#4332B8]",
    formResendCodeLink: "text-[#5B4BD6] hover:text-[#4332B8]",
  },
};

interface AuthPageShellProps {
  mode: "sign-in" | "sign-up";
  children: ReactNode;
}

const HIGHLIGHTS = [
  {
    icon: CalendarCheck2,
    title: "Dual-Resource Sync",
    detail: "Dentists & chairs matched atomically",
  },
  {
    icon: LockKeyhole,
    title: "5-Minute Slot Hold",
    detail: "Collision-free patient checkout",
  },
  {
    icon: ShieldCheck,
    title: "Strict Isolation",
    detail: "Role-scoped multi-clinic access",
  },
];

export function AuthPageShell({ mode, children }: AuthPageShellProps) {
  const isSignIn = mode === "sign-in";

  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-white text-slate-950 lg:grid-cols-12">
      {/* Left Branded Editorial Photography Panel (Desktop) */}
      <aside className="relative hidden p-4 lg:col-span-6 lg:flex xl:col-span-6">
        <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[32px] bg-slate-900 p-9 xl:p-11">
          <Image
            src={
              isSignIn
                ? "/images/hero-dental-smile.jpg"
                : "/images/modern-dental-suite.jpg"
            }
            alt={
              isSignIn
                ? "Smiling dental patient relaxing in a bright modern dental clinic"
                : "Bright contemporary dental operatory suite ready for patients"
            }
            fill
            priority
            fetchPriority="high"
            sizes="50vw"
            className="object-cover object-center"
          />

          {/* Neutral Legibility Scrim */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-slate-950/88 via-slate-950/40 to-slate-950/35"
          />

          {/* Top Bar Inside Photo */}
          <div className="relative z-10 flex items-center justify-between gap-4">
            <Link
              href="/"
              aria-label="Smile Home"
              className="inline-flex items-center rounded-full bg-white/14 px-4 py-2 backdrop-blur-md transition-colors hover:bg-white/22"
            >
              <SmileLogo inverted />
            </Link>

            <Link
              href="/clinics"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#EFEBFF]"
            >
              <span>Browse Clinics</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>

          {/* Bottom Editorial Statement + Highlights */}
          <div className="relative z-10 max-w-lg">
            <h1 className="font-heading text-4xl leading-[1.08] font-bold tracking-[-0.03em] text-white xl:text-[2.75rem]">
              {isSignIn ? (
                <>
                  Welcome back to
                  <br />
                  effortless dental care
                </>
              ) : (
                <>
                  Modern scheduling
                  <br />
                  built for every clinic
                </>
              )}
            </h1>

            <p className="mt-4 text-base leading-relaxed text-white/88">
              {isSignIn
                ? "Sign in once—Smile automatically routes patients, receptionists, dentists, and clinic admins to their exact workspace."
                : "Create your Smile account to book dental visits for yourself and family dependents, or onboard your dental clinic team."}
            </p>

            {/* 3 Compact Feature Pills */}
            <div className="mt-7 grid grid-cols-3 gap-2.5">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl bg-white/14 p-3.5 text-white backdrop-blur-md"
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-xl bg-white text-[#6C5CE7]">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <p className="mt-2.5 font-heading text-[13px] font-bold leading-snug text-white">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-white/80">
                      {item.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* Right Authentication Form Panel */}
      <div className="flex flex-col justify-between px-4 py-5 sm:px-8 sm:py-7 lg:col-span-6 lg:px-12 lg:py-8">
        {/* Top Utility Navigation */}
        <header className="mx-auto flex w-full max-w-[440px] items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F5F7FA] px-3.5 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-[#EAF1F8] hover:text-slate-950"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Home</span>
          </Link>

          <Link
            href="/"
            aria-label="Smile Home"
            className="inline-flex shrink-0 items-center rounded-full bg-[#F5F7FA] px-3.5 py-1.5 lg:hidden"
          >
            <SmileLogo />
          </Link>

          <Link
            href={isSignIn ? "/sign-up" : "/sign-in"}
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[#F1EEFF] px-3.5 py-2 text-[13px] font-semibold text-[#5B4BD6] transition-colors hover:bg-[#6C5CE7] hover:text-white sm:px-4"
          >
            {isSignIn ? (
              <>
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Create account</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </Link>
        </header>

        {/* Main Form Center Stage */}
        <main className="mx-auto my-8 flex w-full max-w-[440px] flex-1 flex-col justify-center">
          {/* Compact Mobile Branded Banner */}
          <div className="mb-6 rounded-[24px] bg-[#EEF7FD] p-5 lg:hidden">
            <h2 className="font-heading text-2xl leading-[1.15] font-bold tracking-[-0.025em] text-slate-950">
              {isSignIn ? "Welcome back to Smile" : "Create your Smile account"}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
              {isSignIn
                ? "Automatic role routing for patients, dentists, front desk, and clinic admins."
                : "Book verified dental clinics or manage your practice schedule in one place."}
            </p>
          </div>

          {/* Desktop Subtle Context Header Above Clerk Card */}
          <div className="mb-5 hidden lg:block">
            <p className="text-sm font-semibold text-[#5B4BD6]">
              {isSignIn ? "Smile Account Access" : "Get Started with Smile"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {isSignIn
                ? "Enter your credentials to continue to your personalized portal."
                : "Takes less than a minute. No credit card required."}
            </p>
          </div>

          {/* Clerk Form / Fallback Content */}
          <div className="w-full">{children}</div>

          {/* Patient Quick-Escape Helper */}
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-[#F7F9FC] px-4 py-3.5 text-[13px]">
            <span className="text-slate-700">
              Looking for a dental clinic first?
            </span>
            <Link
              href="/clinics"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold text-[#5B4BD6] hover:text-[#4332B8]"
            >
              <span>Explore directory</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </main>

        {/* Minimal Footer */}
        <footer className="mx-auto flex w-full max-w-[440px] flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-500">
          <span>© 2026 Smile Dental Scheduling System</span>
          <span className="inline-flex items-center gap-1 text-slate-600">
            <ShieldCheck className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
            Secured by Clerk
          </span>
        </footer>
      </div>
    </div>
  );
}
