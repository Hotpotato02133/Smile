"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  AlertOctagon,
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileImage,
  FileText,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { Odontogram } from "@/components/clinical/odontogram";
import { XrayVault } from "@/components/clinical/xray-vault";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

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

function addSixMonthsToDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + 6, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function formatTimeOnly(ms: number): string {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function VisitNotesEditor({
  appointmentId,
  initialClinicalNotes,
  initialPostVisit,
  isReadOnly,
}: {
  appointmentId: Id<"appointments">;
  initialClinicalNotes: string;
  initialPostVisit: string;
  isReadOnly: boolean;
}) {
  const updateNotes = useMutation(api.appointments.updateClinicalNotes);
  const [clinicalNotes, setClinicalNotes] = useState(initialClinicalNotes);
  const [postVisitInstructions, setPostVisitInstructions] =
    useState(initialPostVisit);
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
      toast.success("Clinical notes saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save clinical notes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="clin-notes">Chairside Clinical Notes (SOAP / Procedure)</Label>
        <textarea
          id="clin-notes"
          rows={4}
          disabled={isReadOnly}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          placeholder="Record anesthesia used, restorative material, occlusion check, and clinical observations…"
          value={clinicalNotes}
          onChange={(e) => setClinicalNotes(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="post-visit">Patient Post-Visit Instructions</Label>
        <textarea
          id="post-visit"
          rows={3}
          disabled={isReadOnly}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          placeholder="e.g., Avoid hot beverages for 2 hours; take ibuprofen if mild soreness occurs."
          value={postVisitInstructions}
          onChange={(e) => setPostVisitInstructions(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={isReadOnly || saving}>
        <Save className="mr-1.5 size-4" />
        {saving ? "Saving…" : "Save Visit Notes"}
      </Button>
    </form>
  );
}

function ConnectedDentistWorkspace({
  overrideClinicId,
}: {
  overrideClinicId?: Id<"clinics">;
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [pickedDentistId, setPickedDentistId] = useState<
    Id<"dentists"> | undefined
  >(undefined);
  const [pickedAppointmentId, setPickedAppointmentId] =
    useState<Id<"appointments"> | null>(null);

  const dateKey = useMemo(() => toLocalDateKey(selectedDate), [selectedDate]);

  const queueData = useQuery(api.appointments.getDentistQueue, {
    dateKey,
    dentistId: pickedDentistId,
    overrideClinicId,
  });

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

  const handleChairStatus = async (
    appointmentId: Id<"appointments">,
    status: "in_chair" | "completed"
  ) => {
    try {
      const res = await transitionStatus({ appointmentId, status });
      if (res.hygieneRecallScheduledFor) {
        toast.success(
          `Visit completed! 6-month hygiene recall scheduled for ${res.hygieneRecallScheduledFor}.`
        );
      } else {
        toast.success(`Appointment marked ${status.replace("_", " ")}.`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update appointment status."));
    }
  };

  const handleOneClickRecall = async (patientId: Id<"patients">) => {
    const nextRecallDate = addSixMonthsToDateKey(dateKey);
    try {
      await setPatientRecallDate({
        patientId,
        lastCleaningDate: dateKey,
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

  const { clinic, isReadOnly, isSuperAdminOverride } = queueData;
  const inChairCount = queueData.queue.filter(
    (q) => q.status === "in_chair"
  ).length;

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

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      {/* Impersonation & Read-Only Banners */}
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

      {clinic.status === "suspended" || clinic.status === "archived" ? (
        <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-900 dark:text-rose-200">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            <strong>Read-Only Clinical Mode ({clinic.status}):</strong> Existing
            patient charts, odontograms, and X-rays remain viewable for clinical
            continuity, while new writes are paused until subscription renewal.
          </span>
        </div>
      ) : null}

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
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold leading-tight">
                {clinic.name} · Clinical Workspace
              </h1>
              {inChairCount > 0 ? (
                <Badge className="animate-pulse bg-emerald-600 text-[11px] text-white">
                  {inChairCount} Patient In Chair
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Chair queue, 32-tooth SVG odontogram & compressed X-ray vault
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {queueData.dentists.length > 1 ? (
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

          <Button
            size="sm"
            variant="outline"
            render={<Link href={buildViewHref("/front-desk")} />}
          >
            Front Desk
          </Button>
          <UserButton />
        </div>
      </header>

      {/* Main Two-Column Chairside Layout */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 lg:grid-cols-[310px_1fr] lg:p-6">
        {/* Left: My Chair Queue */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">My Chair Queue</h2>
            <Badge variant="outline" className="font-mono">
              {queueData.queue.length}
            </Badge>
          </div>

          {queueData.queue.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                No appointments scheduled for {dateKey}.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {queueData.queue.map((item) => {
                const isSelected = activeAppointment?._id === item._id;
                const isInChair = item.status === "in_chair";
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
                        ? "ring-2 ring-emerald-500/60"
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
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <Clock className="size-3" />
                        {formatTimeOnly(item.startTimeUtc)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={isInChair ? "default" : "secondary"}
                        className={`text-[10px] capitalize ${
                          isInChair ? "bg-emerald-600 text-white" : ""
                        }`}
                      >
                        {item.status.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
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
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-xl">
                        {patientChart.patient.firstName}{" "}
                        {patientChart.patient.lastName}
                      </CardTitle>
                      <Badge variant="outline" className="font-mono text-xs">
                        {activeAppointment.referenceCode}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {activeAppointment.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1">
                      DOB: {patientChart.patient.dateOfBirth} ·{" "}
                      {patientChart.patient.phone} ·{" "}
                      <strong>{activeAppointment.serviceName}</strong> (
                      {activeAppointment.chairName})
                    </CardDescription>
                    {activeAppointment.chiefComplaint ? (
                      <p className="mt-1.5 text-xs text-foreground/85">
                        <strong>Chief Complaint:</strong>{" "}
                        {activeAppointment.chiefComplaint}
                      </p>
                    ) : null}
                    {patientChart.patient.nextRecallDate ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <CalendarCheck2 className="size-3.5" />
                        Next 6-Month Hygiene Recall:{" "}
                        {patientChart.patient.nextRecallDate}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isReadOnly && activeAppointment.status !== "in_chair" && activeAppointment.status !== "completed" ? (
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
                    {!isReadOnly && activeAppointment.status !== "completed" ? (
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
                          handleOneClickRecall(patientChart.patient._id)
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
                    X-Rays & Photos ({patientChart.files.length})
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="gap-1.5">
                    <FileText className="size-3.5" />
                    Visit Notes & History
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
                  />
                </TabsContent>

                <TabsContent value="notes" className="mt-4 space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Current Visit Clinical Notes
                      </CardTitle>
                      <CardDescription>
                        Document procedure details and patient aftercare
                        instructions.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <VisitNotesEditor
                        key={`${activeAppointment._id}-${activeAppointment.updatedAt}`}
                        appointmentId={activeAppointment._id}
                        initialClinicalNotes={
                          activeAppointment.clinicalNotes ?? ""
                        }
                        initialPostVisit={
                          activeAppointment.postVisitInstructions ?? ""
                        }
                        isReadOnly={isReadOnly}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Past Clinic Visits ({patientChart.recentAppointments.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {patientChart.recentAppointments.map((visit) => (
                        <div
                          key={visit._id}
                          className="rounded-lg border p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">
                              {visit.serviceName} · {visit.dentistName}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDateTime(visit.startTimeUtc)}
                            </span>
                          </div>
                          {visit.clinicalNotes ? (
                            <p className="mt-1 text-foreground/85">
                              {visit.clinicalNotes}
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
          <AlertTitle>Connect Clerk & Convex to activate Dentist Workspace</AlertTitle>
          <AlertDescription>
            Configure <code>.env.local</code> and run{" "}
            <code>npx convex dev</code> to open the dentist chair queue,
            32-tooth SVG odontogram, and compressed X-ray vault.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return <ConnectedDentistWorkspace overrideClinicId={overrideClinicId} />;
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
