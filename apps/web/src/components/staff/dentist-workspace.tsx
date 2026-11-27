"use client";

import { UserButton } from "@clerk/nextjs";
import { useApiAuth, useMutation, useQuery } from "@/lib/api";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
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
  HardDrive,
  ListFilter,
  Lock,
  Megaphone,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
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
import { AccountDeactivatedCard } from "@/components/auth/account-deactivated-card";
import { Odontogram } from "@/components/clinical/odontogram";
import { XrayVault } from "@/components/clinical/xray-vault";
import { useEnvConfig } from "@/components/providers/app-providers";
import { TimeOffBlockerDialog } from "@/components/staff/time-off-blocker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatShortDateKey,
  formatTimeInTimeZone,
  getErrorMessage,
  getTodayDateKeyInTimeZone,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

type QueueViewMode = "day" | "week";
type QueueStatusFilter = "all" | "waiting" | "in_chair" | "completed";

type NoteDraft = {
  clinicalNotes: string;
  postVisitInstructions: string;
};

const ROLE_LABELS: Record<string, string> = {
  dentist: "Dentist",
  clinic_admin: "Clinic Admin",
  super_admin: "Super Admin",
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

function formatReadableDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getStatusVisual(status: string): {
  label: string;
  dotClass: string;
  pillClass: string;
} {
  switch (status) {
    case "in_chair":
      return {
        label: "In Chair",
        dotClass: "bg-emerald-500",
        pillClass: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
      };
    case "checked_in":
      return {
        label: "Checked In · Waiting",
        dotClass: "bg-[#6C5CE7]",
        pillClass: "border-[#6C5CE7]/25 bg-[#F1EEFF] text-[#4F3EC7]",
      };
    case "completed":
      return {
        label: "Completed",
        dotClass: "bg-slate-400",
        pillClass: "border-slate-200 bg-slate-100 text-slate-700",
      };
    case "no_show":
      return {
        label: "No-Show",
        dotClass: "bg-orange-500",
        pillClass: "border-orange-200/80 bg-orange-50 text-orange-800",
      };
    case "pending_approval":
      return {
        label: "Pending",
        dotClass: "bg-amber-500",
        pillClass: "border-amber-200/90 bg-amber-50 text-amber-900",
      };
    default:
      return {
        label: "Scheduled",
        dotClass: "bg-sky-500",
        pillClass: "border-sky-200/80 bg-sky-50 text-sky-800",
      };
  }
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
      const msg = getErrorMessage(
        this.state.error,
        "You may not have dentist or clinic admin permissions for this workspace."
      );
      if (
        msg.toLowerCase().includes("deactivated") ||
        msg.toLowerCase().includes("inactive")
      ) {
        return <AccountDeactivatedCard reason={msg} />;
      }
      return (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>Unable to load Dentist Clinical Workspace</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>{msg}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => this.setState({ error: null })}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  className="rounded-full bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label
            htmlFor="clin-notes"
            className="text-sm font-semibold text-slate-900"
          >
            Chairside Clinical Notes (SOAP / Procedure)
          </Label>
          <Badge
            variant="outline"
            className="gap-1 rounded-full border-slate-200 bg-[#F8FAFC] px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
          >
            <Lock className="size-3" />
            Private · Staff-Only
          </Badge>
        </div>
        <textarea
          id="clin-notes"
          rows={4}
          disabled={isReadOnly}
          className="flex w-full rounded-xl border border-slate-200/90 bg-[#F8FAFC]/70 px-3.5 py-2.5 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-[#6C5CE7] focus:bg-white focus:ring-2 focus:ring-[#6C5CE7]/20 disabled:opacity-60"
          placeholder="Record anesthesia used, restorative material, occlusion check, and private clinical observations…"
          value={clinicalNotes}
          onChange={(e) =>
            onChange({
              clinicalNotes: e.target.value,
              postVisitInstructions,
            })
          }
        />
        <p className="text-xs text-slate-500">
          Strictly hidden from the patient portal. Visible only to authorized
          clinic clinicians.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label
            htmlFor="post-visit"
            className="text-sm font-semibold text-slate-900"
          >
            Patient Post-Visit Instructions
          </Label>
          <Badge
            variant="outline"
            className="gap-1 rounded-full border-sky-200/90 bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-800"
          >
            <Globe className="size-3" />
            Patient-Visible · Shown in Portal
          </Badge>
        </div>
        <textarea
          id="post-visit"
          rows={3}
          disabled={isReadOnly}
          className="flex w-full rounded-xl border border-slate-200/90 bg-[#F8FAFC]/70 px-3.5 py-2.5 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-[#6C5CE7] focus:bg-white focus:ring-2 focus:ring-[#6C5CE7]/20 disabled:opacity-60"
          placeholder="e.g., Avoid hot beverages for 2 hours; rinse gently with warm saltwater; take ibuprofen if mild soreness occurs."
          value={postVisitInstructions}
          onChange={(e) =>
            onChange({
              clinicalNotes,
              postVisitInstructions: e.target.value,
            })
          }
        />
        <p className="text-xs text-slate-500">
          Displayed to the patient in their Smile portal after this visit.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <Button
          type="submit"
          disabled={isReadOnly || saving}
          className="h-9 rounded-full bg-[#6C5CE7] px-5 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <Save className="mr-1.5 size-3.5" />
          {saving ? "Saving…" : "Save Visit Notes"}
        </Button>
        {isDirty ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Unsaved changes (auto-saved on Complete Visit)
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
  const { isAuthenticated, isLoading: authLoading } = useApiAuth();
  const [viewMode, setViewMode] = useState<QueueViewMode>("day");
  const [dateKey, setDateKey] = useState<string>(() =>
    getTodayDateKeyInTimeZone("Asia/Manila")
  );
  const [pickedDentistId, setPickedDentistId] = useState<
    Id<"dentists"> | undefined
  >(undefined);
  const [pickedAppointmentId, setPickedAppointmentId] =
    useState<Id<"appointments"> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("all");
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [draftsByAppt, setDraftsByAppt] = useState<Record<string, NoteDraft>>(
    {}
  );
  const [nowRef] = useState<number>(() => Date.now());

  const weekRange = useMemo(() => getWeekRangeForDateKey(dateKey), [dateKey]);
  const rangeStartKey = viewMode === "week" ? weekRange.startKey : dateKey;
  const rangeEndKey = viewMode === "week" ? weekRange.endKey : dateKey;

  const currentUser = useQuery(
    api.users.current,
    isAuthenticated ? {} : "skip"
  );
  const isDeactivated = Boolean(currentUser && !currentUser.isActive);

  const queueData = useQuery(
    api.appointments.getDentistQueue,
    isAuthenticated && currentUser !== undefined && !isDeactivated
      ? {
          dateKey,
          rangeStartKey,
          rangeEndKey,
          dentistId: pickedDentistId,
          overrideClinicId,
        }
      : "skip"
  );

  const timeOffSummary = useQuery(
    api.appointments.getDentistTimeOff,
    isAuthenticated && queueData?.selectedDentistId
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
    isAuthenticated && activeAppointment
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

  if (!authLoading && !isAuthenticated) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 items-center p-6">
        <Alert className="p-5">
          <ShieldCheck className="size-4" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p className="text-xs text-slate-600">
              Please sign in with your dentist or clinic staff account to open
              the chairside workspace.
            </p>
            <Button
              size="sm"
              render={<Link href="/sign-in?redirect_url=%2Fstaff" />}
              className="rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
            >
              Sign In
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (isDeactivated) {
    return <AccountDeactivatedCard />;
  }

  if (
    authLoading ||
    (isAuthenticated && currentUser === undefined) ||
    queueData === undefined
  ) {
    return (
      <div className="flex min-h-screen flex-1 flex-col bg-[#F6F8FB]">
        <div className="border-b border-slate-200/80 bg-white">
          <div className="mx-auto flex h-16 max-w-[1520px] items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="size-9 animate-pulse rounded-xl bg-slate-200" />
              <div className="space-y-1.5">
                <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
            <div className="h-9 w-64 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
        <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
          <div className="h-28 animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
          <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
            <div className="h-[460px] animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
            <div className="h-[460px] animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
          </div>
        </main>
      </div>
    );
  }

  const { clinic, plan, isReadOnly, readOnlyReason, isSuperAdminOverride } =
    queueData;
  const clinicTimeZone = clinic.timezone || "Asia/Manila";
  const clinicTodayKey = getTodayDateKeyInTimeZone(clinicTimeZone);
  const isViewingToday = viewMode === "day" && dateKey === clinicTodayKey;

  const activeDentist =
    queueData.dentists.find((d) => d._id === queueData.selectedDentistId) ??
    queueData.dentists[0] ??
    null;

  const inChairItems = queueData.queue.filter((q) => q.status === "in_chair");
  const checkedInItems = queueData.queue.filter(
    (q) => q.status === "checked_in"
  );
  const completedCount = queueData.queue.filter(
    (q) => q.status === "completed"
  ).length;
  const upcomingQueueItems = queueData.queue.filter(
    (q) => q.status === "confirmed" || q.status === "pending_approval"
  );

  const upcomingTimeOffBlocks = (timeOffSummary?.blocks ?? []).filter(
    (b) => b.endTimeUtc >= nowRef
  );

  const canAccessFrontDesk =
    queueData.user.role === "clinic_admin" || isSuperAdminOverride;
  const canAccessClinicAdmin =
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

  // Instant queue search + status filter (essential for busy days and Week view)
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const hasQueueFilters = Boolean(normalizedSearch) || statusFilter !== "all";

  const filteredQueue = queueData.queue.filter((item) => {
    if (statusFilter === "waiting" && item.status !== "checked_in") {
      return false;
    }
    if (statusFilter === "in_chair" && item.status !== "in_chair") {
      return false;
    }
    if (statusFilter === "completed" && item.status !== "completed") {
      return false;
    }
    if (normalizedSearch) {
      const hay =
        `${item.patientName} ${item.patientPhone} ${item.serviceName} ${item.chairRoomCode} ${item.chairName} ${item.referenceCode}`.toLowerCase();
      return hay.includes(normalizedSearch);
    }
    return true;
  });

  // Group filtered queue cards by dateKey when in Weekly view
  const groupedQueue = (() => {
    const groups: { dateKey: string; items: typeof filteredQueue }[] = [];
    for (const item of filteredQueue) {
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
  const formattedDateLabel =
    viewMode === "week"
      ? `${formatShortDateKey(weekRange.startKey)} – ${formatShortDateKey(weekRange.endKey)}`
      : formatReadableDateKey(dateKey);

  const storageQuotaPct =
    plan?.maxStorageBytes && plan.maxStorageBytes > 0
      ? Math.min(
          100,
          Math.round((clinic.storageUsedBytes / plan.maxStorageBytes) * 100)
        )
      : null;

  const handleSelectAppointment = (id: Id<"appointments">) => {
    setPickedAppointmentId(id);
    setMobileQueueOpen(false);
  };

  const handleJumpToday = () => {
    setViewMode("day");
    setDateKey(getTodayDateKeyInTimeZone(clinicTimeZone));
  };

  const renderQueuePanelBody = () => {
    if (
      queueData.user.role === "dentist" &&
      !queueData.hasLinkedDentistProfile
    ) {
      return (
        <div className="p-4">
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>Dentist profile not linked</AlertTitle>
            <AlertDescription className="text-xs">
              Your account does not have an active dentist schedule profile in{" "}
              <strong>{clinic.name}</strong> yet. Ask your Clinic Admin to link
              your email under <code>/admin/dentists</code>.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    if (queueData.queue.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <CalendarDays className="size-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-800">
            No appointments queued
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Clear schedule for {formattedDateLabel}.
          </p>
          {viewMode === "day" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setViewMode("week")}
              className="mt-3.5 h-8 rounded-full border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-[#6C5CE7]/40 hover:text-[#6C5CE7]"
            >
              <CalendarDays className="mr-1.5 size-3.5" />
              Preview Week
            </Button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Search & Status Filter Strip */}
        <div className="space-y-2.5 border-b border-slate-100 bg-white px-3.5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient, service, chair…"
              className="h-8.5 rounded-full border-slate-200/90 bg-[#F8FAFC] pr-8 pl-8 text-xs focus:bg-white"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear queue search"
                onClick={() => setSearchQuery("")}
                className="absolute top-2.5 right-2.5 cursor-pointer text-slate-400 hover:text-slate-700"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "all", label: `All (${queueData.queue.length})` },
                { id: "waiting", label: `Waiting (${checkedInItems.length})` },
                { id: "in_chair", label: `In Chair (${inChairItems.length})` },
                { id: "completed", label: `Done (${completedCount})` },
              ] as const
            ).map((chip) => {
              const active = statusFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatusFilter(chip.id)}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200/80 bg-[#F8FAFC] text-slate-600 hover:border-slate-300 hover:text-slate-950"
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Queue Cards */}
        <div className="flex-1 space-y-3 overflow-y-auto bg-[#F8FAFC]/65 p-3">
          {filteredQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <p className="text-xs font-medium text-slate-600">
                No patients match your current filter.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
                className="mt-2 h-7 rounded-full px-3 text-xs text-[#6C5CE7]"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            groupedQueue.map((group) => (
              <div key={group.dateKey} className="space-y-2">
                {viewMode === "week" ? (
                  <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-500">
                    <span>{formatDayHeading(group.dateKey)}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                      {group.items.length}
                    </span>
                  </div>
                ) : null}

                {group.items.map((item) => {
                  const isSelected = activeAppointment?._id === item._id;
                  const visual = getStatusVisual(item.status);
                  const allergies = item.medicalHistory?.allergies ?? [];

                  return (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => handleSelectAppointment(item._id)}
                      className={cn(
                        "w-full cursor-pointer space-y-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
                        isSelected
                          ? "border-[#6C5CE7] bg-[#F1EEFF]/55"
                          : "border-slate-200/85 bg-white hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight text-slate-950">
                            {item.patientName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {item.serviceName}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/80 bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
                          <Clock className="size-3 text-slate-400" />
                          {formatTimeInTimeZone(
                            item.startTimeUtc,
                            clinicTimeZone
                          )}
                        </span>
                      </div>

                      {item.hasMedicalAlert ? (
                        <div className="rounded-lg border border-rose-200/90 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-800">
                          Medical Alert
                          {allergies.length > 0
                            ? `: ${allergies.slice(0, 2).join(", ")}${allergies.length > 2 ? "…" : ""}`
                            : ""}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            visual.pillClass
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              visual.dotClass
                            )}
                          />
                          {visual.label}
                        </span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                          {item.chairRoomCode || item.chairName}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#F6F8FB] text-slate-950">
      {/* Operational Banners (Aligned max-w-[1520px] with Front Desk) */}
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
              <strong>Subscription Renewal Needed (Grace Period):</strong>{" "}
              Clinical charting remains active until{" "}
              {clinic.gracePeriodEndsAt
                ? formatDate(clinic.gracePeriodEndsAt)
                : "grace period ends"}
              . Please notify your Clinic Admin to renew the plan.
            </span>
          </div>
        </div>
      ) : null}

      {isReadOnly && !isSuperAdminOverride ? (
        <div className="border-b border-rose-200/80 bg-rose-50 text-xs text-rose-950">
          <div className="mx-auto flex max-w-[1520px] items-center gap-2 px-4 py-2 sm:px-6">
            <ShieldAlert className="size-4 shrink-0 text-rose-600" />
            <span>
              <strong>Read-Only Clinical Mode:</strong>{" "}
              {readOnlyReason ??
                "Existing patient charts, odontograms, and X-rays remain viewable for clinical continuity, while new writes are paused until subscription renewal."}
            </span>
          </div>
        </div>
      ) : null}

      {(queueData.announcements ?? []).slice(0, 2).map((ann) => (
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

      {/* Aligned SaaS Top Command Bar (1:1 Design Language with Front Desk) */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1520px] flex-col gap-2.5 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Top Row on Mobile / Left Cluster on Desktop: Clinic Identity & Role */}
          <div className="flex min-w-0 items-center justify-between gap-3">
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
                    Clinical · {ROLE_LABELS[queueData.user.role] ?? "Dentist"}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  {activeDentist ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor:
                              activeDentist.calendarColorHex || "#6C5CE7",
                          }}
                        />
                        {activeDentist.displayName}
                      </span>
                      <span aria-hidden="true">·</span>
                    </>
                  ) : null}
                  <span>
                    {clinic.city}, {clinic.province}
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile-only right utility (UserButton stays pinned cleanly on Row 1) */}
            <div className="flex shrink-0 items-center gap-2 lg:hidden">
              <UserButton />
            </div>
          </div>

          {/* Controls Toolbar (Row 2 on Mobile, Right Cluster on Desktop) */}
          <div className="flex flex-wrap items-center gap-2">
            {queueData.canSwitchDentist && queueData.dentists.length > 1 ? (
              <Select
                value={queueData.selectedDentistId ?? ""}
                onValueChange={(v) => {
                  if (v) setPickedDentistId(v as Id<"dentists">);
                }}
              >
                <SelectTrigger className="h-8 w-full rounded-full border-slate-200/90 bg-white text-xs sm:w-48">
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

            {/* Day / Week Segmented Pill */}
            <div
              role="group"
              aria-label="Queue view range"
              className="inline-flex items-center rounded-full border border-slate-200/90 bg-[#F8FAFC] p-0.5"
            >
              <button
                type="button"
                onClick={() => setViewMode("day")}
                aria-pressed={viewMode === "day"}
                className={cn(
                  "h-7 cursor-pointer rounded-full px-3 text-xs font-semibold transition-colors",
                  viewMode === "day"
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:text-slate-950"
                )}
              >
                Day
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                aria-pressed={viewMode === "week"}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors",
                  viewMode === "week"
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:text-slate-950"
                )}
              >
                <CalendarDays className="size-3" />
                Week
              </button>
            </div>

            {/* Human-Readable Date / Week Stepper */}
            <div className="flex items-center rounded-full border border-slate-200/90 bg-[#F8FAFC] p-0.5">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={
                  viewMode === "week" ? "Previous week" : "Previous day"
                }
                onClick={() =>
                  setDateKey((k) => addDaysToDateKey(k, -stepAmount))
                }
                className="size-7 rounded-full text-slate-600 hover:bg-white hover:text-slate-950"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2.5 text-xs font-semibold tabular-nums text-slate-900">
                {formattedDateLabel}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={viewMode === "week" ? "Next week" : "Next day"}
                onClick={() =>
                  setDateKey((k) => addDaysToDateKey(k, stepAmount))
                }
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

            {queueData.selectedDentistId ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setTimeOffDialogOpen(true)}
                className="h-8 rounded-full bg-[#6C5CE7] px-3.5 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
              >
                <CalendarOff className="mr-1.5 size-3.5" />
                Time Off
                {upcomingTimeOffBlocks.length > 0 ? (
                  <span className="ml-1.5 inline-flex size-4.5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold tabular-nums text-white">
                    {upcomingTimeOffBlocks.length}
                  </span>
                ) : null}
              </Button>
            ) : null}

            {canAccessFrontDesk ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={buildViewHref("/front-desk")} />}
                className="h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-300"
              >
                Front Desk
              </Button>
            ) : null}

            {canAccessClinicAdmin ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={buildViewHref("/admin")} />}
                className="h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-300"
              >
                Clinic Admin
              </Button>
            ) : null}

            <div className="ml-1 hidden items-center lg:flex">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        {/* Unified Clinical Pulse Strip (Matches Front Desk Operations Pulse) */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <div className="grid grid-cols-2 divide-y divide-slate-200/75 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <div className="border-r border-slate-200/75 p-4 sm:border-r-0">
              <p className="text-xs font-medium text-slate-500">
                {viewMode === "week" ? "This Week's Queue" : "Today's Queue"}
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-slate-950">
                  {queueData.queue.length}
                </span>
                <span className="text-xs tabular-nums text-slate-500">
                  {completedCount} completed
                </span>
              </div>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium text-slate-500">
                Waiting Room
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    checkedInItems.length > 0
                      ? "text-[#4F3EC7]"
                      : "text-slate-950"
                  )}
                >
                  {checkedInItems.length}
                </span>
                <span className="text-xs text-slate-500">
                  {checkedInItems.length > 0 ? "ready for chair" : "all clear"}
                </span>
              </div>
            </div>

            <div className="border-r border-slate-200/75 p-4 sm:border-r-0">
              <p className="text-xs font-medium text-slate-500">In Chair Now</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    inChairItems.length > 0
                      ? "text-emerald-700"
                      : "text-slate-950"
                  )}
                >
                  {inChairItems.length}
                </span>
                <span className="truncate text-xs text-slate-500">
                  {inChairItems[0]
                    ? inChairItems[0].chairRoomCode || inChairItems[0].chairName
                    : "chair open"}
                </span>
              </div>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">
                  Upcoming Time Off
                </p>
                {queueData.selectedDentistId ? (
                  <button
                    type="button"
                    onClick={() => setTimeOffDialogOpen(true)}
                    className="cursor-pointer text-[11px] font-semibold text-[#6C5CE7] hover:underline"
                  >
                    Manage
                  </button>
                ) : null}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-slate-950">
                  {upcomingTimeOffBlocks.length}
                </span>
                <span className="text-xs text-slate-500">
                  {upcomingTimeOffBlocks.length === 1
                    ? "active block"
                    : "active blocks"}
                </span>
              </div>
            </div>
          </div>

          {/* Clinical Context Sub-Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-[#F8FAFC] px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                <Stethoscope className="size-3.5 text-slate-400" />
                Chair Focus:
              </span>
              {inChairItems.length > 0 ? (
                inChairItems.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => handleSelectAppointment(item._id)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900 transition-colors hover:bg-emerald-100"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="font-mono font-semibold">
                      {item.chairRoomCode || item.chairName}
                    </span>
                    <span>· {item.patientName}</span>
                  </button>
                ))
              ) : checkedInItems.length > 0 ? (
                checkedInItems.slice(0, 3).map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => handleSelectAppointment(item._id)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#6C5CE7]/25 bg-[#F1EEFF] px-2.5 py-0.5 text-[11px] font-medium text-[#4F3EC7] transition-colors hover:bg-[#E6E0FF]"
                  >
                    <span className="size-1.5 rounded-full bg-[#6C5CE7]" />
                    <span>Waiting · {item.patientName}</span>
                  </button>
                ))
              ) : upcomingQueueItems.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    handleSelectAppointment(upcomingQueueItems[0]._id)
                  }
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-[#6C5CE7]/40"
                >
                  <span className="size-1.5 rounded-full bg-sky-500" />
                  <span>
                    Next:{" "}
                    {formatTimeInTimeZone(
                      upcomingQueueItems[0].startTimeUtc,
                      clinicTimeZone
                    )}{" "}
                    · {upcomingQueueItems[0].patientName}
                  </span>
                </button>
              ) : (
                <span className="text-slate-500">
                  No visits scheduled for {formattedDateLabel}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              {storageQuotaPct !== null && plan?.maxStorageBytes ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 font-medium text-slate-600">
                  <HardDrive className="size-3 text-slate-400" />
                  Vault: {formatBytes(clinic.storageUsedBytes)} /{" "}
                  {formatBytes(plan.maxStorageBytes)} ({storageQuotaPct}%)
                </span>
              ) : null}
              <span>Timezone: {clinicTimeZone}</span>
            </div>
          </div>
        </section>

        {/* Mobile & Portrait Tablet Quick Patient Strip + Slide-Over Queue Drawer (< lg) */}
        {queueData.queue.length > 0 ? (
          <div className="flex flex-col gap-2.5 lg:hidden">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-700">
                  Chair Queue ({queueData.queue.length})
                </span>
              </div>

              <Sheet open={mobileQueueOpen} onOpenChange={setMobileQueueOpen}>
                <SheetTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800"
                    />
                  }
                >
                  <ListFilter className="mr-1.5 size-3.5" />
                  All Queue ({queueData.queue.length})
                  {hasQueueFilters ? " · Filtered" : ""}
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-[90vw] max-w-sm flex-col gap-0 bg-white p-0"
                >
                  <SheetHeader className="border-b border-slate-100 px-4 py-3.5 text-left">
                    <SheetTitle className="text-sm font-bold text-slate-950">
                      {viewMode === "week"
                        ? "Weekly Chair Queue"
                        : "My Chair Queue"}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-slate-500">
                      {formattedDateLabel} · Tap a patient to open their chart
                    </SheetDescription>
                  </SheetHeader>
                  {renderQueuePanelBody()}
                </SheetContent>
              </Sheet>
            </div>

            {/* Horizontal 1-Tap Patient Quick-Switcher */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
              {queueData.queue.map((item) => {
                const isSelected = activeAppointment?._id === item._id;
                const visual = getStatusVisual(item.status);
                return (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => handleSelectAppointment(item._id)}
                    className={cn(
                      "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors",
                      isSelected
                        ? "border-[#6C5CE7] bg-[#6C5CE7] text-white"
                        : "border-slate-200/90 bg-white text-slate-800 hover:border-slate-300"
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        isSelected ? "bg-white" : visual.dotClass
                      )}
                    />
                    <span className="max-w-[140px] truncate">
                      {item.patientName}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums text-[11px]",
                        isSelected ? "text-white/85" : "text-slate-500"
                      )}
                    >
                      {formatTimeInTimeZone(item.startTimeUtc, clinicTimeZone)}
                    </span>
                    {item.hasMedicalAlert ? (
                      <span
                        title="Critical Medical Alert"
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          isSelected ? "bg-rose-200" : "bg-rose-500"
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Master-Detail Clinical Workspace Grid */}
        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[340px_1fr]">
          {/* Desktop Left Rail: Sticky Searchable Chair Queue */}
          <aside className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white lg:sticky lg:top-[84px] lg:flex lg:max-h-[calc(100dvh-104px)] lg:flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-[#6C5CE7]" />
                  <h2 className="truncate text-sm font-semibold text-slate-950">
                    {viewMode === "week"
                      ? "Weekly Chair Queue"
                      : "My Chair Queue"}
                  </h2>
                </div>
                <p className="mt-0.5 pl-4 text-[11px] text-slate-500">
                  {formattedDateLabel}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  queueData.queue.length > 0
                    ? "border-[#6C5CE7]/25 bg-[#F1EEFF] text-[#4F3EC7]"
                    : "border-slate-200/80 bg-[#F8FAFC] text-slate-500"
                )}
              >
                {queueData.queue.length}
              </Badge>
            </div>
            {renderQueuePanelBody()}
          </aside>

          {/* Right: Active Patient Chart, Medical Alert, Odontogram & X-Ray Vault */}
          <section className="min-w-0 space-y-5">
            {queueData.user.role === "dentist" &&
            !queueData.hasLinkedDentistProfile ? (
              <div className="rounded-2xl border border-amber-200/90 bg-white p-6">
                <Alert>
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Dentist profile not linked</AlertTitle>
                  <AlertDescription className="mt-1 text-xs">
                    Your account does not have an active dentist schedule
                    profile in <strong>{clinic.name}</strong> yet. Ask your
                    Clinic Admin to link your email under{" "}
                    <code>/admin/dentists</code>.
                  </AlertDescription>
                </Alert>
              </div>
            ) : !activeAppointment ? (
              /* Actionable Off-Chair Empty State (Replaces Blank Void) */
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                <div className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-[#F1EEFF] text-[#6C5CE7]">
                    <Stethoscope className="size-6" />
                  </div>
                  <h2 className="mt-4 text-base font-bold text-slate-950 sm:text-lg">
                    Your chair schedule is clear for {formattedDateLabel}
                  </h2>
                  <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 sm:text-sm">
                    Switch to Week view to review upcoming patients, block
                    personal time off, or stay on this screen—Front Desk
                    check-ins and walk-ins appear here in real time.
                  </p>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                    {viewMode === "day" ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setViewMode("week")}
                        className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                      >
                        <CalendarDays className="mr-1.5 size-3.5" />
                        View This Week&apos;s Queue
                      </Button>
                    ) : null}
                    {!isViewingToday ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleJumpToday}
                        className="h-9 rounded-full border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800"
                      >
                        Jump to Today
                      </Button>
                    ) : null}
                    {queueData.selectedDentistId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setTimeOffDialogOpen(true)}
                        className="h-9 rounded-full border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:border-[#6C5CE7]/40 hover:text-[#6C5CE7]"
                      >
                        <CalendarOff className="mr-1.5 size-3.5" />
                        Block Time Off
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Surface Upcoming Time-Off Blocks When Quiet */}
                {upcomingTimeOffBlocks.length > 0 ? (
                  <div className="border-t border-slate-100 bg-[#F8FAFC] px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-700">
                        Upcoming Personal Time-Off Blocks (
                        {upcomingTimeOffBlocks.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setTimeOffDialogOpen(true)}
                        className="cursor-pointer text-xs font-semibold text-[#6C5CE7] hover:underline"
                      >
                        Edit blocks
                      </button>
                    </div>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      {upcomingTimeOffBlocks.slice(0, 4).map((block) => (
                        <div
                          key={block._id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-xs"
                        >
                          <span className="truncate font-semibold text-slate-900">
                            {block.reason}
                          </span>
                          <span className="shrink-0 tabular-nums text-[11px] text-slate-500">
                            {formatDateTime(block.startTimeUtc)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : patientChart === undefined ? (
              <div className="space-y-4">
                <div className="h-36 animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
                <div className="h-96 animate-pulse rounded-2xl border border-slate-200/80 bg-white" />
              </div>
            ) : (
              <>
                {/* High-Contrast Crimson Medical Alert Banner */}
                {showCrimsonAlert && medicalHistory ? (
                  <div
                    role="alert"
                    className="rounded-2xl border border-rose-700 bg-rose-600 px-4 py-3.5 text-white"
                  >
                    <div className="flex items-start gap-3">
                      <AlertOctagon className="mt-0.5 size-5 shrink-0" />
                      <div className="space-y-1.5 text-sm">
                        <p className="font-bold tracking-tight">
                          Critical Patient Medical Alert
                        </p>
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          {medicalHistory.allergies.length > 0 ? (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">
                              Allergies: {medicalHistory.allergies.join(", ")}
                            </span>
                          ) : null}
                          {medicalHistory.isTakingBloodThinners ? (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">
                              Taking Blood Thinners
                            </span>
                          ) : null}
                          {medicalHistory.isPregnant ? (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">
                              Pregnant
                            </span>
                          ) : null}
                          {medicalHistory.dentalAnxietyLevel === "severe" ? (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">
                              Severe Dental Anxiety
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Patient Summary & Chair Controls Card */}
                {(() => {
                  const activeVisual = getStatusVisual(activeAppointment.status);
                  const fullName = `${patientChart.patient.firstName} ${patientChart.patient.lastName}`;
                  return (
                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                      <div className="flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3.5">
                          <span
                            aria-hidden="true"
                            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#F1EEFF] text-sm font-bold text-[#4F3EC7]"
                          >
                            {getInitials(fullName)}
                          </span>
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
                                {fullName}
                              </h2>
                              <span className="rounded-full border border-slate-200/80 bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                                {activeAppointment.referenceCode}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                  activeVisual.pillClass
                                )}
                              >
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    activeVisual.dotClass
                                  )}
                                />
                                {activeVisual.label}
                              </span>
                            </div>

                            <p className="text-xs leading-relaxed text-slate-600 sm:text-[13px]">
                              DOB: {patientChart.patient.dateOfBirth} ·{" "}
                              {patientChart.patient.phone} ·{" "}
                              <strong className="font-semibold text-slate-900">
                                {activeAppointment.serviceName}
                              </strong>{" "}
                              ({activeAppointment.chairRoomCode || activeAppointment.chairName}) ·{" "}
                              {formatDayHeading(activeAppointment.dateKey)} at{" "}
                              <span className="font-semibold tabular-nums text-slate-800">
                                {formatTimeInTimeZone(
                                  activeAppointment.startTimeUtc,
                                  clinicTimeZone
                                )}
                              </span>
                            </p>

                            {activeAppointment.chiefComplaint ? (
                              <p className="rounded-xl border border-slate-200/75 bg-[#F8FAFC] px-3 py-2 text-xs text-slate-700">
                                <strong className="font-semibold text-slate-900">
                                  Chief Complaint:
                                </strong>{" "}
                                {activeAppointment.chiefComplaint}
                              </p>
                            ) : null}

                            {medicalHistory &&
                            (medicalHistory.conditions.length > 0 ||
                              medicalHistory.notes) ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                                {medicalHistory.conditions.length > 0 ? (
                                  <span>
                                    <strong className="text-slate-800">
                                      Conditions:
                                    </strong>{" "}
                                    {medicalHistory.conditions.join(", ")}
                                  </span>
                                ) : null}
                                {medicalHistory.notes ? (
                                  <span>
                                    <strong className="text-slate-800">
                                      Medical Notes:
                                    </strong>{" "}
                                    {medicalHistory.notes}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            {patientChart.patient.nextRecallDate ? (
                              <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                                <CalendarCheck2 className="size-3.5" />
                                Next 6-Month Hygiene Recall:{" "}
                                {patientChart.patient.nextRecallDate}
                                {patientChart.patient.lastCleaningDate
                                  ? ` (Last cleaning: ${patientChart.patient.lastCleaningDate})`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {/* Chairside Primary Controls (Thumb-Friendly on Mobile) */}
                        {!isReadOnly ? (
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:shrink-0">
                            {activeAppointment.status !== "in_chair" &&
                            activeAppointment.status !== "completed" &&
                            activeAppointment.status !== "cancelled" ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  handleChairStatus(
                                    activeAppointment._id,
                                    "in_chair"
                                  )
                                }
                                className="h-9 rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Start In Chair
                              </Button>
                            ) : null}
                            {activeAppointment.status !== "completed" &&
                            activeAppointment.status !== "cancelled" ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  handleChairStatus(
                                    activeAppointment._id,
                                    "completed"
                                  )
                                }
                                className="h-9 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                              >
                                <CheckCircle2 className="mr-1.5 size-3.5" />
                                Complete Visit
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleOneClickRecall(
                                  patientChart.patient._id,
                                  activeAppointment.dateKey
                                )
                              }
                              className="col-span-2 h-9 rounded-full border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:border-[#6C5CE7]/40 hover:text-[#6C5CE7] sm:col-span-1"
                            >
                              <Sparkles className="mr-1.5 size-3.5" />
                              Set 6-Mo Recall
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })()}

                {/* Clinical Tabs (Unified Front-Desk Pill Style + Mobile-Safe Labels) */}
                <Tabs defaultValue="odontogram">
                  <TabsList className="grid w-full grid-cols-3 rounded-full border border-slate-200/80 bg-white p-1 sm:inline-flex sm:w-fit">
                    <TabsTrigger
                      value="odontogram"
                      className="gap-1.5 rounded-full px-2.5 text-xs font-semibold sm:px-4"
                    >
                      <Stethoscope className="size-3.5 shrink-0" />
                      <span className="truncate sm:hidden">
                        Chart ({patientChart.toothRecords.length})
                      </span>
                      <span className="hidden sm:inline">
                        32-Tooth Odontogram ({patientChart.toothRecords.length})
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="xrays"
                      className="gap-1.5 rounded-full px-2.5 text-xs font-semibold sm:px-4"
                    >
                      <FileImage className="size-3.5 shrink-0" />
                      <span className="truncate sm:hidden">
                        X-Rays ({patientChart.files.length})
                      </span>
                      <span className="hidden sm:inline">
                        X-Rays &amp; Photos ({patientChart.files.length})
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="notes"
                      className="gap-1.5 rounded-full px-2.5 text-xs font-semibold sm:px-4"
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate sm:hidden">Notes</span>
                      <span className="hidden sm:inline">
                        Visit Notes &amp; History
                      </span>
                      {isNotesDirty ? (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-amber-500"
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
                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                      <div className="border-b border-slate-100 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-950">
                          Current Visit Clinical Notes
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Document private chairside procedure notes and
                          patient-visible post-visit aftercare instructions.
                        </p>
                      </div>
                      <div className="p-5">
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
                      </div>
                    </section>

                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-950">
                          Past Clinic Visits (
                          {patientChart.recentAppointments.length})
                        </h3>
                      </div>
                      <div className="space-y-2.5 p-5">
                        {patientChart.recentAppointments.length === 0 ? (
                          <p className="py-6 text-center text-xs text-slate-500">
                            No prior clinic visits recorded for this patient.
                          </p>
                        ) : (
                          patientChart.recentAppointments.map((visit) => {
                            const visitVisual = getStatusVisual(visit.status);
                            return (
                              <div
                                key={visit._id}
                                className="space-y-2 rounded-xl border border-slate-200/85 bg-[#F8FAFC]/70 p-3.5 text-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-950">
                                    {visit.serviceName} · {visit.dentistName}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                        visitVisual.pillClass
                                      )}
                                    >
                                      {visitVisual.label}
                                    </span>
                                    <span className="tabular-nums text-slate-500">
                                      {formatDateTime(visit.startTimeUtc)}
                                    </span>
                                  </div>
                                </div>
                                {visit.clinicalNotes ? (
                                  <p className="text-slate-700">
                                    <span className="font-semibold text-slate-500">
                                      Private Note:{" "}
                                    </span>
                                    {visit.clinicalNotes}
                                  </p>
                                ) : null}
                                {visit.postVisitInstructions ? (
                                  <p className="rounded-lg bg-sky-50/80 px-2.5 py-1.5 text-sky-900">
                                    <span className="font-semibold">
                                      Patient Aftercare:{" "}
                                    </span>
                                    {visit.postVisitInstructions}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </section>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </section>
        </div>
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
            Connect Clerk &amp; Smile API to activate Dentist Workspace
          </AlertTitle>
          <AlertDescription>
            Configure <code>.env.local</code> and run{" "}
            <code>npm run dev:api</code> to open the dentist chair queue,
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
        <div className="flex flex-1 items-center justify-center bg-[#F6F8FB] p-8 text-sm text-slate-500">
          Loading Dentist Clinical Workspace…
        </div>
      }
    >
      <StaffSearchResolver />
    </Suspense>
  );
}
