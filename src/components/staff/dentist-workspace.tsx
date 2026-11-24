"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CalendarCheck2,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileImage,
  FileText,
  Globe,
  Lock,
  Megaphone,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Component,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Odontogram } from "@/components/clinical/odontogram";
import { XrayVault } from "@/components/clinical/xray-vault";
import { useEnvConfig } from "@/components/providers/app-providers";
import { TimeOffBlockerDialog } from "@/components/staff/time-off-blocker";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatDateTime,
  formatShortDateKey,
  formatTimeInTimeZone,
  getErrorMessage,
  getTodayDateKeyInTimeZone,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type QueueViewMode = "day" | "week";

type NoteDraft = {
  clinicalNotes: string;
  postVisitInstructions: string;
};

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Returns Monday–Sunday range keys for the calendar week containing `dateKey`. */
function getWeekRangeForDateKey(dateKey: string): {
  startKey: string;
  endKey: string;
} {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return { startKey: dateKey, endKey: dateKey };
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startKey = addDaysToDateKey(dateKey, offsetToMonday);
  const endKey = addDaysToDateKey(startKey, 6);
  return { startKey, endKey };
}

/** Safe month-end clamped `"YYYY-MM-DD"` + 6 months (e.g. Aug 31 -> Feb 28/29). */
function addSixMonthsToDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const targetMonthIndex = m - 1 + 6;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(d, maxDay);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function formatDayHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

class StaffWorkspaceErrorBoundary extends Component<
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
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>Unable to load Dentist Clinical Workspace</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                {getErrorMessage(
                  this.state.error,
                  "You may not have dentist or clinic admin permissions for this workspace."
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => this.setState({ error: null })}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  render={<Link href="/post-login" />}
                >
                  Return to My Workspace
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </main>
      );
    }
    return this.props.children;
  }
}

function VisitNotesEditor({
  appointmentId,
  clinicalNotes,
  postVisitInstructions,
  isDirty,
  isReadOnly,
  onChange,
  onSaved,
}: {
  appointmentId: Id<"appointments">;
  clinicalNotes: string;
  postVisitInstructions: string;
  isDirty: boolean;
  isReadOnly: boolean;
  onChange: (next: NoteDraft) => void;
  onSaved: () => void;
}) {
  const updateNotes = useMutation(api.appointments.updateClinicalNotes);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateNotes({
        appointmentId,
        clinicalNotes,
        postVisitInstructions,
      });
      onSaved();
      toast.success("Clinical notes & aftercare instructions saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save clinical notes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="clin-notes">
            Chairside Clinical Notes (SOAP / Procedure)
          </Label>
          <Badge
            variant="secondary"
            className="gap-1 text-[10px] font-medium"
          >
            <Lock className="size-3" />
            Private · Staff-Only
          </Badge>
        </div>
        <textarea
          id="clin-notes"
          rows={4}
          disabled={isReadOnly}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          placeholder="Record anesthesia used, restorative material, occlusion check, and private clinical observations…"
          value={clinicalNotes}
          onChange={(e) =>
            onChange({
              clinicalNotes: e.target.value,
              postVisitInstructions,
            })
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Strictly hidden from the patient portal. Visible only to authorized
          clinic clinicians.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="post-visit">Patient Post-Visit Instructions</Label>
          <Badge
            variant="outline"
            className="gap-1 border-sky-500/40 bg-sky-500/10 text-[10px] font-medium text-sky-800 dark:text-sky-200"
          >
            <Globe className="size-3" />
            Patient-Visible · Shown in Portal
          </Badge>
        </div>
        <textarea
          id="post-visit"
          rows={3}
          disabled={isReadOnly}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          placeholder="e.g., Avoid hot beverages for 2 hours; rinse gently with warm saltwater; take ibuprofen if mild soreness occurs."
          value={postVisitInstructions}
          onChange={(e) =>
            onChange({
              clinicalNotes,
              postVisitInstructions: e.target.value,
            })
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Displayed to the patient in their Smile portal after this visit.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" disabled={isReadOnly || saving}>
          <Save className="mr-1.5 size-4" />
          {saving ? "Saving…" : "Save Visit Notes"}
        </Button>
        {isDirty ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Unsaved changes (also saved automatically on Complete Visit)
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ConnectedDentistWorkspace({
  overrideClinicId,
}: {
  overrideClinicId?: Id<"clinics">;
}) {
  const [viewMode, setViewMode] = useState<QueueViewMode>("day");
  const [dateKey, setDateKey] = useState<string>(() =>
    getTodayDateKeyInTimeZone("Asia/Manila")
  );
  const [pickedDentistId, setPickedDentistId] = useState<
    Id<"dentists"> | undefined
  >(undefined);
  const [pickedAppointmentId, setPickedAppointmentId] =
    useState<Id<"appointments"> | null>(null);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [draftsByAppt, setDraftsByAppt] = useState<Record<string, NoteDraft>>(
    {}
  );
  const [nowRef] = useState<number>(() => Date.now());

  const weekRange = useMemo(() => getWeekRangeForDateKey(dateKey), [dateKey]);
  const rangeStartKey = viewMode === "week" ? weekRange.startKey : dateKey;
  const rangeEndKey = viewMode === "week" ? weekRange.endKey : dateKey;

  const queueData = useQuery(api.appointments.getDentistQueue, {
    dateKey,
    rangeStartKey,
    rangeEndKey,
    dentistId: pickedDentistId,
    overrideClinicId,
  });

  const timeOffSummary = useQuery(
    api.appointments.getDentistTimeOff,
    queueData?.selectedDentistId
      ? {
          dentistId: queueData.selectedDentistId,
          overrideClinicId,
        }
      : "skip"
  );

  // Real-time arrival notification detector when Front Desk moves a patient to Checked In / In Chair
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const prevScopeRef = useRef<string>("");

  useEffect(() => {
    if (!queueData) return;
    const scopeKey = `${queueData.selectedDentistId ?? "none"}:${rangeStartKey}:${rangeEndKey}`;
    const nextMap = new Map<string, string>();
    for (const item of queueData.queue) {
      nextMap.set(item._id, item.status);
    }

    if (prevScopeRef.current === scopeKey) {
      for (const item of queueData.queue) {
        const previous = prevStatusRef.current.get(item._id);
        if (previous && previous !== item.status) {
          if (item.status === "checked_in") {
            toast.info(
              `Patient Checked In: ${item.patientName} has arrived for ${item.serviceName}.`
            );
          } else if (item.status === "in_chair") {
            toast.success(
              `Patient Seated: ${item.patientName} is now In Chair (${item.chairRoomCode || item.chairName}).`
            );
          }
        }
      }
    }

    prevScopeRef.current = scopeKey;
    prevStatusRef.current = nextMap;
  }, [queueData, rangeStartKey, rangeEndKey]);

  const activeAppointment = useMemo(() => {
    if (!queueData || queueData.queue.length === 0) return null;
    if (pickedAppointmentId) {
      const match = queueData.queue.find((a) => a._id === pickedAppointmentId);
      if (match) return match;
    }
    return (
      queueData.queue.find((a) => a.status === "in_chair") ??
      queueData.queue.find((a) => a.status === "checked_in") ??
      queueData.queue[0]
    );
  }, [queueData, pickedAppointmentId]);

  const patientChart = useQuery(
    api.odontogram.getPatientChart,
    activeAppointment
      ? {
          patientId: activeAppointment.patientId,
          overrideClinicId,
        }
      : "skip"
  );

  const transitionStatus = useMutation(api.appointments.transitionStatus);
  const setPatientRecallDate = useMutation(api.odontogram.setPatientRecallDate);

  const activeDraft: NoteDraft = useMemo(() => {
    if (!activeAppointment) {
      return { clinicalNotes: "", postVisitInstructions: "" };
    }
    const existing = draftsByAppt[activeAppointment._id];
    if (existing) return existing;
    return {
      clinicalNotes: activeAppointment.clinicalNotes ?? "",
      postVisitInstructions: activeAppointment.postVisitInstructions ?? "",
    };
  }, [activeAppointment, draftsByAppt]);

  const isNotesDirty = Boolean(
    activeAppointment &&
      draftsByAppt[activeAppointment._id] &&
      (activeDraft.clinicalNotes !== (activeAppointment.clinicalNotes ?? "") ||
        activeDraft.postVisitInstructions !==
          (activeAppointment.postVisitInstructions ?? ""))
  );

  const clearDraftForAppointment = (appointmentId: Id<"appointments">) => {
    setDraftsByAppt((prev) => {
      if (!(appointmentId in prev)) return prev;
      const copy = { ...prev };
      delete copy[appointmentId];
      return copy;
    });
  };

  const handleChairStatus = async (
    appointmentId: Id<"appointments">,
    status: "in_chair" | "completed"
  ) => {
    try {
      const draft = draftsByAppt[appointmentId];
      const payload: {
        appointmentId: Id<"appointments">;
        status: "in_chair" | "completed";
        clinicalNotes?: string;
        postVisitInstructions?: string;
      } = { appointmentId, status };

      // Atomically persist any unsaved clinical notes / aftercare instructions on visit completion
      if (status === "completed" && draft) {
        payload.clinicalNotes = draft.clinicalNotes;
        payload.postVisitInstructions = draft.postVisitInstructions;
      }

      const res = await transitionStatus(payload);
      if (status === "completed" && draft) {
        clearDraftForAppointment(appointmentId);
      }

      if (res.hygieneRecallScheduledFor) {
        toast.success(
          `Visit completed! 6-month hygiene recall automatically set for ${res.hygieneRecallScheduledFor}.`
        );
      } else {
        toast.success(`Appointment marked ${status.replace("_", " ")}.`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update appointment status."));
    }
  };

  const handleOneClickRecall = async (
    patientId: Id<"patients">,
    visitDateKey: string
  ) => {
    const nextRecallDate = addSixMonthsToDateKey(visitDateKey);
    try {
      await setPatientRecallDate({
        patientId,
        lastCleaningDate: visitDateKey,
        nextRecallDate,
      });
      toast.success(`6-month hygiene recall set for ${nextRecallDate}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not schedule recall."));
    }
  };

  if (queueData === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading chairside workspace…
      </main>
    );
  }

  const { clinic, plan, isReadOnly, readOnlyReason, isSuperAdminOverride } =
    queueData;
  const clinicTimeZone = clinic.timezone || "Asia/Manila";
  const inChairCount = queueData.queue.filter(
    (q) => q.status === "in_chair"
  ).length;
  const checkedInCount = queueData.queue.filter(
    (q) => q.status === "checked_in"
  ).length;
  const upcomingTimeOffCount = (timeOffSummary?.blocks ?? []).filter(
    (b) => b.endTimeUtc >= nowRef
  ).length;

  const canAccessFrontDesk =
    queueData.user.role === "clinic_admin" || isSuperAdminOverride;

  const buildViewHref = (base: string) =>
    overrideClinicId
      ? `${base}?viewAsClinicId=${encodeURIComponent(overrideClinicId)}`
      : base;

  const medicalHistory = patientChart?.patient.medicalHistory;
  const showCrimsonAlert = Boolean(
    medicalHistory &&
      (medicalHistory.allergies.length > 0 ||
        medicalHistory.isTakingBloodThinners ||
        medicalHistory.isPregnant ||
        medicalHistory.dentalAnxietyLevel === "severe")
  );

  // Group queue cards by dateKey when in Weekly view
  const groupedQueue = (() => {
    const groups: { dateKey: string; items: typeof queueData.queue }[] = [];
    for (const item of queueData.queue) {
      const existing = groups.find((g) => g.dateKey === item.dateKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({ dateKey: item.dateKey, items: [item] });
      }
    }
    return groups;
  })();

  const stepAmount = viewMode === "week" ? 7 : 1;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      {/* Impersonation, Past-Due & Read-Only Banners */}
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
            <strong>Subscription Renewal Needed (Grace Period):</strong>{" "}
            Clinical charting remains active during the 3-day grace window.
            Please notify your Clinic Admin to renew the plan.
          </span>
        </div>
      ) : null}

      {isReadOnly && !isSuperAdminOverride ? (
        <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-900 dark:text-rose-200">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            <strong>Read-Only Clinical Mode:</strong>{" "}
            {readOnlyReason ??
              "Existing patient charts, odontograms, and X-rays remain viewable for clinical continuity, while new writes are paused until subscription renewal."}
          </span>
        </div>
      ) : null}

      {(queueData.announcements ?? []).slice(0, 2).map((ann) => (
        <div
          key={ann._id}
          className={`flex items-start gap-2 border-b px-6 py-2 text-xs ${
            ann.severity === "critical"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200"
              : ann.severity === "warning"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                : "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200"
          }`}
        >
          <Megaphone className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>{ann.title}:</strong> {ann.message}
          </span>
        </div>
      ))}

      {/* Top Header */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex items-center gap-3">
          <span
            className="flex size-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: clinic.primaryColorHex }}
          >
            <Stethoscope className="size-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold leading-tight">
                {clinic.name} · Clinical Workspace
              </h1>
              {inChairCount > 0 ? (
                <Badge className="animate-pulse bg-emerald-600 text-[11px] text-white">
                  {inChairCount} In Chair
                </Badge>
              ) : null}
              {checkedInCount > 0 ? (
                <Badge className="gap-1 bg-indigo-600 text-[11px] text-white">
                  <BellRing className="size-3" />
                  {checkedInCount} Checked In
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Chair queue, 32-tooth SVG odontogram, compressed X-ray vault &amp;
              time-off blocker
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {queueData.canSwitchDentist && queueData.dentists.length > 1 ? (
            <Select
              value={queueData.selectedDentistId ?? ""}
              onValueChange={(v) => {
                if (v) setPickedDentistId(v as Id<"dentists">);
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select dentist" />
              </SelectTrigger>
              <SelectContent>
                {queueData.dentists.map((d) => (
                  <SelectItem key={d._id} value={d._id}>
                    {d.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {/* Day / Week Toggle */}
          <div className="inline-flex items-center rounded-lg border p-0.5">
            <Button
              size="xs"
              variant={viewMode === "day" ? "default" : "ghost"}
              onClick={() => setViewMode("day")}
            >
              Day
            </Button>
            <Button
              size="xs"
              variant={viewMode === "week" ? "default" : "ghost"}
              onClick={() => setViewMode("week")}
            >
              <CalendarDays className="mr-1 size-3" />
              Week
            </Button>
          </div>

          {/* Date / Week Stepper */}
          <div className="flex items-center rounded-lg border">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={viewMode === "week" ? "Previous week" : "Previous day"}
              onClick={() => setDateKey((k) => addDaysToDateKey(k, -stepAmount))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-mono text-xs"
              title="Jump to today"
              onClick={() =>
                setDateKey(getTodayDateKeyInTimeZone(clinicTimeZone))
              }
            >
              {viewMode === "week"
                ? `${formatShortDateKey(weekRange.startKey)} – ${formatShortDateKey(weekRange.endKey)}`
                : dateKey}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={viewMode === "week" ? "Next week" : "Next day"}
              onClick={() => setDateKey((k) => addDaysToDateKey(k, stepAmount))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {queueData.selectedDentistId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTimeOffDialogOpen(true)}
            >
              <CalendarOff className="mr-1.5 size-3.5" />
              Time Off
              {upcomingTimeOffCount > 0 ? (
                <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">
                  {upcomingTimeOffCount}
                </Badge>
              ) : null}
            </Button>
          ) : null}

          {canAccessFrontDesk ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={buildViewHref("/front-desk")} />}
            >
              Front Desk
            </Button>
          ) : null}
          <UserButton />
        </div>
      </header>

      {/* Main Two-Column Chairside Layout */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 lg:grid-cols-[310px_1fr] lg:p-6">
        {/* Left: My Chair Queue */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {viewMode === "week" ? "Weekly Chair Queue" : "My Chair Queue"}
            </h2>
            <Badge variant="outline" className="font-mono">
              {queueData.queue.length}
            </Badge>
          </div>

          {queueData.user.role === "dentist" &&
          !queueData.hasLinkedDentistProfile ? (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>Dentist profile not linked</AlertTitle>
              <AlertDescription className="text-xs">
                Your account does not have an active dentist schedule profile in{" "}
                <strong>{clinic.name}</strong> yet. Ask your Clinic Admin to
                link your email under <code>/admin/dentists</code>.
              </AlertDescription>
            </Alert>
          ) : queueData.queue.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                No appointments scheduled for{" "}
                {viewMode === "week"
                  ? `${formatShortDateKey(weekRange.startKey)} – ${formatShortDateKey(weekRange.endKey)}`
                  : dateKey}
                .
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {groupedQueue.map((group) => (
                <div key={group.dateKey} className="space-y-2">
                  {viewMode === "week" ? (
                    <div className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>{formatDayHeading(group.dateKey)}</span>
                      <span className="font-mono">{group.items.length}</span>
                    </div>
                  ) : null}

                  {group.items.map((item) => {
                    const isSelected = activeAppointment?._id === item._id;
                    const isInChair = item.status === "in_chair";
                    const isCheckedIn = item.status === "checked_in";
                    return (
                      <button
                        key={item._id}
                        type="button"
                        onClick={() => setPickedAppointmentId(item._id)}
                        className={`w-full rounded-xl border p-3 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-accent/60 shadow-xs"
                            : "bg-card hover:bg-accent/30"
                        } ${
                          isInChair
                            ? "ring-2 ring-emerald-500/70"
                            : isCheckedIn
                              ? "ring-2 ring-indigo-500/60"
                              : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold leading-tight">
                              {item.patientName}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {item.serviceName}
                            </p>
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                            <Clock className="size-3" />
                            {formatTimeInTimeZone(
                              item.startTimeUtc,
                              clinicTimeZone
                            )}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              isInChair || isCheckedIn ? "default" : "secondary"
                            }
                            className={`text-[10px] capitalize ${
                              isInChair
                                ? "bg-emerald-600 text-white"
                                : isCheckedIn
                                  ? "bg-indigo-600 text-white"
                                  : ""
                            }`}
                          >
                            {isCheckedIn
                              ? "Checked In · Waiting"
                              : item.status.replace("_", " ")}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {item.chairRoomCode || item.chairName}
                          </Badge>
                          {item.hasMedicalAlert ? (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                            >
                              Med Alert
                            </Badge>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Right: Active Patient Chart, Medical Alert, Odontogram & X-Ray Vault */}
        <section className="min-w-0 space-y-5">
          {!activeAppointment ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Select a patient from your chair queue to open their clinical
                chart, 32-tooth odontogram, and X-ray vault.
              </CardContent>
            </Card>
          ) : patientChart === undefined ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Loading patient clinical chart…
              </CardContent>
            </Card>
          ) : (
            <>
              {/* High-Contrast Crimson Medical Alert Banner */}
              {showCrimsonAlert && medicalHistory ? (
                <div
                  role="alert"
                  className="rounded-xl border-2 border-red-600 bg-red-600 px-4 py-3 text-white shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <AlertOctagon className="mt-0.5 size-5 shrink-0" />
                    <div className="space-y-1 text-sm">
                      <p className="font-bold uppercase tracking-wide">
                        Critical Patient Medical Alert
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {medicalHistory.allergies.length > 0 ? (
                          <span className="rounded bg-white/20 px-2 py-0.5 font-semibold">
                            Allergies: {medicalHistory.allergies.join(", ")}
                          </span>
                        ) : null}
                        {medicalHistory.isTakingBloodThinners ? (
                          <span className="rounded bg-white/20 px-2 py-0.5 font-semibold">
                            Taking Blood Thinners
                          </span>
                        ) : null}
                        {medicalHistory.isPregnant ? (
                          <span className="rounded bg-white/20 px-2 py-0.5 font-semibold">
                            Pregnant
                          </span>
                        ) : null}
                        {medicalHistory.dentalAnxietyLevel === "severe" ? (
                          <span className="rounded bg-white/20 px-2 py-0.5 font-semibold">
                            Severe Dental Anxiety
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Patient Summary & Chair Controls */}
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-xl">
                        {patientChart.patient.firstName}{" "}
                        {patientChart.patient.lastName}
                      </CardTitle>
                      <Badge variant="outline" className="font-mono text-xs">
                        {activeAppointment.referenceCode}
                      </Badge>
                      <Badge
                        variant={
                          activeAppointment.status === "in_chair" ||
                          activeAppointment.status === "checked_in"
                            ? "default"
                            : "secondary"
                        }
                        className={`capitalize ${
                          activeAppointment.status === "in_chair"
                            ? "bg-emerald-600 text-white"
                            : activeAppointment.status === "checked_in"
                              ? "bg-indigo-600 text-white"
                              : ""
                        }`}
                      >
                        {activeAppointment.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <CardDescription>
                      DOB: {patientChart.patient.dateOfBirth} ·{" "}
                      {patientChart.patient.phone} ·{" "}
                      <strong>{activeAppointment.serviceName}</strong> (
                      {activeAppointment.chairName}) ·{" "}
                      {activeAppointment.dateKey}{" "}
                      {formatTimeInTimeZone(
                        activeAppointment.startTimeUtc,
                        clinicTimeZone
                      )}
                    </CardDescription>
                    {activeAppointment.chiefComplaint ? (
                      <p className="text-xs text-foreground/85">
                        <strong>Chief Complaint:</strong>{" "}
                        {activeAppointment.chiefComplaint}
                      </p>
                    ) : null}
                    {medicalHistory &&
                    (medicalHistory.conditions.length > 0 ||
                      medicalHistory.notes) ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                        {medicalHistory.conditions.length > 0 ? (
                          <span className="text-muted-foreground">
                            <strong>Conditions:</strong>{" "}
                            {medicalHistory.conditions.join(", ")}
                          </span>
                        ) : null}
                        {medicalHistory.notes ? (
                          <span className="text-muted-foreground">
                            · <strong>Medical Notes:</strong>{" "}
                            {medicalHistory.notes}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {patientChart.patient.nextRecallDate ? (
                      <p className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <CalendarCheck2 className="size-3.5" />
                        Next 6-Month Hygiene Recall:{" "}
                        {patientChart.patient.nextRecallDate}
                        {patientChart.patient.lastCleaningDate
                          ? ` (Last cleaning: ${patientChart.patient.lastCleaningDate})`
                          : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isReadOnly &&
                    activeAppointment.status !== "in_chair" &&
                    activeAppointment.status !== "completed" &&
                    activeAppointment.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleChairStatus(activeAppointment._id, "in_chair")
                        }
                      >
                        Start In Chair
                      </Button>
                    ) : null}
                    {!isReadOnly &&
                    activeAppointment.status !== "completed" &&
                    activeAppointment.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          handleChairStatus(activeAppointment._id, "completed")
                        }
                      >
                        <CheckCircle2 className="mr-1.5 size-4" />
                        Complete Visit
                      </Button>
                    ) : null}
                    {!isReadOnly ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleOneClickRecall(
                            patientChart.patient._id,
                            activeAppointment.dateKey
                          )
                        }
                      >
                        <Sparkles className="mr-1.5 size-3.5" />
                        Set 6-Mo Recall
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
              </Card>

              {/* Clinical Tabs: Odontogram, X-Ray Vault, Visit Notes */}
              <Tabs defaultValue="odontogram">
                <TabsList>
                  <TabsTrigger value="odontogram" className="gap-1.5">
                    <Stethoscope className="size-3.5" />
                    32-Tooth Odontogram ({patientChart.toothRecords.length})
                  </TabsTrigger>
                  <TabsTrigger value="xrays" className="gap-1.5">
                    <FileImage className="size-3.5" />
                    X-Rays &amp; Photos ({patientChart.files.length})
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="gap-1.5">
                    <FileText className="size-3.5" />
                    Visit Notes &amp; History
                    {isNotesDirty ? (
                      <span
                        className="size-1.5 rounded-full bg-amber-500"
                        title="Unsaved visit notes"
                      />
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="odontogram" className="mt-4">
                  <Odontogram
                    patientId={patientChart.patient._id}
                    appointmentId={activeAppointment._id}
                    dentistId={queueData.selectedDentistId ?? undefined}
                    records={patientChart.toothRecords}
                    enabled={patientChart.odontogramEnabled}
                    isReadOnly={isReadOnly}
                  />
                </TabsContent>

                <TabsContent value="xrays" className="mt-4">
                  <XrayVault
                    patientId={patientChart.patient._id}
                    appointmentId={activeAppointment._id}
                    files={patientChart.files}
                    enabled={patientChart.xrayStorageEnabled}
                    isReadOnly={isReadOnly}
                    storageUsedBytes={clinic.storageUsedBytes}
                    maxStorageBytes={plan?.maxStorageBytes}
                  />
                </TabsContent>

                <TabsContent value="notes" className="mt-4 space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Current Visit Clinical Notes
                      </CardTitle>
                      <CardDescription>
                        Document private chairside procedure notes and
                        patient-visible post-visit aftercare instructions.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <VisitNotesEditor
                        appointmentId={activeAppointment._id}
                        clinicalNotes={activeDraft.clinicalNotes}
                        postVisitInstructions={
                          activeDraft.postVisitInstructions
                        }
                        isDirty={isNotesDirty}
                        isReadOnly={isReadOnly}
                        onChange={(next) =>
                          setDraftsByAppt((prev) => ({
                            ...prev,
                            [activeAppointment._id]: next,
                          }))
                        }
                        onSaved={() =>
                          clearDraftForAppointment(activeAppointment._id)
                        }
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Past Clinic Visits (
                        {patientChart.recentAppointments.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {patientChart.recentAppointments.map((visit) => (
                        <div
                          key={visit._id}
                          className="space-y-1.5 rounded-lg border p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">
                              {visit.serviceName} · {visit.dentistName}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="secondary"
                                className="text-[10px] capitalize"
                              >
                                {visit.status.replace("_", " ")}
                              </Badge>
                              <span className="text-muted-foreground">
                                {formatDateTime(visit.startTimeUtc)}
                              </span>
                            </div>
                          </div>
                          {visit.clinicalNotes ? (
                            <p className="text-foreground/85">
                              <span className="font-semibold text-muted-foreground">
                                Private Note:{" "}
                              </span>
                              {visit.clinicalNotes}
                            </p>
                          ) : null}
                          {visit.postVisitInstructions ? (
                            <p className="text-sky-900 dark:text-sky-200">
                              <span className="font-semibold">
                                Patient Aftercare:{" "}
                              </span>
                              {visit.postVisitInstructions}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </section>
      </main>

      {/* Personal Time-Off & Break Blocker Dialog */}
      {queueData.selectedDentistId ? (
        <TimeOffBlockerDialog
          open={timeOffDialogOpen}
          onOpenChange={setTimeOffDialogOpen}
          dentistId={queueData.selectedDentistId}
          clinicTimezone={clinicTimeZone}
          defaultDateKey={dateKey}
          isReadOnly={isReadOnly}
          overrideClinicId={overrideClinicId}
        />
      ) : null}
    </div>
  );
}

function StaffSearchResolver() {
  const { isConfigured } = useEnvConfig();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAsClinicId")?.trim() || undefined;
  const overrideClinicId = viewAs as Id<"clinics"> | undefined;

  if (!isConfigured) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>
            Connect Clerk &amp; Convex to activate Dentist Workspace
          </AlertTitle>
          <AlertDescription>
            Configure <code>.env.local</code> and run{" "}
            <code>npx convex dev</code> to open the dentist chair queue,
            32-tooth SVG odontogram, compressed X-ray vault, and time-off
            blocker.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <StaffWorkspaceErrorBoundary>
      <ConnectedDentistWorkspace overrideClinicId={overrideClinicId} />
    </StaffWorkspaceErrorBoundary>
  );
}

export function DentistWorkspace() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading Dentist Clinical Workspace…
        </div>
      }
    >
      <StaffSearchResolver />
    </Suspense>
  );
}
