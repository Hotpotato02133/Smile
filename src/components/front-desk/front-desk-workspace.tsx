"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Kanban,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type CalendarAppointmentItem,
  MasterCalendar,
} from "@/components/front-desk/master-calendar";
import { WalkInBookingDialog } from "@/components/front-desk/walk-in-booking-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type KanbanStatus = "confirmed" | "checked_in" | "in_chair" | "completed";

const KANBAN_COLUMNS: {
  id: KanbanStatus;
  title: string;
  subtitle: string;
  statuses: string[];
  accentClass: string;
}[] = [
  {
    id: "confirmed",
    title: "Scheduled Today",
    subtitle: "Confirmed & awaiting arrival",
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
    title: "Completed / Checkout",
    subtitle: "Ready for billing & recall",
    statuses: ["completed"],
    accentClass: "border-t-slate-500",
  },
];

function toLocalDateKey(date: Date): string {
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

function formatTimeOnly(ms: number): string {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
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
  const [draggedApptId, setDraggedApptId] =
    useState<Id<"appointments"> | null>(null);
  const [selectedAppt, setSelectedAppt] =
    useState<CalendarAppointmentItem | null>(null);

  const dateKey = useMemo(() => toLocalDateKey(selectedDate), [selectedDate]);
  // Fetch a 7-day range centered around selectedDate so Week & Agenda views populate seamlessly
  const rangeStartKey = useMemo(
    () => toLocalDateKey(addDays(selectedDate, -3)),
    [selectedDate]
  );
  const rangeEndKey = useMemo(
    () => toLocalDateKey(addDays(selectedDate, 6)),
    [selectedDate]
  );

  const workspace = useQuery(api.appointments.getFrontDeskWorkspace, {
    dateKey,
    rangeStartKey,
    rangeEndKey,
    overrideClinicId,
  });

  const transitionStatus = useMutation(api.appointments.transitionStatus);

  const handleTransition = async (
    appointmentId: Id<"appointments">,
    status:
      | "confirmed"
      | "checked_in"
      | "in_chair"
      | "completed"
      | "cancelled"
      | "no_show"
  ) => {
    try {
      const res = await transitionStatus({ appointmentId, status });
      if (res.hygieneRecallScheduledFor) {
        toast.success(
          `Marked completed & scheduled 6-month recall for ${res.hygieneRecallScheduledFor}.`
        );
      } else if (res.waitlistMatchedCount > 0) {
        toast.info(
          `Cancelled — notified ${res.waitlistMatchedCount} waitlisted patient(s).`
        );
      } else {
        toast.success(`Status updated to ${status.replace("_", " ")}.`);
      }
      setSelectedAppt(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update appointment status."));
    }
  };

  if (workspace === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading front-desk command center…
      </main>
    );
  }

  const { clinic, isReadOnly, isSuperAdminOverride } = workspace;
  const todaysAppointments = workspace.appointments.filter(
    (a) => a.dateKey === dateKey
  );

  const buildViewHref = (base: string) =>
    overrideClinicId
      ? `${base}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
      : base;

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

      {clinic.status === "past_due" ? (
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

      {clinic.status === "suspended" || clinic.status === "archived" ? (
        <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-900 dark:text-rose-200">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            <strong>Read-Only Mode ({clinic.status}):</strong> Schedule viewing
            is enabled; creating or modifying appointments is paused.
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
              Live check-in Kanban & multi-chair master calendar
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
              onClick={() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                setSelectedDate(today);
              }}
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
            defaultDateKey={dateKey}
            dentists={workspace.dentists}
            chairs={workspace.chairs}
            services={workspace.services}
            disabled={isReadOnly}
            overrideClinicId={overrideClinicId}
          />

          <Button
            size="sm"
            variant="outline"
            render={<Link href={buildViewHref("/staff")} />}
          >
            <Stethoscope className="mr-1.5 size-3.5" />
            Dentist View
          </Button>
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

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 lg:p-6">
        <Tabs defaultValue="kanban">
          <TabsList>
            <TabsTrigger value="kanban" className="gap-1.5">
              <Kanban className="size-3.5" />
              Patient Flow Kanban ({todaysAppointments.filter((a) => a.status !== "cancelled" && a.status !== "no_show").length})
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

          {/* TAB 1: LIVE 4-COLUMN CHECK-IN KANBAN BOARD */}
          <TabsContent value="kanban" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {KANBAN_COLUMNS.map((col) => {
                const cards = todaysAppointments.filter((a) =>
                  col.statuses.includes(a.status)
                );
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => {
                      if (!isReadOnly) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!isReadOnly && draggedApptId) {
                        void handleTransition(draggedApptId, col.id);
                        setDraggedApptId(null);
                      }
                    }}
                    className={`flex min-h-[420px] flex-col rounded-xl border border-t-4 bg-muted/20 p-3 ${col.accentClass}`}
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
                        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                          No patients in this stage
                        </div>
                      ) : (
                        cards.map((appt) => (
                          <div
                            key={appt._id}
                            draggable={!isReadOnly}
                            onDragStart={() => setDraggedApptId(appt._id)}
                            onDragEnd={() => setDraggedApptId(null)}
                            className="space-y-2 rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold leading-tight">
                                  {appt.patientName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {appt.serviceName}
                                </p>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                                <Clock className="size-3" />
                                {formatTimeOnly(appt.startTimeUtc)}
                              </span>
                            </div>

                            {appt.hasMedicalAlert ? (
                              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-800 dark:text-rose-200">
                                Medical Alert
                                {appt.medicalSummary?.allergies.length
                                  ? `: ${appt.medicalSummary.allergies.join(", ")}`
                                  : ""}
                              </div>
                            ) : null}

                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span
                                className="size-2 rounded-full"
                                style={{
                                  backgroundColor: appt.dentistColorHex,
                                }}
                              />
                              <span>{appt.dentistName}</span>
                              <span>·</span>
                              <span className="font-mono">
                                {appt.chairRoomCode || appt.chairName}
                              </span>
                            </div>

                            {!isReadOnly ? (
                              <div className="flex flex-wrap gap-1.5 border-t pt-2">
                                {col.id === "confirmed" ? (
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
                                {col.id === "checked_in" ? (
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
                                {col.id === "in_chair" ? (
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
                            ) : null}
                          </div>
                        ))
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
                  Color-coded by dentist across all active operatory chairs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MasterCalendar
                  date={selectedDate}
                  onNavigateDate={setSelectedDate}
                  appointments={workspace.appointments}
                  chairs={workspace.chairs}
                  dentists={workspace.dentists}
                  onSelectAppointment={setSelectedAppt}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: STANDBY WAITLIST */}
          <TabsContent value="waitlist" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Standby Waitlist for {dateKey}</CardTitle>
                <CardDescription>
                  When a confirmed appointment is cancelled, waiting patients
                  for this date are automatically notified if Waitlist Blast is
                  enabled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workspace.waitlist.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No patients on the standby waitlist for {dateKey}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {workspace.waitlist.map((w) => (
                      <div
                        key={w._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">{w.patientName}</p>
                          <p className="text-xs text-muted-foreground">
                            {w.serviceName} · {w.preferredDentistName} · Window:{" "}
                            <span className="capitalize">
                              {w.preferredTimeWindow}
                            </span>{" "}
                            · {w.patientPhone}
                          </p>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {w.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Appointment Action Dialog */}
      <Dialog
        open={selectedAppt !== null}
        onOpenChange={(open) => !open && setSelectedAppt(null)}
      >
        <DialogContent className="sm:max-w-md">
          {selectedAppt ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedAppt.patientName}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    ({selectedAppt.referenceCode})
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {selectedAppt.serviceName} ·{" "}
                  {formatDateTime(selectedAppt.startTimeUtc)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 rounded-lg border bg-muted/25 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dentist</span>
                  <span className="font-medium">{selectedAppt.dentistName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Operatory</span>
                  <span className="font-medium">
                    {selectedAppt.chairRoomCode} · {selectedAppt.chairName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="secondary" className="capitalize">
                    {selectedAppt.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>

              {!isReadOnly ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleTransition(selectedAppt._id, "checked_in")
                    }
                  >
                    Mark Checked In
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleTransition(selectedAppt._id, "in_chair")
                    }
                  >
                    Seat In Chair
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleTransition(selectedAppt._id, "completed")
                    }
                  >
                    Mark Completed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleTransition(selectedAppt._id, "no_show")
                    }
                  >
                    Mark No-Show
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="col-span-2"
                    onClick={() =>
                      handleTransition(selectedAppt._id, "cancelled")
                    }
                  >
                    Cancel Appointment (Check Waitlist)
                  </Button>
                </div>
              ) : null}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSelectedAppt(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
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

  return <ConnectedFrontDesk overrideClinicId={overrideClinicId} />;
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
