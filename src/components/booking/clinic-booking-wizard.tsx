"use client";

import { SignInButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  BellRing,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  LogIn,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthHeaderControls } from "@/components/auth/auth-header-controls";
import {
  type PatientIntakeSubmitPayload,
  PatientIntakeStep,
} from "@/components/booking/patient-intake-step";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildGoogleCalendarUrl, downloadIcsFile } from "@/lib/calendar-export";
import {
  DAY_SHORT_NAMES,
  dateKeyToLocalDate,
  formatDateTime,
  formatMinutes12h,
  formatOperatingHoursGroups,
  formatPhp,
  getErrorMessage,
  getTodayDateKeyInTimeZone,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type HeldSlot = {
  lockId: Id<"slotLocks">;
  dentistId: Id<"dentists">;
  dentistName: string;
  chairId: Id<"chairs">;
  chairName: string;
  dateKey: string;
  startTimeUtc: number;
  endTimeUtc: number;
  expiresAtUtc: number;
  serverNowUtc: number;
};

type BookingConfirmation = {
  appointmentId: Id<"appointments">;
  status?: "pending_approval" | "confirmed";
  referenceCode: string;
  clinicName: string;
  clinicSlug: string;
  clinicAddress: string;
  clinicPhone: string;
  cancellationWindowHours: number;
  serviceName: string;
  pricePhp: number;
  dentistName: string;
  chairName: string;
  patientName: string;
  startTimeUtc: number;
  endTimeUtc: number;
};

type WaitlistWindow = "any" | "morning" | "afternoon";

function dateToDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr-session";
  const key = "smile_booking_session_id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(key, generated);
  return generated;
}

function SlotHoldBanner({
  heldSlot,
  onExpired,
}: {
  heldSlot: HeldSlot;
  onExpired: () => void;
}) {
  const initialDurationMs = Math.max(
    0,
    heldSlot.expiresAtUtc - heldSlot.serverNowUtc
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.ceil(initialDurationMs / 1000)
  );

  useEffect(() => {
    const localDeadlineMs = Date.now() + initialDurationMs;
    const id = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((localDeadlineMs - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(id);
        onExpired();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [initialDurationMs, onExpired]);

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-950 dark:text-sky-100">
      <div className="flex items-center gap-2">
        <Lock className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span>
          Holding <strong>{formatDateTime(heldSlot.startTimeUtc)}</strong> with{" "}
          <strong>{heldSlot.dentistName}</strong> ({heldSlot.chairName})
        </span>
      </div>
      <Badge variant="secondary" className="font-mono tabular-nums">
        {mins}:{secs} remaining
      </Badge>
    </div>
  );
}

function ConnectedBookingWizard({ clinicSlug }: { clinicSlug: string }) {
  const searchParams = useSearchParams();
  const urlWaitlistId = searchParams.get("waitlistId");
  const urlDateParam = searchParams.get("date");
  const urlPatientId = searchParams.get("patientId");

  const { isAuthenticated } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);

  const portal = useQuery(api.publicBooking.getPublicClinicBySlug, {
    slug: clinicSlug,
  });

  const waitlistEntry = useQuery(
    api.waitlist.getWaitlistEntryForClaim,
    urlWaitlistId && isAuthenticated
      ? { waitlistId: urlWaitlistId as Id<"waitlist"> }
      : "skip"
  );

  const myClinicProfiles = useQuery(
    api.publicBooking.getMyPatientProfilesForClinic,
    isAuthenticated && portal ? { clinicId: portal.clinic._id } : "skip"
  );

  const acquireLock = useMutation(api.slotLocks.acquireLock);
  const releaseSessionLock = useMutation(api.slotLocks.releaseSessionLock);
  const createOnlineBooking = useMutation(
    api.publicBooking.createOnlineBooking
  );
  const joinWaitlist = useMutation(api.waitlist.joinWaitlist);
  const claimWaitlistSlot = useMutation(api.waitlist.claimWaitlistSlot);

  const [sessionId] = useState<string>(() => getOrCreateSessionId());
  const [stepOverride, setStep] = useState<1 | 2 | 3 | 4 | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedServiceOverride, setSelectedServiceId] =
    useState<Id<"services"> | null>(null);
  const [preferredDentistOverride, setPreferredDentistId] = useState<
    Id<"dentists"> | "any" | null
  >(null);
  const [defaultTodayDate] = useState<Date>(() => {
    if (urlDateParam) {
      const parsed = dateKeyToLocalDate(urlDateParam);
      if (parsed) return parsed;
    }
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDateOverride, setSelectedDate] = useState<Date | null>(null);
  const [heldSlot, setHeldSlot] = useState<HeldSlot | null>(null);
  const [lockingSlotStart, setLockingSlotStart] = useState<number | null>(null);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null
  );

  // Standby Waitlist controls
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [waitlistTimeWindow, setWaitlistTimeWindow] =
    useState<WaitlistWindow>("any");
  const [waitlistPatientId, setWaitlistPatientId] = useState<string>("self");

  // Waitlist Claim Mode state
  const [claimModeDismissed, setClaimModeDismissed] = useState(false);
  const [claimingSlotStart, setClaimingSlotStart] = useState<number | null>(
    null
  );

  // Sync Clerk user to Convex immediately if signed in
  useEffect(() => {
    if (isAuthenticated) {
      void ensureUser().catch(() => {});
    }
  }, [isAuthenticated, ensureUser]);

  const activeClaimEntry =
    !claimModeDismissed &&
    waitlistEntry &&
    portal &&
    waitlistEntry.clinicId === portal.clinic._id &&
    (waitlistEntry.status === "notified" || waitlistEntry.status === "waiting")
      ? waitlistEntry
      : null;

  // Derive active selections cleanly (hydrating from waitlist claim link without useEffect setState)
  const step: 1 | 2 | 3 | 4 = stepOverride ?? (activeClaimEntry ? 2 : 1);
  const selectedServiceId =
    selectedServiceOverride ?? activeClaimEntry?.serviceId ?? null;
  const preferredDentistId: Id<"dentists"> | "any" =
    preferredDentistOverride ?? activeClaimEntry?.preferredDentistId ?? "any";
  const selectedDate = useMemo(() => {
    if (selectedDateOverride) return selectedDateOverride;
    if (activeClaimEntry) {
      const parsed = dateKeyToLocalDate(activeClaimEntry.preferredDateKey);
      if (parsed) return parsed;
    }
    return defaultTodayDate;
  }, [selectedDateOverride, activeClaimEntry, defaultTodayDate]);

  const dateKey = useMemo(() => dateToDateKey(selectedDate), [selectedDate]);

  const availability = useQuery(
    api.availability.getAvailableSlots,
    portal && portal.clinic.isBookable && selectedServiceId && step === 2
      ? {
          clinicId: portal.clinic._id,
          serviceId: selectedServiceId,
          dateKey,
          preferredDentistId:
            preferredDentistId === "any" ? undefined : preferredDentistId,
          sessionId,
        }
      : "skip"
  );

  const handleHoldExpired = useCallback(() => {
    setHeldSlot(null);
    setStep(2);
    toast.warning(
      "Your 5-minute slot reservation expired. Please choose an available time slot."
    );
  }, []);

  if (portal === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading clinic booking portal…
      </main>
    );
  }

  if (portal === null) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">Clinic Not Found</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find a dental clinic at <code>/c/{clinicSlug}</code>.
        </p>
        <Button render={<Link href="/clinics" />}>Browse Dental Clinics</Button>
      </main>
    );
  }

  const { clinic, services, dentists } = portal;
  const selectedService =
    services.find((s) => s._id === selectedServiceId) ?? null;
  const selectedDentist =
    preferredDentistId === "any"
      ? null
      : (dentists.find((d) => d._id === preferredDentistId) ?? null);

  const openDayNumbers = new Set(
    clinic.operatingHours.filter((h) => h.isOpen).map((h) => h.dayOfWeek)
  );
  const selectedDentistDays = selectedDentist
    ? new Set(selectedDentist.workingDays)
    : null;
  const operatingHoursGroups = formatOperatingHoursGroups(clinic.operatingHours);

  const categories = Array.from(new Set(services.map((s) => s.category)));
  const visibleServices =
    categoryFilter === "all"
      ? services
      : services.filter((s) => s.category === categoryFilter);

  const clinicTodayKey = getTodayDateKeyInTimeZone(clinic.timezone);
  const clinicTodayDate = dateKeyToLocalDate(clinicTodayKey) ?? new Date();
  clinicTodayDate.setHours(0, 0, 0, 0);

  const handleSelectSlot = async (slot: {
    startTimeUtc: number;
    dentistId: Id<"dentists">;
    chairId: Id<"chairs">;
  }) => {
    if (!selectedService) return;

    // Waitlist Claim Mode: one-click ACID claim straight to Step 4 confirmation
    if (activeClaimEntry && dateKey === activeClaimEntry.preferredDateKey) {
      setClaimingSlotStart(slot.startTimeUtc);
      try {
        const result = await claimWaitlistSlot({
          waitlistId: activeClaimEntry._id,
          startTimeUtc: slot.startTimeUtc,
          dentistId: slot.dentistId,
          chairId: slot.chairId,
          sessionId,
        });
        setHeldSlot(null);
        setConfirmation(result);
        setStep(4);
        toast.success(`Waitlist slot claimed (${result.referenceCode})!`);
      } catch (err) {
        toast.error(
          getErrorMessage(err, "This opening was already claimed by another patient.")
        );
      } finally {
        setClaimingSlotStart(null);
      }
      return;
    }

    // Standard Booking Mode: acquire 5-minute slot lock and advance to Step 3
    setLockingSlotStart(slot.startTimeUtc);
    try {
      const lock = await acquireLock({
        clinicId: clinic._id,
        serviceId: selectedService._id,
        dateKey,
        startTimeUtc: slot.startTimeUtc,
        dentistId: slot.dentistId,
        chairId: slot.chairId,
        sessionId,
      });
      setHeldSlot({
        lockId: lock.lockId,
        dentistId: lock.dentistId,
        dentistName: lock.dentistName,
        chairId: lock.chairId,
        chairName: lock.chairName,
        dateKey,
        startTimeUtc: lock.startTimeUtc,
        endTimeUtc: lock.endTimeUtc,
        expiresAtUtc: lock.expiresAtUtc,
        serverNowUtc: lock.serverNowUtc,
      });
      setStep(3);
      toast.success("Time slot reserved for 5 minutes.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Slot is no longer available."));
    } finally {
      setLockingSlotStart(null);
    }
  };

  const handleReleaseAndGoBackToSlots = async () => {
    setHeldSlot(null);
    setStep(2);
    try {
      await releaseSessionLock({ clinicId: clinic._id, sessionId });
    } catch {
      // Lock auto-releases on TTL even if release fails
    }
  };

  const handleCompleteBooking = async (payload: PatientIntakeSubmitPayload) => {
    if (!selectedService || !heldSlot) return;
    setSubmittingBooking(true);
    try {
      const result = await createOnlineBooking({
        clinicId: clinic._id,
        serviceId: selectedService._id,
        dateKey: heldSlot.dateKey,
        startTimeUtc: heldSlot.startTimeUtc,
        dentistId: heldSlot.dentistId,
        chairId: heldSlot.chairId,
        lockId: heldSlot.lockId,
        sessionId,
        bookingFor: payload.bookingFor,
        existingPatientId: payload.existingPatientId,
        patientProfile: payload.patientProfile,
        chiefComplaint: payload.chiefComplaint,
      });
      setHeldSlot(null);
      setConfirmation(result);
      setStep(4);
      toast.success(
        result.status === "pending_approval"
          ? `Booking request submitted (${result.referenceCode}) — awaiting front-desk approval.`
          : `Appointment confirmed (${result.referenceCode}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not finalize booking."));
    } finally {
      setSubmittingBooking(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!selectedService) return;
    setJoiningWaitlist(true);
    try {
      await joinWaitlist({
        clinicId: clinic._id,
        serviceId: selectedService._id,
        patientId:
          waitlistPatientId !== "self"
            ? (waitlistPatientId as Id<"patients">)
            : undefined,
        preferredDentistId:
          preferredDentistId === "any" ? undefined : preferredDentistId,
        preferredDateKey: dateKey,
        preferredTimeWindow: waitlistTimeWindow,
      });
      toast.success(
        `You're on the standby waitlist for ${dateKey} (${waitlistTimeWindow}). We'll email you immediately if a matching slot opens.`
      );
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          "Could not join waitlist. Please make sure you are signed in."
        )
      );
    } finally {
      setJoiningWaitlist(false);
    }
  };

  const waitlistTimeLabel: Record<WaitlistWindow, string> = {
    any: "Any Time",
    morning: "Morning (< 12 PM)",
    afternoon: "Afternoon (12 PM+)",
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 lg:px-6 lg:py-8">
      {/* Branded Clinic Header Card */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div
          className="h-2 w-full"
          style={{ backgroundColor: clinic.primaryColorHex }}
        />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3.5">
            {clinic.logoUrl ? (
              // Dynamic signed Convex storage URL
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clinic.logoUrl}
                alt={`${clinic.name} logo`}
                className="size-12 shrink-0 rounded-xl border object-cover"
              />
            ) : (
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                style={{ backgroundColor: clinic.primaryColorHex }}
              >
                {clinic.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {clinic.name}
              </h1>
              {clinic.tagline ? (
                <p className="text-sm text-muted-foreground">
                  {clinic.tagline}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {clinic.address}, {clinic.city}, {clinic.province}
                </span>
                <a
                  href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Phone className="size-3.5" />
                  {clinic.phone}
                </a>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {clinic.cancellationWindowHours}h cancellation notice
                </span>
                {clinic.requireBookingApproval ? (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                    · Requires clinic approval
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Clinic Operating Hours with Open/Close Times */}
          <div className="shrink-0 rounded-xl border bg-muted/30 px-3.5 py-2.5 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <Clock className="size-3.5" />
              Operating Hours
            </p>
            {operatingHoursGroups.length === 0 ? (
              <p className="text-muted-foreground">Hours not configured</p>
            ) : (
              <ul className="space-y-0.5 text-muted-foreground">
                {operatingHoursGroups.map((g) => (
                  <li
                    key={`${g.days}-${g.hours}`}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="font-medium text-foreground">{g.days}</span>
                    <span className="tabular-nums">{g.hours}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Suspension / Read-Only Block (Law #4) */}
      {!clinic.isBookable ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Online Booking Temporarily Unavailable</AlertTitle>
          <AlertDescription>
            {clinic.blockedReason ??
              "This clinic is not currently accepting online bookings."}{" "}
            Please contact the clinic directly at{" "}
            <a
              href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`}
              className="font-semibold underline"
            >
              {clinic.phone}
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Waitlist Deep-Link Sign-In Prompt */}
          {urlWaitlistId && !isAuthenticated && step !== 4 ? (
            <Alert className="border-primary/40 bg-primary/5">
              <BellRing className="size-4 text-primary" />
              <AlertTitle>Sign In to Claim Your Waitlist Slot</AlertTitle>
              <AlertDescription className="mt-1 flex flex-wrap items-center justify-between gap-3">
                <span>
                  Sign in to your Smile account to instantly claim your notified
                  opening on {urlDateParam ?? "your waitlisted date"}.
                </span>
                <SignInButton mode="modal">
                  <Button size="sm">
                    <LogIn className="mr-1.5 size-3.5" />
                    Sign In to Claim
                  </Button>
                </SignInButton>
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Already Claimed / Expired Waitlist Notice */}
          {urlWaitlistId &&
          isAuthenticated &&
          waitlistEntry &&
          waitlistEntry.clinicId === clinic._id &&
          (waitlistEntry.status === "claimed" ||
            waitlistEntry.status === "expired") &&
          step !== 4 ? (
            <Alert>
              <BellRing className="size-4" />
              <AlertTitle>
                Waitlist Request{" "}
                {waitlistEntry.status === "claimed" ? "Already Claimed" : "Expired"}
              </AlertTitle>
              <AlertDescription>
                Your waitlist request for{" "}
                <strong>{waitlistEntry.serviceName}</strong> on{" "}
                {waitlistEntry.preferredDateKey} is marked as{" "}
                <strong>{waitlistEntry.status}</strong>. You can still book any
                regular available appointment below.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Active Waitlist Claim Mode Banner */}
          {activeClaimEntry && step !== 4 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-xs">
              <div className="flex items-start gap-2.5">
                <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">
                    Waitlist Claim Mode — {activeClaimEntry.serviceName} for{" "}
                    {activeClaimEntry.patientName}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    Target date: <strong>{activeClaimEntry.preferredDateKey}</strong>{" "}
                    · Preference:{" "}
                    <strong className="capitalize">
                      {activeClaimEntry.preferredTimeWindow}
                    </strong>
                    . Click any open slot on{" "}
                    <strong>{activeClaimEntry.preferredDateKey}</strong> below to
                    claim and confirm instantly.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setClaimModeDismissed(true)}
              >
                <X className="mr-1 size-3.5" />
                Standard Booking
              </Button>
            </div>
          ) : null}

          {/* Step Indicator */}
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { n: 1, label: "1. Procedure" },
              { n: 2, label: "2. Dentist & Time" },
              { n: 3, label: "3. Patient & Intake" },
              { n: 4, label: "4. Confirmed" },
            ].map((item) => {
              const active = step === item.n;
              const done = step > item.n;
              return (
                <li
                  key={item.n}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                        : "bg-muted/30 text-muted-foreground"
                  }`}
                >
                  {item.label}
                </li>
              );
            })}
          </ol>

          {/* Live 5-Minute Slot Hold Countdown */}
          {heldSlot && step === 3 ? (
            <SlotHoldBanner
              key={heldSlot.lockId}
              heldSlot={heldSlot}
              onExpired={handleHoldExpired}
            />
          ) : null}

          {/* STEP 1 — SELECT DENTAL PROCEDURE & MEET DENTISTS */}
          {step === 1 ? (
            <div className="space-y-8">
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Select a Dental Procedure
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Transparent base pricing in PHP with real-time operatory
                      chair availability and sterilization buffers.
                    </p>
                  </div>

                  {categories.length > 1 ? (
                    <Tabs
                      value={categoryFilter}
                      onValueChange={(v) => setCategoryFilter(v)}
                    >
                      <TabsList className="flex-wrap">
                        <TabsTrigger value="all">All</TabsTrigger>
                        {categories.map((cat) => (
                          <TabsTrigger key={cat} value={cat}>
                            {cat}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  ) : null}
                </div>

                {visibleServices.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      This clinic has not published any active dental procedures
                      yet.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleServices.map((svc) => (
                      <Card
                        key={svc._id}
                        className="flex flex-col justify-between transition-colors hover:border-foreground/30"
                      >
                        <CardHeader>
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="secondary">{svc.category}</Badge>
                            <span className="font-mono text-sm font-semibold tabular-nums">
                              {formatPhp(svc.pricePhp)}
                            </span>
                          </div>
                          <CardTitle className="mt-2 text-base">
                            {svc.name}
                          </CardTitle>
                          <CardDescription>{svc.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center justify-between border-t pt-3">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="size-3.5 shrink-0" />
                            <span>
                              {svc.durationMinutes}m
                              {svc.bufferMinutes > 0
                                ? ` (+${svc.bufferMinutes}m prep)`
                                : ""}
                            </span>
                            {svc.requiresXray ? (
                              <Badge variant="outline" className="text-[10px]">
                                X-Ray
                              </Badge>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedServiceId(svc._id);
                              setStep(2);
                            }}
                          >
                            Select
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              {/* Dentist Profiles Showcase */}
              {dentists.length > 0 ? (
                <section className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold">Our Dental Team</h2>
                    <p className="text-sm text-muted-foreground">
                      Meet the licensed dentists available at {clinic.name}.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {dentists.map((d) => (
                      <Card key={d._id} className="flex flex-col justify-between">
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: d.calendarColorHex }}
                            >
                              <Stethoscope className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <CardTitle className="truncate text-sm">
                                {d.displayName}
                              </CardTitle>
                              <CardDescription className="text-xs">
                                {d.workingDays.length > 0
                                  ? `Available: ${d.workingDays
                                      .map((day) => DAY_SHORT_NAMES[day])
                                      .join(", ")}`
                                  : "By appointment"}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2.5 pt-0 text-xs text-muted-foreground">
                          {d.specialties.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {d.specialties.map((spec) => (
                                <Badge
                                  key={spec}
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {spec}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          {d.bio ? (
                            <p className="line-clamp-3 leading-relaxed">
                              {d.bio}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {/* STEP 2 — CHOOSE DENTIST & TIME SLOT */}
          {step === 2 && selectedService ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/25 px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Selected Procedure
                  </p>
                  <p className="font-medium">
                    {selectedService.name} · {selectedService.durationMinutes}{" "}
                    mins · {formatPhp(selectedService.pricePhp)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setClaimModeDismissed(true);
                    setStep(1);
                  }}
                >
                  <ArrowLeft className="mr-1.5 size-3.5" />
                  Change Procedure
                </Button>
              </div>

              {/* Dentist Preference */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Choose Your Dentist
                  </CardTitle>
                  <CardDescription>
                    Select a preferred doctor or pick the first available
                    dentist &amp; chair.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={preferredDentistId === "any" ? "default" : "outline"}
                    onClick={() => setPreferredDentistId("any")}
                  >
                    <Sparkles className="mr-1.5 size-3.5" />
                    First Available Dentist
                  </Button>
                  {dentists.map((d) => (
                    <Button
                      key={d._id}
                      type="button"
                      size="sm"
                      variant={
                        preferredDentistId === d._id ? "default" : "outline"
                      }
                      onClick={() => setPreferredDentistId(d._id)}
                    >
                      <span
                        className="mr-1.5 size-2 rounded-full"
                        style={{ backgroundColor: d.calendarColorHex }}
                      />
                      {d.displayName}
                    </Button>
                  ))}
                </CardContent>
              </Card>

              {/* Date Picker + Real-Time Slot Grid */}
              <div className="grid gap-4 md:grid-cols-[auto_1fr]">
                <Card className="w-fit">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarIcon className="size-4" />
                      Select Date
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => {
                        if (d) setSelectedDate(d);
                      }}
                      disabled={(date) =>
                        date < clinicTodayDate ||
                        !openDayNumbers.has(date.getDay()) ||
                        (selectedDentistDays !== null &&
                          !selectedDentistDays.has(date.getDay()))
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Available Slots for {dateKey}
                    </CardTitle>
                    <CardDescription>
                      {activeClaimEntry &&
                      dateKey === activeClaimEntry.preferredDateKey
                        ? `Waitlist Claim Mode: Click any slot below to instantly claim and confirm for ${activeClaimEntry.patientName}.`
                        : `Live dual-resource availability (Dentist + Operatory Chair + ${selectedService.bufferMinutes}m sterilization turnover). Clicking a slot holds it for 5 minutes.`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {availability === undefined ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        Checking real-time availability…
                      </p>
                    ) : !availability.isBookable ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {availability.blockedReason}
                        </AlertDescription>
                      </Alert>
                    ) : availability.slots.length === 0 ? (
                      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                        <p className="max-w-md">
                          No open dentist &amp; chair slots on{" "}
                          <strong>{dateKey}</strong>. Try another date, switch
                          to &ldquo;First Available Dentist&rdquo;
                          {clinic.waitlistAutomationEnabled
                            ? ", or join the standby waitlist below."
                            : "."}
                        </p>

                        {clinic.waitlistAutomationEnabled ? (
                          <div className="w-full max-w-md space-y-3 rounded-xl border bg-muted/25 p-4 text-left">
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-foreground">
                                Preferred Time Window
                              </p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(["any", "morning", "afternoon"] as const).map(
                                  (win) => (
                                    <Button
                                      key={win}
                                      type="button"
                                      size="sm"
                                      variant={
                                        waitlistTimeWindow === win
                                          ? "default"
                                          : "outline"
                                      }
                                      className="h-8 text-xs"
                                      onClick={() => setWaitlistTimeWindow(win)}
                                    >
                                      {waitlistTimeLabel[win]}
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>

                            {isAuthenticated &&
                            myClinicProfiles &&
                            myClinicProfiles.dependents.length > 0 ? (
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-foreground">
                                  Waitlist For
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                      waitlistPatientId === "self"
                                        ? "secondary"
                                        : "outline"
                                    }
                                    className="h-7 text-xs"
                                    onClick={() => setWaitlistPatientId("self")}
                                  >
                                    Myself
                                  </Button>
                                  {myClinicProfiles.dependents.map((dep) => (
                                    <Button
                                      key={dep._id}
                                      type="button"
                                      size="sm"
                                      variant={
                                        waitlistPatientId === dep._id
                                          ? "secondary"
                                          : "outline"
                                      }
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        setWaitlistPatientId(dep._id)
                                      }
                                    >
                                      {dep.firstName} {dep.lastName}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {!isAuthenticated ? (
                              <SignInButton mode="modal">
                                <Button size="sm" className="w-full">
                                  <LogIn className="mr-1.5 size-3.5" />
                                  Sign In to Join Standby Waitlist
                                </Button>
                              </SignInButton>
                            ) : (
                              <Button
                                size="sm"
                                className="w-full"
                                disabled={joiningWaitlist}
                                onClick={handleJoinWaitlist}
                              >
                                <BellRing className="mr-1.5 size-3.5" />
                                {joiningWaitlist
                                  ? "Joining Waitlist…"
                                  : `Join Standby Waitlist (${waitlistTimeLabel[waitlistTimeWindow]})`}
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {availability.slots.map((slot) => {
                          const isLocking =
                            lockingSlotStart === slot.startTimeUtc;
                          const isClaiming =
                            claimingSlotStart === slot.startTimeUtc;
                          const isClaimTargetDate = Boolean(
                            activeClaimEntry &&
                              dateKey === activeClaimEntry.preferredDateKey
                          );
                          const matchesPreferredWindow =
                            isClaimTargetDate &&
                            activeClaimEntry &&
                            (activeClaimEntry.preferredTimeWindow === "any" ||
                              (activeClaimEntry.preferredTimeWindow ===
                                "morning" &&
                                slot.startMinute < 720) ||
                              (activeClaimEntry.preferredTimeWindow ===
                                "afternoon" &&
                                slot.startMinute >= 720));

                          return (
                            <Button
                              key={slot.startTimeUtc}
                              variant={
                                matchesPreferredWindow ? "default" : "outline"
                              }
                              disabled={
                                lockingSlotStart !== null ||
                                claimingSlotStart !== null
                              }
                              className="flex h-auto flex-col items-start gap-0.5 py-2.5 text-left"
                              onClick={() => handleSelectSlot(slot)}
                            >
                              <span className="font-mono text-sm font-semibold">
                                {isClaiming
                                  ? "Claiming…"
                                  : isLocking
                                    ? "Holding…"
                                    : formatMinutes12h(slot.startMinute)}
                              </span>
                              <span
                                className={`w-full truncate text-[11px] font-normal ${
                                  matchesPreferredWindow
                                    ? "text-primary-foreground/85"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {isClaimTargetDate
                                  ? `Claim · ${slot.dentistName}`
                                  : slot.dentistName}
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>
          ) : null}

          {/* STEP 3 — PATIENT PROFILE & MEDICAL INTAKE */}
          {step === 3 && heldSlot ? (
            <PatientIntakeStep
              clinicId={clinic._id}
              initialPatientId={urlPatientId}
              submitting={submittingBooking}
              onBack={handleReleaseAndGoBackToSlots}
              onSubmit={handleCompleteBooking}
            />
          ) : null}

          {/* STEP 4 — CONFIRMATION OR PENDING APPROVAL & CALENDAR EXPORT */}
          {step === 4 && confirmation ? (
            <Card
              className={
                confirmation.status === "pending_approval"
                  ? "border-amber-500/40"
                  : "border-emerald-500/30"
              }
            >
              <CardHeader>
                {confirmation.status === "pending_approval" ? (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <Clock className="size-5" />
                    <span className="text-sm font-semibold uppercase tracking-wide">
                      Booking Request Pending Approval
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-5" />
                    <span className="text-sm font-semibold uppercase tracking-wide">
                      Appointment Confirmed
                    </span>
                  </div>
                )}
                <CardTitle className="mt-1 text-2xl">
                  Booking Reference{" "}
                  <span className="font-mono">{confirmation.referenceCode}</span>
                </CardTitle>
                <CardDescription>
                  {confirmation.status === "pending_approval" ? (
                    <>
                      Your slot for <strong>{confirmation.patientName}</strong>{" "}
                      at <strong>{confirmation.clinicName}</strong> is reserved
                      pending front-desk approval. You will receive a
                      confirmation email as soon as the clinic approves your
                      request.
                    </>
                  ) : (
                    <>
                      We look forward to seeing{" "}
                      <strong>{confirmation.patientName}</strong> at{" "}
                      <strong>{confirmation.clinicName}</strong>. A confirmation
                      email has been queued to your inbox.
                    </>
                  )}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Procedure</p>
                    <p className="font-medium">
                      {confirmation.serviceName} ({formatPhp(confirmation.pricePhp)})
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date &amp; Time</p>
                    <p className="font-medium">
                      {formatDateTime(confirmation.startTimeUtc)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Dentist &amp; Operatory
                    </p>
                    <p className="inline-flex items-center gap-1.5 font-medium">
                      <Stethoscope className="size-3.5" />
                      {confirmation.dentistName} · {confirmation.chairName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Clinic Address
                    </p>
                    <p className="font-medium">{confirmation.clinicAddress}</p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  <strong>Cancellation Policy:</strong> Please notify the clinic
                  or cancel/reschedule online at least{" "}
                  {confirmation.cancellationWindowHours} hours prior to your
                  visit. Questions? Call{" "}
                  <a
                    href={`tel:${confirmation.clinicPhone.replace(/[^\d+]/g, "")}`}
                    className="font-semibold underline"
                  >
                    {confirmation.clinicPhone}
                  </a>
                  .
                </p>

                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const calEvent = {
                      title: `${confirmation.serviceName} — ${confirmation.clinicName}`,
                      description: `Ref: ${confirmation.referenceCode}\nPatient: ${confirmation.patientName}\nDentist: ${confirmation.dentistName}\nChair: ${confirmation.chairName}`,
                      location: confirmation.clinicAddress,
                      startTimeUtc: confirmation.startTimeUtc,
                      endTimeUtc: confirmation.endTimeUtc,
                      uid: `${confirmation.appointmentId}@smile-dental.app`,
                    };
                    return (
                      <>
                        <Button
                          render={
                            <a
                              href={buildGoogleCalendarUrl(calEvent)}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                        >
                          <CalendarPlus className="mr-1.5 size-4" />
                          Add to Google Calendar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            downloadIcsFile(
                              calEvent,
                              `${confirmation.referenceCode}.ics`
                            )
                          }
                        >
                          <Download className="mr-1.5 size-4" />
                          Download .ICS
                        </Button>
                      </>
                    );
                  })()}
                  <Button variant="outline" render={<Link href="/patient" />}>
                    View My Appointments
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </main>
  );
}

export function ClinicBookingWizard({ clinicSlug }: { clinicSlug: string }) {
  const { isConfigured } = useEnvConfig();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Smile
          </Link>
          <Link
            href="/clinics"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            All Clinics
          </Link>
        </div>
        <AuthHeaderControls />
      </header>

      {!isConfigured ? (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Connect Convex &amp; Clerk to enable online booking</AlertTitle>
            <AlertDescription>
              Configure <code>.env.local</code> and run{" "}
              <code>npx convex dev</code> to load the public booking portal for{" "}
              <code>/c/{clinicSlug}</code>.
            </AlertDescription>
          </Alert>
        </main>
      ) : (
        <ConnectedBookingWizard clinicSlug={clinicSlug} />
      )}
    </div>
  );
}
