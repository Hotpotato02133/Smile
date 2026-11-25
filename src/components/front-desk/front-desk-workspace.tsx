"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { endOfWeek, format, startOfWeek } from "date-fns";
import {
  AlertTriangle,
  Armchair,
  ArrowLeft,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Inbox,
  Kanban,
  Mail,
  Megaphone,
  Plus,
  Search,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  dateToDateKeyInTimeZone,
  formatDate,
  formatMinutes12h,
  formatTimeInTimeZone,
  getErrorMessage,
} from "@/lib/format";
import { cn } from "@/lib/utils";
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
  emptyLabel: string;
  statuses: AppointmentStatus[];
  dotClass: string;
  countClass: string;
}[] = [
  {
    id: "confirmed",
    title: "Scheduled",
    subtitle: "Expected arrivals",
    emptyLabel: "No scheduled arrivals",
    statuses: ["pending_approval", "confirmed"],
    dotClass: "bg-sky-500",
    countClass: "bg-sky-50 text-sky-800 border-sky-200/80",
  },
  {
    id: "checked_in",
    title: "Checked In",
    subtitle: "Waiting room",
    emptyLabel: "Waiting room is clear",
    statuses: ["checked_in"],
    dotClass: "bg-[#6C5CE7]",
    countClass: "bg-[#F1EEFF] text-[#4F3EC7] border-[#6C5CE7]/25",
  },
  {
    id: "in_chair",
    title: "In Chair",
    subtitle: "Treatment active",
    emptyLabel: "All chairs open",
    statuses: ["in_chair"],
    dotClass: "bg-emerald-500",
    countClass: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
  },
  {
    id: "completed",
    title: "Completed",
    subtitle: "Checkout & recall",
    emptyLabel: "No completed visits yet",
    statuses: ["completed"],
    dotClass: "bg-slate-400",
    countClass: "bg-slate-100 text-slate-700 border-slate-200",
  },
  {
    id: "no_show",
    title: "No-Show",
    subtitle: "Missed visits",
    emptyLabel: "No missed visits",
    statuses: ["no_show"],
    dotClass: "bg-orange-500",
    countClass: "bg-orange-50 text-orange-800 border-orange-200/80",
  },
];

const ROLE_LABELS: Record<string, string> = {
  receptionist: "Receptionist",
  clinic_admin: "Clinic Admin",
  dentist: "Dentist",
  super_admin: "Super Admin",
};

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
  const [todayRefMs] = useState<number>(() => Date.now());
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [activeTab, setActiveTab] = useState<"kanban" | "calendar" | "waitlist">(
    "kanban"
  );
  const [calendarView, setCalendarView] = useState<View>("day");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDentistId, setSelectedDentistId] = useState<string>("all");

  const [draggedApptId, setDraggedApptId] =
    useState<Id<"appointments"> | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);
  const [selectedAppt, setSelectedAppt] =
    useState<CalendarAppointmentItem | null>(null);

  // Unified controlled Walk-In / Phone Booking dialog
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [waitlistBookPrefill, setWaitlistBookPrefill] =
    useState<WalkInBookingPrefill | null>(null);
  const [sendingOfferId, setSendingOfferId] = useState<Id<"waitlist"> | null>(
    null
  );
  const [dismissingWaitlist, setDismissingWaitlist] = useState<{
    _id: Id<"waitlist">;
    patientName: string;
    serviceName: string;
  } | null>(null);
  const [dismissingBusy, setDismissingBusy] = useState(false);

  const dateKey = useMemo(() => toCalendarDateKey(selectedDate), [selectedDate]);
  const formattedSelectedDate = useMemo(
    () => format(selectedDate, "EEE, MMM d, yyyy"),
    [selectedDate]
  );

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
      toast.success(
        `Slot opening offer sent to ${res.patientName} (${res.sentTo}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not send waitlist offer."));
    } finally {
      setSendingOfferId(null);
    }
  };

  const handleConfirmDismissWaitlist = async () => {
    if (!dismissingWaitlist) return;
    setDismissingBusy(true);
    try {
      await updateWaitlistStatus({
        waitlistId: dismissingWaitlist._id,
        status: "expired",
      });
      toast.success(
        `Removed ${dismissingWaitlist.patientName} from today's standby waitlist.`
      );
      setDismissingWaitlist(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update waitlist entry."));
    } finally {
      setDismissingBusy(false);
    }
  };

  const openNewWalkIn = () => {
    setWaitlistBookPrefill(null);
    setWalkInOpen(true);
  };

  const openWaitlistBooking = (prefill: WalkInBookingPrefill) => {
    setWaitlistBookPrefill(prefill);
    setWalkInOpen(true);
  };

  if (workspace === undefined) {
    return (
      <div className="flex min-h-screen flex-1 flex-col bg-[#F6F8FB]">
        <div className="border-b border-slate-200/80 bg-white">
          <div className="mx-auto flex h-16 max-w-[1520px] items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="size-9 animate-pulse rounded-xl bg-slate-200" />
              <div className="space-y-1.5">
                <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
            <div className="h-9 w-64 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
        <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
          <div className="h-24 animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-80 animate-pulse rounded-2xl border border-slate-200/80 bg-white"
              />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const { clinic, isReadOnly, readOnlyReason, isSuperAdminOverride } = workspace;
  const clinicTimezone = clinic.timezone || "Asia/Manila";
  const clinicTodayKey = dateToDateKeyInTimeZone(todayRefMs, clinicTimezone);
  const isViewingToday = dateKey === clinicTodayKey;

  const todaysAppointments = workspace.appointments.filter(
    (a) => a.dateKey === dateKey
  );
  const nonCancelledToday = todaysAppointments.filter(
    (a) => a.status !== "cancelled"
  );

  // Instant search + dentist filter applied across Kanban and Calendar
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const hasActiveFilters =
    Boolean(normalizedSearch) || selectedDentistId !== "all";

  const matchesFilters = (a: CalendarAppointmentItem) => {
    if (selectedDentistId !== "all" && a.dentistId !== selectedDentistId) {
      return false;
    }
    if (normalizedSearch) {
      const hay =
        `${a.patientName} ${a.patientPhone} ${a.serviceName} ${a.dentistName} ${a.chairRoomCode} ${a.chairName} ${a.referenceCode}`.toLowerCase();
      return hay.includes(normalizedSearch);
    }
    return true;
  };

  const filteredTodayAppointments = todaysAppointments.filter(matchesFilters);
  const filteredCalendarAppointments =
    workspace.appointments.filter(matchesFilters);

  const activeKanbanCount = nonCancelledToday.length;
  const checkedInCount = nonCancelledToday.filter(
    (a) => a.status === "checked_in"
  ).length;
  const inChairAppointments = nonCancelledToday.filter(
    (a) => a.status === "in_chair"
  );
  const completedCount = nonCancelledToday.filter(
    (a) => a.status === "completed"
  ).length;

  // Map active in-chair patients by chairId for the Live Operatory Status bar
  const chairOccupancyMap = new Map<
    Id<"chairs">,
    { patientName: string; dentistName: string; appointment: CalendarAppointmentItem }
  >();
  for (const appt of inChairAppointments) {
    chairOccupancyMap.set(appt.chairId, {
      patientName: appt.patientName,
      dentistName: appt.dentistName,
      appointment: appt,
    });
  }

  const canVisitDentistView =
    workspace.user.role === "clinic_admin" ||
    workspace.user.role === "dentist" ||
    isSuperAdminOverride;

  const buildViewHref = (base: string) =>
    overrideClinicId
      ? `${base}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
      : base;

  const handleJumpToday = () => {
    const freshTodayKey = dateToDateKeyInTimeZone(Date.now(), clinicTimezone);
    const [y, m, d] = freshTodayKey.split("-").map(Number);
    if (y && m && d) {
      setSelectedDate(new Date(y, m - 1, d, 0, 0, 0, 0));
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedDate(today);
    }
  };

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#F6F8FB] text-slate-950">
      {/* Operational Banners */}
      {isSuperAdminOverride ? (
        <div className="border-b border-sky-200/80 bg-sky-50 text-xs text-sky-950">
          <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <span className="inline-flex items-center gap-2">
              <Eye className="size-4 text-sky-700" />
              <strong>Super Admin View-As-Clinic (Read-Only):</strong>{" "}
              {clinic.name}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full border-sky-300 bg-white px-3 text-xs"
              render={<Link href="/super-admin/clinics" />}
            >
              <ArrowLeft className="mr-1 size-3.5" />
              Back to Super Admin
            </Button>
          </div>
        </div>
      ) : null}

      {clinic.status === "past_due" && !isReadOnly ? (
        <div className="border-b border-amber-200/80 bg-amber-50 text-xs text-amber-950">
          <div className="mx-auto flex max-w-[1520px] items-center gap-2 px-4 py-2 sm:px-6">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <span>
              <strong>Subscription Past Due:</strong> Renew before{" "}
              {clinic.gracePeriodEndsAt
                ? formatDate(clinic.gracePeriodEndsAt)
                : "grace period ends"}{" "}
              to avoid Read-Only suspension.
            </span>
          </div>
        </div>
      ) : null}

      {isReadOnly && !isSuperAdminOverride ? (
        <div className="border-b border-rose-200/80 bg-rose-50 text-xs text-rose-950">
          <div className="mx-auto flex max-w-[1520px] items-center gap-2 px-4 py-2 sm:px-6">
            <ShieldAlert className="size-4 shrink-0 text-rose-600" />
            <span>
              <strong>Read-Only Mode ({clinic.status}):</strong>{" "}
              {readOnlyReason ??
                "Schedule viewing is enabled; creating or modifying appointments is paused."}
            </span>
          </div>
        </div>
      ) : null}

      {(workspace.announcements ?? []).slice(0, 2).map((ann) => (
        <div
          key={ann._id}
          className={cn(
            "border-b text-xs",
            ann.severity === "critical"
              ? "border-rose-200 bg-rose-50 text-rose-950"
              : ann.severity === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-sky-200 bg-sky-50 text-sky-950"
          )}
        >
          <div className="mx-auto flex max-w-[1520px] items-start gap-2 px-4 py-2 sm:px-6">
            <Megaphone className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>{ann.title}:</strong> {ann.message}
            </span>
          </div>
        </div>
      ))}

      {/* Aligned SaaS Top Command Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Left: Clinic Identity & Role Context */}
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: clinic.primaryColorHex || "#6C5CE7" }}
            >
              {clinic.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-bold tracking-tight text-slate-950">
                  {clinic.name}
                </h1>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-[#F8FAFC] px-2.5 py-0.5 text-[11px] font-semibold text-slate-700"
                >
                  Front Desk ·{" "}
                  {ROLE_LABELS[workspace.user.role] ?? "Receptionist"}
                </Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  {clinic.city}, {clinic.province}
                </span>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/c/${clinic.slug}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 font-medium text-slate-600 transition-colors hover:text-[#6C5CE7]"
                >
                  Public Booking Page
                  <ExternalLink className="size-3" />
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Human-Readable Date Controls, Primary CTA & Profile */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-full border border-slate-200/90 bg-[#F8FAFC] p-0.5">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Previous day"
                onClick={() => setSelectedDate((d) => addDays(d, -1))}
                className="size-7 rounded-full text-slate-600 hover:bg-white hover:text-slate-950"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2.5 text-xs font-semibold tabular-nums text-slate-900">
                {formattedSelectedDate}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Next day"
                onClick={() => setSelectedDate((d) => addDays(d, 1))}
                className="size-7 rounded-full text-slate-600 hover:bg-white hover:text-slate-950"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isViewingToday}
              onClick={handleJumpToday}
              className={cn(
                "h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold",
                isViewingToday
                  ? "text-slate-400"
                  : "text-slate-800 hover:border-[#6C5CE7]/40 hover:text-[#6C5CE7]"
              )}
            >
              Today
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={isReadOnly}
              onClick={openNewWalkIn}
              className="h-8 rounded-full bg-[#6C5CE7] px-3.5 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
            >
              <Plus className="mr-1.5 size-3.5" />
              Walk-In / Phone Book
            </Button>

            {canVisitDentistView ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={buildViewHref("/staff")} />}
                className="h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              >
                <Stethoscope className="mr-1.5 size-3.5" />
                Dentist
              </Button>
            ) : null}

            {workspace.user.role === "clinic_admin" || isSuperAdminOverride ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={buildViewHref("/admin")} />}
                className="h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              >
                Clinic Admin
              </Button>
            ) : null}

            <div className="ml-1 flex items-center">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        {/* Unified Operations Pulse Strip + Live Operatory Availability Bar */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <div className="grid grid-cols-2 divide-y divide-slate-200/75 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
            <div className="border-r border-slate-200/75 p-4 sm:border-r-0">
              <p className="text-xs font-medium text-slate-500">
                Today&apos;s Visits
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-slate-950">
                  {activeKanbanCount}
                </span>
                <span className="text-xs tabular-nums text-slate-500">
                  {completedCount} completed
                </span>
              </div>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium text-slate-500">Waiting Room</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    checkedInCount > 0 ? "text-[#4F3EC7]" : "text-slate-950"
                  )}
                >
                  {checkedInCount}
                </span>
                <span className="text-xs text-slate-500">checked in</span>
              </div>
            </div>

            <div className="border-r border-slate-200/75 p-4 sm:border-r-0">
              <p className="text-xs font-medium text-slate-500">
                Chairs Occupied
              </p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    inChairAppointments.length > 0
                      ? "text-emerald-700"
                      : "text-slate-950"
                  )}
                >
                  {inChairAppointments.length}
                </span>
                <span className="text-sm font-medium tabular-nums text-slate-400">
                  / {workspace.chairs.length}
                </span>
              </div>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium text-slate-500">
                Pending Approvals
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    workspace.pendingRequests.length > 0
                      ? "text-amber-700"
                      : "text-slate-950"
                  )}
                >
                  {workspace.pendingRequests.length}
                </span>
                <span className="text-xs text-slate-500">
                  {workspace.pendingRequests.length > 0
                    ? "needs review"
                    : "all clear"}
                </span>
              </div>
            </div>

            <div className="col-span-2 p-4 sm:col-span-1">
              <p className="text-xs font-medium text-slate-500">
                Standby Waitlist
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-slate-950">
                  {workspace.waitlist.length}
                </span>
                <span className="text-xs text-slate-500">
                  for {format(selectedDate, "MMM d")}
                </span>
              </div>
            </div>
          </div>

          {/* Live Operatory Chairs & Emergency Window Sub-bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-[#F8FAFC] px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                <Armchair className="size-3.5 text-slate-400" />
                Operatories:
              </span>
              {workspace.chairs.length === 0 ? (
                <span className="text-slate-500">No active chairs configured</span>
              ) : (
                workspace.chairs.map((chair) => {
                  const occupant = chairOccupancyMap.get(chair._id);
                  return occupant ? (
                    <button
                      key={chair._id}
                      type="button"
                      onClick={() => setSelectedAppt(occupant.appointment)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900 transition-colors hover:bg-emerald-100"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      <span className="font-mono font-semibold">
                        {chair.roomCode || chair.name}
                      </span>
                      <span>· {occupant.patientName}</span>
                    </button>
                  ) : (
                    <span
                      key={chair._id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
                    >
                      <span className="size-1.5 rounded-full bg-slate-300" />
                      <span className="font-mono font-semibold text-slate-800">
                        {chair.roomCode || chair.name}
                      </span>
                      <span className="text-slate-400">Open</span>
                    </span>
                  );
                })
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>
                {workspace.dentists.length} active dentist
                {workspace.dentists.length === 1 ? "" : "s"}
              </span>
              {workspace.emergencyWindow ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 font-medium text-amber-900">
                  <Clock className="size-3 text-amber-600" />
                  Emergency hold:{" "}
                  {formatMinutes12h(workspace.emergencyWindow.startMinute)} –{" "}
                  {formatMinutes12h(workspace.emergencyWindow.endMinute)}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {/* Pending Online Approval Requests Queue (Action-Required Banner) */}
        {workspace.pendingRequests.length > 0 ? (
          <section className="rounded-2xl border border-amber-200/90 bg-amber-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Inbox className="size-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-amber-950">
                  Pending Online Booking Requests (
                  {workspace.pendingRequests.length})
                </h2>
                <Badge
                  variant="outline"
                  className="rounded-full border-amber-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-amber-900"
                >
                  Action Required
                </Badge>
              </div>
              <p className="text-xs text-amber-900/80">
                Approve to confirm the chair &amp; dentist slot or open Review
                to reassign.
              </p>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {workspace.pendingRequests.map((req) => (
                <div
                  key={req._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-white px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold text-slate-950">
                        {req.patientName}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {req.dateKey} ·{" "}
                        {formatTimeInTimeZone(req.startTimeUtc, clinicTimezone)}
                      </span>
                      {req.noShowCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="h-4 rounded-full border-orange-300 bg-orange-50 px-1.5 text-[10px] font-semibold text-orange-900"
                        >
                          NS×{req.noShowCount}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-slate-500">
                      {req.serviceName} · {req.dentistName} ·{" "}
                      {req.chairRoomCode || req.chairName}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isReadOnly ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 rounded-full bg-[#6C5CE7] px-3 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                        onClick={() => handleTransition(req._id, "confirmed")}
                      >
                        Approve
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full border-slate-200 px-3 text-xs"
                      onClick={() => setSelectedAppt(req)}
                    >
                      Review
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Main Workspace Tabs + Unified Filter Toolbar */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            if (v === "kanban" || v === "calendar" || v === "waitlist") {
              setActiveTab(v);
            }
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="w-fit rounded-full border border-slate-200/80 bg-white p-1">
              <TabsTrigger
                value="kanban"
                className="gap-1.5 rounded-full px-4 text-xs font-semibold"
              >
                <Kanban className="size-3.5" />
                Patient Flow ({activeKanbanCount})
              </TabsTrigger>
              <TabsTrigger
                value="calendar"
                className="gap-1.5 rounded-full px-4 text-xs font-semibold"
              >
                <CalendarIcon className="size-3.5" />
                Master Calendar
              </TabsTrigger>
              <TabsTrigger
                value="waitlist"
                className="gap-1.5 rounded-full px-4 text-xs font-semibold"
              >
                <Users className="size-3.5" />
                Standby Waitlist ({workspace.waitlist.length})
              </TabsTrigger>
            </TabsList>

            {activeTab !== "waitlist" ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search patient, service, phone…"
                    className="h-9 rounded-full border-slate-200/90 bg-white pr-8 pl-8 text-xs"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                      className="absolute top-2.5 right-2.5 cursor-pointer text-slate-400 hover:text-slate-700"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                {workspace.dentists.length > 0 ? (
                  <Select
                    value={selectedDentistId}
                    onValueChange={(v) => setSelectedDentistId(v ?? "all")}
                  >
                    <SelectTrigger className="h-9 w-full rounded-full border-slate-200/90 bg-white text-xs sm:w-48">
                      <SelectValue placeholder="All Dentists" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Dentists</SelectItem>
                      {workspace.dentists.map((d) => (
                        <SelectItem key={d._id} value={d._id}>
                          {d.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {hasActiveFilters ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedDentistId("all");
                    }}
                    className="h-8 rounded-full px-3 text-xs text-slate-600 hover:text-slate-950"
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* TAB 1: LIVE 5-STAGE CHECK-IN KANBAN BOARD */}
          <TabsContent value="kanban" className="mt-4">
            <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {KANBAN_COLUMNS.map((col) => {
                const cards = filteredTodayAppointments.filter((a) =>
                  col.statuses.includes(a.status)
                );
                const isDropTarget = dragOverCol === col.id && !isReadOnly;

                return (
                  <section
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
                        if (dragged && !col.statuses.includes(dragged.status)) {
                          void handleTransition(draggedApptId, col.id);
                        }
                        setDraggedApptId(null);
                      }
                    }}
                    className={cn(
                      "flex min-h-[340px] flex-col overflow-hidden rounded-2xl border bg-white transition-colors",
                      isDropTarget
                        ? "border-[#6C5CE7] ring-2 ring-[#6C5CE7]/25"
                        : "border-slate-200/80"
                    )}
                  >
                    {/* Quiet Column Header with Semantic Dot */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              col.dotClass
                            )}
                          />
                          <h2 className="truncate text-sm font-semibold text-slate-950">
                            {col.title}
                          </h2>
                        </div>
                        <p className="mt-0.5 pl-4 text-[11px] text-slate-500">
                          {col.subtitle}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                          cards.length > 0
                            ? col.countClass
                            : "border-slate-200/80 bg-[#F8FAFC] text-slate-500"
                        )}
                      >
                        {cards.length}
                      </Badge>
                    </div>

                    {/* Cards Lane */}
                    <div
                      className={cn(
                        "flex flex-1 flex-col gap-2.5 p-2.5 transition-colors",
                        isDropTarget ? "bg-[#F1EEFF]/45" : "bg-[#F8FAFC]/65"
                      )}
                    >
                      {cards.length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center rounded-xl px-4 py-10 text-center">
                          <p className="text-xs font-medium text-slate-500">
                            {hasActiveFilters
                              ? "No matching patients"
                              : col.emptyLabel}
                          </p>
                          {col.id === "confirmed" &&
                          !isReadOnly &&
                          !hasActiveFilters ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={openNewWalkIn}
                              className="mt-3 h-7 rounded-full border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:border-[#6C5CE7]/40 hover:text-[#6C5CE7]"
                            >
                              <Plus className="mr-1 size-3" />
                              Book Walk-In
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        cards.map((appt) => {
                          const isPending = appt.status === "pending_approval";
                          return (
                            <article
                              key={appt._id}
                              draggable={!isReadOnly}
                              onDragStart={() => setDraggedApptId(appt._id)}
                              onDragEnd={() => {
                                setDraggedApptId(null);
                                setDragOverCol(null);
                              }}
                              className={cn(
                                "space-y-2.5 rounded-xl border bg-white p-3 transition-colors",
                                !isReadOnly &&
                                  "cursor-grab active:cursor-grabbing",
                                isPending
                                  ? "border-amber-300 bg-amber-50/20"
                                  : "border-slate-200/85 hover:border-slate-300"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold leading-tight text-slate-950">
                                    {appt.patientName}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-slate-500">
                                    {appt.serviceName}
                                  </p>
                                </div>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/80 bg-[#F8FAFC] px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                                  <Clock className="size-3 text-slate-400" />
                                  {formatTimeInTimeZone(
                                    appt.startTimeUtc,
                                    clinicTimezone
                                  )}
                                </span>
                              </div>

                              {isPending ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                >
                                  Pending Approval
                                </Badge>
                              ) : null}

                              {appt.hasMedicalAlert ? (
                                <div className="rounded-lg border border-rose-200/90 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-800">
                                  Medical Alert
                                  {appt.medicalSummary?.allergies.length
                                    ? `: ${appt.medicalSummary.allergies.join(", ")}`
                                    : ""}
                                </div>
                              ) : null}

                              {appt.noShowCount > 0 ? (
                                <div className="inline-flex items-center gap-1 rounded-full border border-orange-200/90 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-900">
                                  <UserX className="size-3" />
                                  {appt.noShowCount} Prior No-Show
                                  {appt.noShowCount > 1 ? "s" : ""}
                                </div>
                              ) : null}

                              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-500">
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                  <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: appt.dentistColorHex,
                                    }}
                                  />
                                  <span className="truncate font-medium text-slate-700">
                                    {appt.dentistName}
                                  </span>
                                </span>
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                                  {appt.chairRoomCode || appt.chairName}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2">
                                {!isReadOnly && isPending ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 flex-1 rounded-full bg-[#6C5CE7] text-xs font-semibold text-white hover:bg-[#5B4BD6]"
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
                                    type="button"
                                    size="sm"
                                    className="h-7 flex-1 rounded-full bg-[#6C5CE7] text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                                    onClick={() =>
                                      handleTransition(appt._id, "checked_in")
                                    }
                                  >
                                    Check In
                                  </Button>
                                ) : null}
                                {!isReadOnly && col.id === "checked_in" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 flex-1 rounded-full bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                                    onClick={() =>
                                      handleTransition(appt._id, "in_chair")
                                    }
                                  >
                                    Seat in Chair
                                  </Button>
                                ) : null}
                                {!isReadOnly && col.id === "in_chair" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 flex-1 rounded-full bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
                                    onClick={() =>
                                      handleTransition(appt._id, "completed")
                                    }
                                  >
                                    <CheckCircle2 className="mr-1 size-3.5" />
                                    Complete
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-full border-slate-200 px-2.5 text-xs text-slate-700"
                                  onClick={() => setSelectedAppt(appt)}
                                >
                                  Details
                                </Button>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </TabsContent>

          {/* TAB 2: MULTI-CHAIR & MULTI-DENTIST MASTER CALENDAR */}
          <TabsContent value="calendar" className="mt-4">
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    Master Operatory Calendar
                  </h2>
                  <p className="text-xs text-slate-500">
                    Color-coded by dentist across all operatory chairs with live
                    real-time sync and Day / Week / 30-Day Agenda views.
                  </p>
                </div>
                {hasActiveFilters ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#6C5CE7]/25 bg-[#F1EEFF] px-3 py-1 text-xs font-semibold text-[#4F3EC7]"
                  >
                    Filtered: {filteredCalendarAppointments.length} visit
                    {filteredCalendarAppointments.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <div className="p-4 sm:p-5">
                <MasterCalendar
                  date={selectedDate}
                  view={calendarView}
                  onViewChange={setCalendarView}
                  onNavigateDate={setSelectedDate}
                  appointments={filteredCalendarAppointments}
                  chairs={workspace.calendarChairs}
                  dentists={workspace.calendarDentists}
                  emergencyWindow={workspace.emergencyWindow}
                  onSelectAppointment={setSelectedAppt}
                />
              </div>
            </section>
          </TabsContent>

          {/* TAB 3: ACTIONABLE STANDBY WAITLIST */}
          <TabsContent value="waitlist" className="mt-4">
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    Standby Waitlist · {formattedSelectedDate}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Cancelled bookings automatically notify matching waitlisted
                    patients via email, or send a manual slot offer below.
                  </p>
                </div>
                <AddWaitlistDialog
                  defaultDateKey={dateKey}
                  dentists={workspace.dentists}
                  services={workspace.services}
                  disabled={isReadOnly}
                  overrideClinicId={overrideClinicId}
                />
              </div>

              <div className="p-4 sm:p-5">
                {workspace.waitlist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-12 text-center">
                    <Users className="size-7 text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      No patients on standby for {format(selectedDate, "MMM d")}
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500">
                      Add flexible patients here so cancellations fill chairs
                      automatically without leaving empty gaps.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
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
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/85 bg-[#F8FAFC]/70 px-4 py-3 text-sm"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-950">
                                {w.patientName}
                              </p>
                              <Badge
                                variant="outline"
                                className="rounded-full bg-white text-[11px] capitalize"
                              >
                                {w.status}
                              </Badge>
                              {w.noShowCount > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-orange-200 bg-orange-50 text-[11px] text-orange-900"
                                >
                                  <UserX className="mr-1 size-3" />
                                  {w.noShowCount} No-Show
                                  {w.noShowCount > 1 ? "s" : ""}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-xs text-slate-500">
                              {w.serviceName} · {w.preferredDentistName} ·
                              Window:{" "}
                              <span className="capitalize text-slate-700">
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
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs"
                                    disabled={
                                      !canSendOffer || sendingOfferId === w._id
                                    }
                                    title={
                                      !clinic.featureFlags
                                        .waitlistAutomationEnabled
                                        ? "Waitlist Automation is disabled on this clinic plan"
                                        : !w.patientEmail
                                          ? "Patient has no email on file — call directly"
                                          : "Send slot opening email"
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
                                    type="button"
                                    size="sm"
                                    className="h-7 rounded-full bg-[#6C5CE7] px-3 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                                    disabled={!canBook}
                                    onClick={() =>
                                      openWaitlistBooking({
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
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    className="size-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    aria-label={`Remove ${w.patientName} from waitlist`}
                                    title="Remove from waitlist"
                                    onClick={() =>
                                      setDismissingWaitlist({
                                        _id: w._id,
                                        patientName: w.patientName,
                                        serviceName: w.serviceName,
                                      })
                                    }
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
              </div>
            </section>
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

      {/* Unified Controlled Walk-In / Phone / Waitlist Booking Dialog */}
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
        externalOpen={walkInOpen}
        onExternalOpenChange={(next) => {
          setWalkInOpen(next);
          if (!next) setWaitlistBookPrefill(null);
        }}
        prefill={waitlistBookPrefill}
      />

      {/* Waitlist Removal Yes/No Confirmation Dialog */}
      <ConfirmDialog
        open={dismissingWaitlist !== null}
        onOpenChange={(open) => {
          if (!open) setDismissingWaitlist(null);
        }}
        title="Remove Waitlist Entry"
        description={
          <>
            Are you sure you want to remove{" "}
            <strong className="text-slate-900">
              {dismissingWaitlist?.patientName}
            </strong>{" "}
            ({dismissingWaitlist?.serviceName}) from today&apos;s standby
            waitlist?
          </>
        }
        cancelLabel="No"
        confirmLabel="Yes"
        confirmingLabel="Removing…"
        destructive
        isPending={dismissingBusy}
        onConfirm={handleConfirmDismissWaitlist}
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
          <AlertTitle>Connect Clerk &amp; Convex to activate Front Desk</AlertTitle>
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
        <div className="flex flex-1 items-center justify-center bg-[#F6F8FB] p-8 text-sm text-slate-500">
          Loading Front Desk…
        </div>
      }
    >
      <FrontDeskSearchResolver />
    </Suspense>
  );
}
