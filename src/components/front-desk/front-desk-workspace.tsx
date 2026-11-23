"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { endOfWeek, startOfWeek } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Inbox,
  Kanban,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Users,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Component,
  type ReactNode,
  Suspense,
  useMemo,
  useState,
} from "react";
import type { View } from "react-big-calendar";
import { toast } from "sonner";
import { AddWaitlistDialog } from "@/components/front-desk/add-waitlist-dialog";
import { AppointmentActionDialog } from "@/components/front-desk/appointment-action-dialog";
import {
  type AppointmentStatus,
  type CalendarAppointmentItem,
  MasterCalendar,
} from "@/components/front-desk/master-calendar";
import {
  WalkInBookingDialog,
  type WalkInBookingPrefill,
} from "@/components/front-desk/walk-in-booking-dialog";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  dateToDateKeyInTimeZone,
  formatDate,
  formatTimeInTimeZone,
  getErrorMessage,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type KanbanStatus =
  | "confirmed"
  | "checked_in"
  | "in_chair"
  | "completed"
  | "no_show";

const KANBAN_COLUMNS: {
  id: KanbanStatus;
  title: string;
  subtitle: string;
  statuses: AppointmentStatus[];
  accentClass: string;
}[] = [
  {
    id: "confirmed",
    title: "Scheduled Today",
    subtitle: "Pending / confirmed arrivals",
    statuses: ["pending_approval", "confirmed"],
    accentClass: "border-t-sky-500",
  },
  {
    id: "checked_in",
    title: "Checked In",
    subtitle: "Waiting room",
    statuses: ["checked_in"],
    accentClass: "border-t-indigo-500",
  },
  {
    id: "in_chair",
    title: "In Chair",
    subtitle: "Treatment active",
    statuses: ["in_chair"],
    accentClass: "border-t-emerald-500",
  },
  {
    id: "completed",
    title: "Completed",
    subtitle: "Checkout & recall",
    statuses: ["completed"],
    accentClass: "border-t-slate-500",
  },
  {
    id: "no_show",
    title: "No-Show",
    subtitle: "Missed visits",
    statuses: ["no_show"],
    accentClass: "border-t-orange-500",
  },
];

function toCalendarDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

class FrontDeskErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 items-center p-6">
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>Front Desk access unavailable</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>
                {getErrorMessage(
                  this.state.error,
                  "You do not have permission to access this clinic's Front Desk workspace."
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                render={<Link href="/post-login" />}
              >
                Return to your workspace
              </Button>
            </AlertDescription>
          </Alert>
        </main>
      );
    }
    return this.props.children;
  }
}

function ConnectedFrontDesk({
  overrideClinicId,
}: {
  overrideClinicId?: Id<"clinics">;
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [calendarView, setCalendarView] = useState<View>("day");
  const [draggedApptId, setDraggedApptId] =
    useState<Id<"appointments"> | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);
  const [selectedAppt, setSelectedAppt] =
    useState<CalendarAppointmentItem | null>(null);
  const [waitlistBookPrefill, setWaitlistBookPrefill] =
    useState<WalkInBookingPrefill | null>(null);
  const [sendingOfferId, setSendingOfferId] = useState<Id<"waitlist"> | null>(
    null
  );

  const dateKey = useMemo(() => toCalendarDateKey(selectedDate), [selectedDate]);

  // Compute exact query window for the active calendar view so Week & 30-day Agenda never truncate
  const { rangeStartKey, rangeEndKey } = useMemo(() => {
    if (calendarView === "week") {
      const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
      const end = endOfWeek(selectedDate, { weekStartsOn: 0 });
      return {
        rangeStartKey: toCalendarDateKey(start),
        rangeEndKey: toCalendarDateKey(end),
      };
    }
    if (calendarView === "agenda") {
      return {
        rangeStartKey: toCalendarDateKey(selectedDate),
        rangeEndKey: toCalendarDateKey(addDays(selectedDate, 30)),
      };
    }
    return { rangeStartKey: dateKey, rangeEndKey: dateKey };
  }, [calendarView, selectedDate, dateKey]);

  const workspace = useQuery(api.appointments.getFrontDeskWorkspace, {
    dateKey,
    rangeStartKey,
    rangeEndKey,
    overrideClinicId,
  });

  const transitionStatus = useMutation(api.appointments.transitionStatus);
  const sendManualWaitlistOffer = useMutation(
    api.appointments.sendManualWaitlistOffer
  );
  const updateWaitlistStatus = useMutation(
    api.appointments.updateWaitlistStatus
  );

  const handleTransition = async (
    appointmentId: Id<"appointments">,
    status: Exclude<AppointmentStatus, "pending_approval">,
    cancellationReason?: string
  ) => {
    try {
      const res = await transitionStatus({
        appointmentId,
        status,
        cancellationReason,
      });
      if (res.hygieneRecallScheduledFor) {
        toast.success(
          `Marked completed & scheduled 6-month recall for ${res.hygieneRecallScheduledFor}.`
        );
      } else if (res.waitlistMatchedCount > 0) {
        toast.info(
          `Cancelled — notified ${res.waitlistMatchedCount} waitlisted patient(s) via email.`
        );
      } else if (res.isPolicyOverride) {
        toast.success("Cancelled with policy override logged.");
      } else {
        toast.success(`Status updated to ${status.replace("_", " ")}.`);
      }
      setSelectedAppt(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update appointment status."));
    }
  };

  const handleManualWaitlistOffer = async (waitlistId: Id<"waitlist">) => {
    setSendingOfferId(waitlistId);
    try {
      const res = await sendManualWaitlistOffer({ waitlistId });
      toast.success(`Slot opening offer sent to ${res.patientName} (${res.sentTo}).`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not send waitlist offer."));
    } finally {
      setSendingOfferId(null);
    }
  };

  const handleDismissWaitlist = async (waitlistId: Id<"waitlist">) => {
    try {
      await updateWaitlistStatus({ waitlistId, status: "expired" });
      toast.success("Waitlist entry marked expired.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update waitlist entry."));
    }
  };

  if (workspace === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading front-desk command center…
      </main>
    );
  }

  const { clinic, isReadOnly, readOnlyReason, isSuperAdminOverride } = workspace;
  const clinicTimezone = clinic.timezone || "Asia/Manila";

  const todaysAppointments = workspace.appointments.filter(
    (a) => a.dateKey === dateKey
  );
  const activeKanbanCount = todaysAppointments.filter(
    (a) => a.status !== "cancelled"
  ).length;
  const canVisitDentistView =
    workspace.user.role === "clinic_admin" ||
    workspace.user.role === "dentist" ||
    isSuperAdminOverride;

  const buildViewHref = (base: string) =>
    overrideClinicId
      ? `${base}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
      : base;

  const handleJumpToday = () => {
    const todayKey = dateToDateKeyInTimeZone(Date.now(), clinicTimezone);
    const [y, m, d] = todayKey.split("-").map(Number);
    if (y && m && d) {
      setSelectedDate(new Date(y, m - 1, d, 0, 0, 0, 0));
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedDate(today);
    }
  };

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      {/* Banners */}
      {isSuperAdminOverride ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/30 bg-sky-500/10 px-6 py-2 text-xs text-sky-900 dark:text-sky-200">
          <span className="inline-flex items-center gap-2">
            <Eye className="size-4" />
            <strong>Super Admin View-As-Clinic (Read-Only):</strong>{" "}
            {clinic.name}
          </span>
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

      {clinic.status === "past_due" && !isReadOnly ? (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <strong>Subscription Past Due:</strong> Renew before{" "}
            {clinic.gracePeriodEndsAt
              ? formatDate(clinic.gracePeriodEndsAt)
              : "grace period ends"}{" "}
            to avoid Read-Only suspension.
          </span>
        </div>
      ) : null}

      {isReadOnly && !isSuperAdminOverride ? (
        <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-900 dark:text-rose-200">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            <strong>Read-Only Mode ({clinic.status}):</strong>{" "}
            {readOnlyReason ??
              "Schedule viewing is enabled; creating or modifying appointments is paused."}
          </span>
        </div>
      ) : null}

      {/* Top Bar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex items-center gap-3">
          <span
            className="flex size-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: clinic.primaryColorHex }}
          >
            {clinic.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="text-sm font-semibold leading-tight">
              {clinic.name} · Front Desk
            </h1>
            <p className="text-xs text-muted-foreground">
              Live check-in Kanban, multi-chair master calendar & standby
              waitlist
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous day"
              onClick={() => setSelectedDate((d) => addDays(d, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-mono text-xs"
              title="Jump to today"
              onClick={handleJumpToday}
            >
              {dateKey}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next day"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <WalkInBookingDialog
            clinicId={clinic._id}
            clinicTimezone={clinicTimezone}
            defaultDateKey={dateKey}
            emergencyWindow={workspace.emergencyWindow}
            dentists={workspace.dentists}
            chairs={workspace.chairs}
            services={workspace.services}
            disabled={isReadOnly}
            overrideClinicId={overrideClinicId}
          />

          {canVisitDentistView ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={buildViewHref("/staff")} />}
            >
              <Stethoscope className="mr-1.5 size-3.5" />
              Dentist View
            </Button>
          ) : null}
          {workspace.user.role === "clinic_admin" || isSuperAdminOverride ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={buildViewHref("/admin")} />}
            >
              Clinic Admin
            </Button>
          ) : null}
          <UserButton />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 p-4 lg:p-6">
        {/* Pending Online Approval Requests Queue (Clinic-wide) */}
        {workspace.pendingRequests.length > 0 ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="inline-flex items-center gap-2 text-sm text-amber-950 dark:text-amber-200">
                  <Inbox className="size-4" />
                  Pending Online Booking Requests (
                  {workspace.pendingRequests.length})
                </CardTitle>
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                >
                  Action Required
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Review and approve or reject incoming online booking requests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {workspace.pendingRequests.map((req) => (
                <div
                  key={req._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{req.patientName}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {req.dateKey} ·{" "}
                        {formatTimeInTimeZone(req.startTimeUtc, clinicTimezone)}
                      </span>
                      {req.noShowCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="h-4 border-orange-500/40 bg-orange-500/15 px-1 text-[10px] text-orange-900 dark:text-orange-200"
                        >
                          NS×{req.noShowCount}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground">
                      {req.serviceName} · {req.dentistName} ·{" "}
                      {req.chairRoomCode || req.chairName}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isReadOnly ? (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleTransition(req._id, "confirmed")}
                      >
                        Approve
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setSelectedAppt(req)}
                    >
                      Review
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="kanban">
          <TabsList>
            <TabsTrigger value="kanban" className="gap-1.5">
              <Kanban className="size-3.5" />
              Patient Flow Kanban ({activeKanbanCount})
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5">
              <CalendarIcon className="size-3.5" />
              Master Calendar
            </TabsTrigger>
            <TabsTrigger value="waitlist" className="gap-1.5">
              <Users className="size-3.5" />
              Standby Waitlist ({workspace.waitlist.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: LIVE 5-STAGE CHECK-IN KANBAN BOARD */}
          <TabsContent value="kanban" className="mt-4">
            <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {KANBAN_COLUMNS.map((col) => {
                const cards = todaysAppointments.filter((a) =>
                  col.statuses.includes(a.status)
                );
                const isDropTarget = dragOverCol === col.id && !isReadOnly;
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => {
                      if (!isReadOnly) {
                        e.preventDefault();
                        if (dragOverCol !== col.id) setDragOverCol(col.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverCol === col.id) setDragOverCol(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverCol(null);
                      if (!isReadOnly && draggedApptId) {
                        const dragged = todaysAppointments.find(
                          (a) => a._id === draggedApptId
                        );
                        // Guard against redundant same-column drops
                        if (dragged && !col.statuses.includes(dragged.status)) {
                          void handleTransition(draggedApptId, col.id);
                        }
                        setDraggedApptId(null);
                      }
                    }}
                    className={`flex min-h-[420px] flex-col rounded-xl border border-t-4 bg-muted/20 p-3 transition-colors ${col.accentClass} ${
                      isDropTarget ? "ring-2 ring-primary/50 bg-accent/30" : ""
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold">{col.title}</h2>
                        <p className="text-[11px] text-muted-foreground">
                          {col.subtitle}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-mono">
                        {cards.length}
                      </Badge>
                    </div>

                    <div className="flex flex-1 flex-col gap-2.5">
                      {cards.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                          No patients in this stage
                        </div>
                      ) : (
                        cards.map((appt) => {
                          const isPending = appt.status === "pending_approval";
                          return (
                            <div
                              key={appt._id}
                              draggable={!isReadOnly}
                              onDragStart={() => setDraggedApptId(appt._id)}
                              onDragEnd={() => {
                                setDraggedApptId(null);
                                setDragOverCol(null);
                              }}
                              className={`space-y-2 rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm ${
                                isPending ? "border-amber-500/50" : ""
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold leading-tight">
                                    {appt.patientName}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {appt.serviceName}
                                  </p>
                                </div>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                                  <Clock className="size-3" />
                                  {formatTimeInTimeZone(
                                    appt.startTimeUtc,
                                    clinicTimezone
                                  )}
                                </span>
                              </div>

                              {isPending ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-900 dark:text-amber-200"
                                >
                                  Pending Approval
                                </Badge>
                              ) : null}

                              {appt.hasMedicalAlert ? (
                                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-800 dark:text-rose-200">
                                  Medical Alert
                                  {appt.medicalSummary?.allergies.length
                                    ? `: ${appt.medicalSummary.allergies.join(", ")}`
                                    : ""}
                                </div>
                              ) : null}

                              {appt.noShowCount > 0 ? (
                                <div className="inline-flex items-center gap-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-900 dark:text-orange-200">
                                  <UserX className="size-3" />
                                  {appt.noShowCount} Prior No-Show
                                  {appt.noShowCount > 1 ? "s" : ""}
                                </div>
                              ) : null}

                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span
                                  className="size-2 rounded-full"
                                  style={{
                                    backgroundColor: appt.dentistColorHex,
                                  }}
                                />
                                <span className="truncate">
                                  {appt.dentistName}
                                </span>
                                <span>·</span>
                                <span className="font-mono">
                                  {appt.chairRoomCode || appt.chairName}
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-1.5 border-t pt-2">
                                {!isReadOnly && isPending ? (
                                  <Button
                                    size="sm"
                                    className="h-7 flex-1 text-xs"
                                    onClick={() =>
                                      handleTransition(appt._id, "confirmed")
                                    }
                                  >
                                    Approve
                                  </Button>
                                ) : null}
                                {!isReadOnly &&
                                !isPending &&
                                col.id === "confirmed" ? (
                                  <Button
                                    size="sm"
                                    className="h-7 flex-1 text-xs"
                                    onClick={() =>
                                      handleTransition(appt._id, "checked_in")
                                    }
                                  >
                                    Check In
                                  </Button>
                                ) : null}
                                {!isReadOnly && col.id === "checked_in" ? (
                                  <Button
                                    size="sm"
                                    className="h-7 flex-1 text-xs"
                                    onClick={() =>
                                      handleTransition(appt._id, "in_chair")
                                    }
                                  >
                                    Seat in Chair
                                  </Button>
                                ) : null}
                                {!isReadOnly && col.id === "in_chair" ? (
                                  <Button
                                    size="sm"
                                    className="h-7 flex-1 text-xs"
                                    onClick={() =>
                                      handleTransition(appt._id, "completed")
                                    }
                                  >
                                    <CheckCircle2 className="mr-1 size-3.5" />
                                    Complete
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => setSelectedAppt(appt)}
                                >
                                  Details
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* TAB 2: MULTI-CHAIR & MULTI-DENTIST MASTER CALENDAR */}
          <TabsContent value="calendar" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Master Operatory Calendar</CardTitle>
                <CardDescription>
                  Color-coded by dentist across all operatory chairs with live
                  Convex sync and Day / Week / 30-Day Agenda views.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MasterCalendar
                  date={selectedDate}
                  view={calendarView}
                  onViewChange={setCalendarView}
                  onNavigateDate={setSelectedDate}
                  appointments={workspace.appointments}
                  chairs={workspace.calendarChairs}
                  dentists={workspace.calendarDentists}
                  emergencyWindow={workspace.emergencyWindow}
                  onSelectAppointment={setSelectedAppt}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: ACTIONABLE STANDBY WAITLIST */}
          <TabsContent value="waitlist" className="mt-4">
            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Standby Waitlist for {dateKey}</CardTitle>
                  <CardDescription>
                    Cancelled bookings automatically notify matching waitlisted
                    patients via Resend (when enabled), or trigger a manual slot
                    offer below.
                  </CardDescription>
                </div>
                <AddWaitlistDialog
                  defaultDateKey={dateKey}
                  dentists={workspace.dentists}
                  services={workspace.services}
                  disabled={isReadOnly}
                  overrideClinicId={overrideClinicId}
                />
              </CardHeader>
              <CardContent>
                {workspace.waitlist.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No patients on the standby waitlist for {dateKey}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {workspace.waitlist.map((w) => {
                      const canSendOffer =
                        !isReadOnly &&
                        clinic.featureFlags.waitlistAutomationEnabled &&
                        Boolean(w.patientEmail) &&
                        (w.status === "waiting" || w.status === "notified");
                      const canBook =
                        !isReadOnly &&
                        (w.status === "waiting" || w.status === "notified");
                      return (
                        <div
                          key={w._id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{w.patientName}</p>
                              <Badge variant="outline" className="capitalize">
                                {w.status}
                              </Badge>
                              {w.noShowCount > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="border-orange-500/40 bg-orange-500/15 text-[11px] text-orange-900 dark:text-orange-200"
                                >
                                  <UserX className="mr-1 size-3" />
                                  {w.noShowCount} No-Show
                                  {w.noShowCount > 1 ? "s" : ""}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {w.serviceName} · {w.preferredDentistName} ·
                              Window:{" "}
                              <span className="capitalize">
                                {w.preferredTimeWindow}
                              </span>{" "}
                              · {w.patientPhone}
                              {w.patientEmail
                                ? ` · ${w.patientEmail}`
                                : " · (No email — call to offer)"}
                            </p>
                          </div>

                          {!isReadOnly ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {w.status === "waiting" ||
                              w.status === "notified" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={
                                      !canSendOffer || sendingOfferId === w._id
                                    }
                                    title={
                                      !clinic.featureFlags
                                        .waitlistAutomationEnabled
                                        ? "Waitlist Automation is disabled on this clinic plan"
                                        : !w.patientEmail
                                          ? "Patient has no email on file — call directly"
                                          : "Send slot opening email via Resend"
                                    }
                                    onClick={() =>
                                      handleManualWaitlistOffer(w._id)
                                    }
                                  >
                                    <Mail className="mr-1 size-3" />
                                    {sendingOfferId === w._id
                                      ? "Sending…"
                                      : w.status === "notified"
                                        ? "Resend Offer"
                                        : "Send Offer"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={!canBook}
                                    onClick={() =>
                                      setWaitlistBookPrefill({
                                        patientId: w.patientId,
                                        patientName: w.patientName,
                                        patientPhone: w.patientPhone,
                                        serviceId: w.serviceId,
                                        dentistId:
                                          w.preferredDentistId ?? null,
                                        dateKey: w.preferredDateKey,
                                        waitlistId: w._id,
                                      })
                                    }
                                  >
                                    <CalendarPlus className="mr-1 size-3" />
                                    Book Slot
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    aria-label="Expire waitlist entry"
                                    title="Dismiss / expire entry"
                                    onClick={() => handleDismissWaitlist(w._id)}
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Appointment Details, Reassignment & Cancellation Override Dialog */}
      <AppointmentActionDialog
        appointment={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        clinicId={clinic._id}
        clinicTimezone={clinicTimezone}
        cancellationWindowHours={clinic.cancellationWindowHours}
        dentists={workspace.dentists}
        chairs={workspace.chairs}
        isReadOnly={isReadOnly}
        onTransition={handleTransition}
      />

      {/* Controlled Walk-In Dialog for Direct Waitlist Booking */}
      <WalkInBookingDialog
        clinicId={clinic._id}
        clinicTimezone={clinicTimezone}
        defaultDateKey={dateKey}
        emergencyWindow={workspace.emergencyWindow}
        dentists={workspace.dentists}
        chairs={workspace.chairs}
        services={workspace.services}
        disabled={isReadOnly}
        overrideClinicId={overrideClinicId}
        externalOpen={waitlistBookPrefill !== null}
        onExternalOpenChange={(next) => {
          if (!next) setWaitlistBookPrefill(null);
        }}
        prefill={waitlistBookPrefill}
      />
    </div>
  );
}

function FrontDeskSearchResolver() {
  const { isConfigured } = useEnvConfig();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAsClinicId")?.trim() || undefined;
  const overrideClinicId = viewAs as Id<"clinics"> | undefined;

  if (!isConfigured) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>Connect Clerk & Convex to activate Front Desk</AlertTitle>
          <AlertDescription>
            Configure <code>.env.local</code> and run{" "}
            <code>npx convex dev</code> to use the real-time check-in Kanban and
            multi-chair master calendar.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <FrontDeskErrorBoundary>
      <ConnectedFrontDesk overrideClinicId={overrideClinicId} />
    </FrontDeskErrorBoundary>
  );
}

export function FrontDeskWorkspace() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading Front Desk…
        </div>
      }
    >
      <FrontDeskSearchResolver />
    </Suspense>
  );
}
