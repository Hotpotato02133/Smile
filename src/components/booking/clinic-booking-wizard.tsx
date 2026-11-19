"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  formatDateTime,
  formatMinutes12h,
  formatPhp,
  getErrorMessage,
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
};

type BookingConfirmation = {
  appointmentId: Id<"appointments">;
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
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((heldSlot.expiresAtUtc - Date.now()) / 1000))
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((heldSlot.expiresAtUtc - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(id);
        onExpired();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [heldSlot.expiresAtUtc, onExpired]);

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
  const portal = useQuery(api.publicBooking.getPublicClinicBySlug, {
    slug: clinicSlug,
  });

  const acquireLock = useMutation(api.slotLocks.acquireLock);
  const releaseSessionLock = useMutation(api.slotLocks.releaseSessionLock);
  const createOnlineBooking = useMutation(
    api.publicBooking.createOnlineBooking
  );
  const joinWaitlist = useMutation(api.waitlist.joinWaitlist);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const [sessionId] = useState<string>(() => getOrCreateSessionId());
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedServiceId, setSelectedServiceId] =
    useState<Id<"services"> | null>(null);
  const [preferredDentistId, setPreferredDentistId] = useState<
    Id<"dentists"> | "any"
  >("any");
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [heldSlot, setHeldSlot] = useState<HeldSlot | null>(null);
  const [lockingSlotStart, setLockingSlotStart] = useState<number | null>(null);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null
  );

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

  const openDayNumbers = new Set(
    clinic.operatingHours.filter((h) => h.isOpen).map((h) => h.dayOfWeek)
  );
  const categories = Array.from(new Set(services.map((s) => s.category)));
  const visibleServices =
    categoryFilter === "all"
      ? services
      : services.filter((s) => s.category === categoryFilter);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const handleSelectSlot = async (slot: {
    startTimeUtc: number;
    dentistId: Id<"dentists">;
    chairId: Id<"chairs">;
  }) => {
    if (!selectedService) return;
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

  const handleHoldExpired = () => {
    setHeldSlot(null);
    setStep(2);
    toast.warning(
      "Your 5-minute slot reservation expired. Please choose an available time slot."
    );
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
      toast.success(`Appointment confirmed (${result.referenceCode}).`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not finalize booking."));
    } finally {
      setSubmittingBooking(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 lg:px-6 lg:py-8">
      {/* Branded Clinic Header Card */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div
          className="h-2 w-full"
          style={{ backgroundColor: clinic.primaryColorHex }}
        />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: clinic.primaryColorHex }}
            >
              {clinic.name.slice(0, 1).toUpperCase()}
            </div>
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
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" />
                  {clinic.phone}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {clinic.cancellationWindowHours}h cancellation notice
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {clinic.operatingHours
              .filter((d) => d.isOpen)
              .map((d) => (
                <Badge key={d.dayOfWeek} variant="outline" className="text-[10px]">
                  {DAY_SHORT_NAMES[d.dayOfWeek]}
                </Badge>
              ))}
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
            <strong>{clinic.phone}</strong>.
          </AlertDescription>
        </Alert>
      ) : (
        <>
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
              heldSlot={heldSlot}
              onExpired={handleHoldExpired}
            />
          ) : null}

          {/* STEP 1 — SELECT DENTAL PROCEDURE */}
          {step === 1 ? (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Select a Dental Procedure
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Transparent base pricing in PHP with real-time operatory
                    chair availability.
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
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="size-3.5" />
                          <span>{svc.durationMinutes} mins</span>
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
                  onClick={() => setStep(1)}
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
                    dentist & chair.
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
                        date < todayMidnight ||
                        !openDayNumbers.has(date.getDay())
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
                      Live dual-resource availability (Dentist + Operatory Chair
                      + {selectedService.bufferMinutes}m sterilization turnover).
                      Clicking a slot holds it for 5 minutes.
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
                      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                        <p>
                          No open dentist & chair slots on {dateKey}. Try
                          another date, choose &ldquo;First Available
                          Dentist&rdquo;, or join the standby waitlist.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={joiningWaitlist}
                          onClick={async () => {
                            setJoiningWaitlist(true);
                            try {
                              await joinWaitlist({
                                clinicId: clinic._id,
                                serviceId: selectedService._id,
                                preferredDentistId:
                                  preferredDentistId === "any"
                                    ? undefined
                                    : preferredDentistId,
                                preferredDateKey: dateKey,
                                preferredTimeWindow: "any",
                              });
                              toast.success(
                                `You're on the standby waitlist for ${dateKey}. We'll email you immediately if a slot opens.`
                              );
                            } catch (err) {
                              toast.error(
                                getErrorMessage(
                                  err,
                                  "Sign in or check if waitlist automation is enabled."
                                )
                              );
                            } finally {
                              setJoiningWaitlist(false);
                            }
                          }}
                        >
                          {joiningWaitlist
                            ? "Joining Waitlist…"
                            : "Join Standby Waitlist"}
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {availability.slots.map((slot) => {
                          const isLocking =
                            lockingSlotStart === slot.startTimeUtc;
                          return (
                            <Button
                              key={slot.startTimeUtc}
                              variant="outline"
                              disabled={lockingSlotStart !== null}
                              className="flex h-auto flex-col items-start gap-0.5 py-2.5 text-left"
                              onClick={() => handleSelectSlot(slot)}
                            >
                              <span className="font-mono text-sm font-semibold">
                                {isLocking
                                  ? "Holding…"
                                  : formatMinutes12h(slot.startMinute)}
                              </span>
                              <span className="w-full truncate text-[11px] font-normal text-muted-foreground">
                                {slot.dentistName}
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
              submitting={submittingBooking}
              onBack={handleReleaseAndGoBackToSlots}
              onSubmit={handleCompleteBooking}
            />
          ) : null}

          {/* STEP 4 — INSTANT CONFIRMATION & CALENDAR EXPORT */}
          {step === 4 && confirmation ? (
            <Card className="border-emerald-500/30">
              <CardHeader>
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" />
                  <span className="text-sm font-semibold uppercase tracking-wide">
                    Appointment Confirmed
                  </span>
                </div>
                <CardTitle className="mt-1 text-2xl">
                  Booking Reference{" "}
                  <span className="font-mono">{confirmation.referenceCode}</span>
                </CardTitle>
                <CardDescription>
                  We look forward to seeing{" "}
                  <strong>{confirmation.patientName}</strong> at{" "}
                  <strong>{confirmation.clinicName}</strong>.
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
                    <p className="text-xs text-muted-foreground">Date & Time</p>
                    <p className="font-medium">
                      {formatDateTime(confirmation.startTimeUtc)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Dentist & Operatory
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
                  or cancel online at least{" "}
                  {confirmation.cancellationWindowHours} hours prior to your
                  visit. Questions? Call {confirmation.clinicPhone}.
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
            <AlertTitle>Connect Convex & Clerk to enable online booking</AlertTitle>
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
