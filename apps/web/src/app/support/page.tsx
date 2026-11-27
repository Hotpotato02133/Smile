"use client";

import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  HelpCircle,
  LifeBuoy,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { SmileLogo } from "@/components/landing/smile-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@smiledental.app";

const FAQ_ITEMS = [
  {
    q: "Why was my Smile account deactivated?",
    a: "A Super Admin or your Clinic Administrator can deactivate portal access when a staff member changes roles, leaves a clinic, or needs access paused for security verification.",
  },
  {
    q: "Are my dental records or appointment history deleted?",
    a: "No. Deactivating an account only pauses portal sign-in. All clinical logs, schedules, and audit records stay safely preserved.",
  },
  {
    q: "How quickly can my account be reactivated?",
    a: "Once your clinic administrator or Smile platform support verifies your email and role, your account can be re-enabled immediately from the Active Directory.",
  },
] as const;

function SupportContent() {
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic");
  const prefilledEmail = searchParams.get("email")?.trim() ?? "";
  const [copied, setCopied] = useState(false);

  const isReactivation = topic === "account-reactivation";

  const emailSubject = isReactivation
    ? `Account Reactivation Request${prefilledEmail ? ` — ${prefilledEmail}` : ""}`
    : "Smile Dental Support Request";

  const emailBody = isReactivation
    ? [
        "Hello Smile User Support,",
        "",
        "My Smile Dental account is currently deactivated and I would like to request reactivation.",
        "",
        `Account Email: ${prefilledEmail || "[Enter your account email]"}`,
        "Clinic Name: [Enter your clinic name]",
        "Role (Clinic Admin / Dentist / Receptionist / Patient): [Enter your role]",
        "",
        "Additional details:",
        "",
      ].join("\n")
    : [
        "Hello Smile User Support,",
        "",
        `Account Email: ${prefilledEmail || "[Enter your account email]"}`,
        "How can we help?",
        "",
      ].join("\n");

  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      toast.success("Support email copied to clipboard.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy email address.");
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-1 flex-col bg-[#F6F8FB] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/">
            <SmileLogo />
          </Link>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              render={<Link href="/" />}
              className="h-8 rounded-full px-3 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              <ArrowLeft className="mr-1.5 size-3.5" />
              Back to Home
            </Button>
            <Button
              size="sm"
              variant="outline"
              render={<Link href="/sign-in" />}
              className="h-8 rounded-full border-slate-200 bg-white px-3.5 text-xs font-semibold"
            >
              Sign In
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero Card */}
        <section className="overflow-hidden rounded-[26px] border border-slate-200/85 bg-white">
          <div className="h-1.5 w-full bg-[#6C5CE7]" />
          <div className="space-y-5 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="rounded-full border-[#6C5CE7]/25 bg-[#F1EEFF] px-3 py-0.5 text-xs font-semibold text-[#4F3EC7]"
              >
                <LifeBuoy className="mr-1.5 size-3.5" />
                Smile User Support
              </Badge>
              {isReactivation ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-rose-200 bg-rose-50 px-3 py-0.5 text-xs font-semibold text-rose-700"
                >
                  Account Reactivation
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {isReactivation
                  ? "Request Account Reactivation"
                  : "How can we help you today?"}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
                {isReactivation
                  ? "Send a quick message to our platform support team or contact your dental clinic administrator to restore your Smile portal access."
                  : "Get help with account access, clinic workspace invitations, scheduling issues, or billing questions."}
              </p>
            </div>

            {prefilledEmail ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] px-4 py-3 text-xs">
                <span className="text-slate-500">Account needing assistance</span>
                <span className="font-mono font-semibold text-slate-900">
                  {prefilledEmail}
                </span>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <Mail className="size-4 text-[#6C5CE7]" />
                    Email Platform Support
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    Opens your email client pre-filled with your account
                    reactivation details so we can verify and re-enable access
                    quickly.
                  </p>
                  <p className="pt-1 font-mono text-xs font-semibold text-slate-900">
                    {SUPPORT_EMAIL}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    render={<a href={mailtoHref} />}
                    className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                  >
                    <Mail className="mr-1.5 size-3.5" />
                    Send Support Email
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyEmail}
                    className="h-9 rounded-full border-slate-200 bg-white px-3.5 text-xs font-semibold"
                  >
                    {copied ? (
                      <Check className="mr-1.5 size-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="mr-1.5 size-3.5" />
                    )}
                    {copied ? "Copied" : "Copy Email"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <ShieldCheck className="size-4 text-emerald-600" />
                    What to Include
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    <li>• Your registered email address</li>
                    <li>• Your dental clinic name &amp; branch</li>
                    <li>• Your assigned role (Admin, Dentist, Receptionist)</li>
                  </ul>
                </div>

                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Clock className="size-3.5 text-slate-400" />
                  Typical response within 1 business day (Mon–Sat, 8 AM–6 PM PHT)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Common Questions */}
        <section className="rounded-2xl border border-slate-200/85 bg-white p-6">
          <div className="flex items-center gap-2">
            <HelpCircle className="size-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q} className="py-3.5 first:pt-0 last:pb-0">
                <h3 className="text-xs font-semibold text-slate-900">
                  {item.q}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-1 items-center justify-center bg-[#F6F8FB] p-6 text-sm text-slate-500">
          Loading User Support…
        </div>
      }
    >
      <SupportContent />
    </Suspense>
  );
}
