"use client";

import { useClerk, useSession, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  LogOut,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SmileLogo } from "@/components/landing/smile-logo";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";

type InviteRole = "super_admin" | "clinic_admin" | "dentist" | "receptionist";

const ROLE_META: Record<
  InviteRole,
  {
    label: string;
    homePath: string;
    badgeClass: string;
    highlights: string[];
  }
> = {
  super_admin: {
    label: "Super Admin",
    homePath: "/super-admin",
    badgeClass: "border-[#6C5CE7]/25 bg-[#F1EEFF] text-[#4F3EC7]",
    highlights: [
      "Provision and manage multi-tenant dental clinics",
      "Track SaaS MRR, GCash/Bank invoices, and subscription gates",
      "Monitor zero-cost quotas and immutable platform audit logs",
    ],
  },
  clinic_admin: {
    label: "Clinic Admin",
    homePath: "/admin",
    badgeClass: "border-sky-200 bg-[#EEF7FD] text-sky-900",
    highlights: [
      "Configure dentists, weekly shifts, operatory chairs, and services",
      "Invite clinic receptionists and associate dentists",
      "Monitor clinic schedule utilization and patient recall reports",
    ],
  },
  dentist: {
    label: "Dentist",
    homePath: "/staff",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    highlights: [
      "View your real-time patient chair queue and check-ins",
      "Chart procedures on the interactive 32-tooth SVG Odontogram",
      "Review patient medical intake, allergies, and X-ray files",
    ],
  },
  receptionist: {
    label: "Receptionist",
    homePath: "/front-desk",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
    highlights: [
      "Manage the multi-dentist clinic calendar and walk-in bookings",
      "Move patients smoothly through the live Check-In Kanban board",
      "Fill cancellations quickly using the clinic waitlist",
    ],
  },
};

function ConnectedInviteView({ token }: { token: string }) {
  const router = useRouter();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const { user, isLoaded: clerkLoaded } = useUser();
  const { session } = useSession();
  const { signOut } = useClerk();

  const [nowMs, setNowMs] = useState<number>(0);
  const [showDeclineBox, setShowDeclineBox] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(
    null
  );
  const [completedRole, setCompletedRole] = useState<{
    role: InviteRole;
    homePath: string;
  } | null>(null);
  const [declinedDone, setDeclinedDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
      const params = new URLSearchParams(window.location.search);
      if (params.get("action") === "decline") {
        setShowDeclineBox(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const invitation = useQuery(api.invitations.getInvitationByToken, {
    token,
    nowMs: nowMs > 0 ? nowMs : undefined,
  });
  const acceptInvitation = useMutation(api.invitations.acceptInvitation);
  const declineInvitation = useMutation(api.invitations.declineInvitation);

  const signedInEmail = (
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    ""
  )
    .trim()
    .toLowerCase();

  const authReady = clerkLoaded && !convexAuthLoading;
  const isSignedIn = authReady && isAuthenticated && Boolean(user);
  const emailMatches =
    Boolean(invitation) &&
    Boolean(signedInEmail) &&
    signedInEmail === invitation?.email.trim().toLowerCase();

  const handleAccept = async () => {
    setSubmitting("accept");
    try {
      const res = await acceptInvitation({ token });
      setCompletedRole({
        role: res.role as InviteRole,
        homePath: res.homePath,
      });
      toast.success(`Role activated! Redirecting to your workspace…`);

      // Refresh Clerk session token so edge proxy reads the updated role claim
      try {
        await user?.reload();
        await session?.reload();
      } catch {
        // Fallback: /post-login resolves directly from Convex if claim is still syncing
      }

      window.setTimeout(() => {
        router.replace(res.homePath);
      }, 900);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not accept invitation."));
    } finally {
      setSubmitting(null);
    }
  };

  const handleDecline = async () => {
    setSubmitting("decline");
    try {
      await declineInvitation({
        token,
        reason: declineReason.trim() || undefined,
      });
      setDeclinedDone(true);
      toast.success("Invitation declined.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not decline invitation."));
    } finally {
      setSubmitting(null);
    }
  };

  const handleSwitchAccount = async () => {
    const returnUrl = `/invite/${encodeURIComponent(token)}`;
    await signOut({ redirectUrl: returnUrl });
  };

  const inviteReturnPath = `/invite/${encodeURIComponent(token)}`;
  const signUpHref = `/sign-up?redirect_url=${encodeURIComponent(inviteReturnPath)}`;
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(inviteReturnPath)}`;

  return (
    <div className="flex min-h-screen flex-col bg-[#F6F8FB] text-slate-950">
      {/* Calm Header */}
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/">
          <SmileLogo />
        </Link>
        <Link
          href="/"
          className="text-xs font-semibold text-slate-600 transition-colors hover:text-slate-950"
        >
          Back to Smile Home
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-8 sm:px-6">
        <div className="w-full overflow-hidden rounded-[26px] border border-slate-200/85 bg-white">
          {/* Brand Top Accent Strip */}
          <div
            className="h-2 w-full"
            style={{
              backgroundColor:
                invitation?.clinic?.primaryColorHex ?? "#6C5CE7",
            }}
          />

          <div className="p-6 sm:p-8">
            {invitation === undefined ? (
              <div className="space-y-4 py-4">
                <div className="h-5 w-32 animate-pulse rounded-full bg-slate-100" />
                <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-11 w-full animate-pulse rounded-full bg-slate-100" />
              </div>
            ) : invitation === null ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                  <XCircle className="size-6" />
                </div>
                <h1 className="mt-4 text-xl font-bold text-slate-950">
                  Invitation link not found
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  This invitation link is invalid or has been removed. Ask your
                  Smile administrator to send a fresh invitation.
                </p>
                <div className="mt-6">
                  <Button
                    render={<Link href="/" />}
                    className="h-10 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Return to Smile Home
                  </Button>
                </div>
              </div>
            ) : completedRole ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="size-6" />
                </div>
                <h1 className="mt-4 text-xl font-bold text-slate-950">
                  Welcome to Smile as a {ROLE_META[completedRole.role].label}!
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Your account role has been activated. Opening your workspace
                  now…
                </p>
                <div className="mt-6">
                  <Button
                    render={<Link href={completedRole.homePath} />}
                    className="h-10 rounded-full bg-[#6C5CE7] px-6 text-sm font-semibold text-white hover:bg-[#5B4BD6]"
                  >
                    Open Workspace
                    <ArrowRight className="ml-1.5 size-4" />
                  </Button>
                </div>
              </div>
            ) : declinedDone || invitation.status === "declined" ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <XCircle className="size-6" />
                </div>
                <h1 className="mt-4 text-xl font-bold text-slate-950">
                  Invitation declined
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  You declined the{" "}
                  <strong>{ROLE_META[invitation.role].label}</strong> invitation
                  for{" "}
                  <strong>
                    {invitation.clinic?.name ?? "Smile Dental SaaS Platform"}
                  </strong>
                  . Your administrator has been notified.
                </p>
                <div className="mt-6">
                  <Button
                    variant="outline"
                    render={<Link href="/" />}
                    className="h-10 rounded-full border-slate-200 px-6 text-sm font-semibold"
                  >
                    Return to Smile Home
                  </Button>
                </div>
              </div>
            ) : invitation.status === "accepted" ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="size-6" />
                </div>
                <h1 className="mt-4 text-xl font-bold text-slate-950">
                  Invitation already accepted
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  This{" "}
                  <strong>{ROLE_META[invitation.role].label}</strong> invitation
                  for <span className="font-mono">{invitation.email}</span> has
                  already been activated.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <Button
                    render={
                      <Link
                        href={
                          isSignedIn
                            ? ROLE_META[invitation.role].homePath
                            : "/sign-in"
                        }
                      />
                    }
                    className="h-10 rounded-full bg-[#6C5CE7] px-6 text-sm font-semibold text-white hover:bg-[#5B4BD6]"
                  >
                    {isSignedIn ? "Open My Dashboard" : "Sign In to My Account"}
                    <ArrowRight className="ml-1.5 size-4" />
                  </Button>
                </div>
              </div>
            ) : invitation.status === "revoked" ||
              invitation.status === "expired" ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <CalendarClock className="size-6" />
                </div>
                <h1 className="mt-4 text-xl font-bold text-slate-950">
                  {invitation.status === "expired"
                    ? "This invitation has expired"
                    : "This invitation was revoked"}
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Please contact{" "}
                  <strong>{invitation.inviterName}</strong> to send a new
                  invitation to{" "}
                  <span className="font-mono">{invitation.email}</span>.
                </p>
                <div className="mt-6">
                  <Button
                    variant="outline"
                    render={<Link href="/" />}
                    className="h-10 rounded-full border-slate-200 px-6 text-sm font-semibold"
                  >
                    Back to Smile Home
                  </Button>
                </div>
              </div>
            ) : (
              /* PENDING INVITATION — ACTIVE REVIEW & ACCEPT / DECLINE */
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-0.5 text-xs font-semibold ${ROLE_META[invitation.role].badgeClass}`}
                    >
                      {ROLE_META[invitation.role].label}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      Expires {formatDate(invitation.expiresAt)}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                    You&apos;re invited to join{" "}
                    {invitation.clinic?.name ?? "Smile Platform"}
                  </h1>
                  <p className="text-sm text-slate-600">
                    <strong>{invitation.inviterName}</strong> assigned you the{" "}
                    <strong>{ROLE_META[invitation.role].label}</strong> role on
                    Smile Dental Scheduling.
                  </p>
                </div>

                {/* Metadata Box */}
                <div className="space-y-2.5 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-4 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <Mail className="size-3.5" />
                      Invited Email
                    </span>
                    <span className="font-mono font-semibold text-slate-900">
                      {invitation.email}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <Building2 className="size-3.5" />
                      Workspace Scope
                    </span>
                    <span className="font-semibold text-slate-900">
                      {invitation.clinic
                        ? `${invitation.clinic.name} (${invitation.clinic.city})`
                        : "Smile SaaS Platform (All Clinics)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <ShieldCheck className="size-3.5" />
                      Role Access
                    </span>
                    <span className="font-semibold text-slate-900">
                      {ROLE_META[invitation.role].label}
                    </span>
                  </div>
                </div>

                {/* Personal Note from Inviter */}
                {invitation.inviterNote ? (
                  <div className="rounded-2xl border-l-4 border-[#6C5CE7] bg-[#F8FAFC] px-4 py-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      Note from {invitation.inviterName}
                    </p>
                    <p className="mt-1 leading-relaxed">
                      {invitation.inviterNote}
                    </p>
                  </div>
                ) : null}

                {/* What this role unlocks */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">
                    What you&apos;ll be able to do:
                  </p>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {ROLE_META[invitation.role].highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-[#6C5CE7]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Auth-Aware Action Controls */}
                {!authReady ? (
                  <div className="h-11 w-full animate-pulse rounded-full bg-slate-100" />
                ) : isSignedIn && !emailMatches ? (
                  /* Wrong Email Signed In Guard */
                  <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                    <div className="flex items-start gap-2.5 text-xs text-amber-950">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-semibold">
                          Signed in with a different email
                        </p>
                        <p className="mt-0.5 text-amber-900/85">
                          This invite is reserved for{" "}
                          <span className="font-mono font-semibold">
                            {invitation.email}
                          </span>
                          , but you&apos;re currently signed in as{" "}
                          <span className="font-mono font-semibold">
                            {signedInEmail}
                          </span>
                          .
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={handleSwitchAccount}
                      className="h-10 w-full rounded-full bg-slate-950 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      <LogOut className="mr-1.5 size-3.5" />
                      Sign Out &amp; Switch to {invitation.email}
                    </Button>
                  </div>
                ) : isSignedIn && emailMatches ? (
                  /* Signed In with Exact Invited Email */
                  <div className="space-y-3">
                    <Button
                      type="button"
                      disabled={submitting !== null}
                      onClick={handleAccept}
                      className="h-11 w-full rounded-full bg-[#6C5CE7] text-sm font-semibold text-white hover:bg-[#5B4BD6]"
                    >
                      {submitting === "accept"
                        ? "Activating your role…"
                        : `Accept & Open ${ROLE_META[invitation.role].label} Workspace`}
                      <ArrowRight className="ml-1.5 size-4" />
                    </Button>
                    {!showDeclineBox ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={submitting !== null}
                        onClick={() => setShowDeclineBox(true)}
                        className="h-9 w-full rounded-full text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        Decline this invitation
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  /* Signed Out — First-Time or Returning User */
                  <div className="space-y-3">
                    <Button
                      render={<Link href={signUpHref} />}
                      className="h-11 w-full rounded-full bg-[#6C5CE7] text-sm font-semibold text-white hover:bg-[#5B4BD6]"
                    >
                      Accept &amp; Create Account with {invitation.email}
                      <ArrowRight className="ml-1.5 size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      render={<Link href={signInHref} />}
                      className="h-10 w-full rounded-full border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      Already have a Smile account? Sign In to Accept
                    </Button>
                    {!showDeclineBox ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowDeclineBox(true)}
                        className="h-9 w-full rounded-full text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        Decline this invitation
                      </Button>
                    ) : null}
                  </div>
                )}

                {/* Inline Decline Confirmation Box */}
                {showDeclineBox ? (
                  <div className="space-y-3 rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4">
                    <p className="text-xs font-semibold text-rose-950">
                      Decline this invitation?
                    </p>
                    <textarea
                      rows={2}
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="Optional note for the administrator (e.g. Sent to wrong email)"
                      className="flex w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-rose-400"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={submitting !== null}
                        onClick={() => setShowDeclineBox(false)}
                        className="h-8 rounded-full px-3 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={submitting !== null}
                        onClick={handleDecline}
                        className="h-8 rounded-full px-4 text-xs font-semibold"
                      >
                        {submitting === "decline"
                          ? "Declining…"
                          : "Confirm Decline"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function InviteAcceptanceView({ token }: { token: string }) {
  const { isConfigured } = useEnvConfig();
  if (!isConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] p-6 text-sm text-slate-600">
        Configure Clerk and Convex environment keys to open role invitations.
      </div>
    );
  }
  return <ConnectedInviteView token={token} />;
}
