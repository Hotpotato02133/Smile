"use client";

import { useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  ShieldAlert,
  UserX,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type AppointmentStatus,
  type CalendarAppointmentItem,
  STATUS_BADGE_META,
} from "@/components/front-desk/master-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  formatDateTime,
  formatMinutes12h,
  getErrorMessage,
  localDateTimeToUtc,
  minutesToTimeInput,
  utcMsToTimeInputInTimeZone,
} from "@/lib/format";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

type DialogProps = {
  appointment: CalendarAppointmentItem;
  onClose: () => void;
  clinicId: Id<"clinics">;
  clinicTimezone: string;
  cancellationWindowHours: number;
  dentists: {
    _id: Id<"dentists">;
    displayName: string;
    defaultChairId?: Id<"chairs"> | null;
  }[];
  chairs: { _id: Id<"chairs">; name: string; roomCode: string }[];
  isReadOnly: boolean;
  onTransition: (
    appointmentId: Id<"appointments">,
    status: Exclude<AppointmentStatus, "pending_approval">,
    cancellationReason?: string
  ) => Promise<void>;
};

function AppointmentActionDialogBody({
  appointment,
  onClose,
  clinicId,
  clinicTimezone,
  cancellationWindowHours,
  dentists,
  chairs,
  isReadOnly,
  onTransition,
}: DialogProps) {
  const rescheduleAppointment = useMutation(
    api.appointments.rescheduleAppointment
  );

  const [openedAt] = useState<number>(() => Date.now());
  const [mode, setMode] = useState<"overview" | "reassign" | "cancel">(
    "overview"
  );
  const [submitting, setSubmitting] = useState(false);

  // Reassign / Reschedule state initialized cleanly from the appointment prop
  const [targetDentistId, setTargetDentistId] = useState<string>(
    appointment.dentistId
  );
  const [targetChairId, setTargetChairId] = useState<string>(
    appointment.chairId
  );
  const [targetDateKey, setTargetDateKey] = useState<string>(
    appointment.dateKey
  );
  const [targetTime, setTargetTime] = useState<string>(() =>
    utcMsToTimeInputInTimeZone(appointment.startTimeUtc, clinicTimezone)
  );
  const [reassignReason, setReassignReason] = useState<string>("");

  // Cancellation / Policy Override state
  const [cancelReason, setCancelReason] = useState<string>("");

  const slotQuery = useQuery(
    api.availability.getAvailableSlots,
    mode === "reassign" && targetDateKey
      ? {
          clinicId,
          serviceId: appointment.serviceId,
          dateKey: targetDateKey,
          preferredDentistId: targetDentistId
            ? (targetDentistId as Id<"dentists">)
            : undefined,
          ignoreAppointmentId: appointment._id,
          includeEmergencyBuffer: true,
        }
      : "skip"
  );

  const statusMeta =
    STATUS_BADGE_META[appointment.status] ?? STATUS_BADGE_META.confirmed;
  const isPendingApproval = appointment.status === "pending_approval";
  const isWithinCancellationWindow =
    !isPendingApproval &&
    appointment.startTimeUtc - openedAt <
      cancellationWindowHours * 60 * 60 * 1000;

  const handleSaveReassignment = async () => {
    if (!targetDentistId || !targetChairId || !targetDateKey || !targetTime) {
      toast.error("Select dentist, chair, date, and start time.");
      return;
    }
    const startTimeUtc = localDateTimeToUtc(
      targetDateKey,
      targetTime,
      clinicTimezone
    );
    if (Number.isNaN(startTimeUtc)) {
      toast.error("Invalid date or time.");
      return;
    }
    setSubmitting(true);
    try {
      await rescheduleAppointment({
        appointmentId: appointment._id,
        dateKey: targetDateKey,
        startTimeUtc,
        dentistId: targetDentistId as Id<"dentists">,
        chairId: targetChairId as Id<"chairs">,
        reason: reassignReason.trim() || undefined,
      });
      toast.success("Appointment reassigned / rescheduled.");
      onClose();
    } catch (err) {
      toast.error(
        getErrorMessage(err, "Could not reassign or reschedule appointment.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (isWithinCancellationWindow && !cancelReason.trim()) {
      toast.error(
        `A cancellation reason is required to override the ${cancellationWindowHours}-hour policy.`
      );
      return;
    }
    setSubmitting(true);
    try {
      await onTransition(
        appointment._id,
        "cancelled",
        cancelReason.trim() || undefined
      );
    } finally {
      setSubmitting(false);
    }
  };

  const availableSlots = slotQuery?.slots ?? [];

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle>{appointment.patientName}</DialogTitle>
          <span className="font-mono text-xs text-muted-foreground">
            ({appointment.referenceCode})
          </span>
        </div>
        <DialogDescription>
          {appointment.serviceName} · {formatDateTime(appointment.startTimeUtc)}
        </DialogDescription>
      </DialogHeader>

      {/* Alerts: Medical Alert & Repeat No-Show Warning */}
      {appointment.hasMedicalAlert ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-900 dark:text-rose-200">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>Medical Alert:</strong>{" "}
            {[
              appointment.medicalSummary?.allergies.length
                ? `Allergies: ${appointment.medicalSummary.allergies.join(", ")}`
                : null,
              appointment.medicalSummary?.isTakingBloodThinners
                ? "Blood Thinners"
                : null,
              appointment.medicalSummary?.isPregnant ? "Pregnant" : null,
              appointment.medicalSummary?.dentalAnxietyLevel === "severe"
                ? "Severe Dental Anxiety"
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ) : null}

      {appointment.noShowCount > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-900 dark:text-orange-200">
          <UserX className="size-4 shrink-0" />
          <span>
            <strong>Repeat No-Show Flag:</strong> This patient has{" "}
            <strong>{appointment.noShowCount}</strong> prior no-show
            {appointment.noShowCount > 1 ? "s" : ""} on record.
          </span>
        </div>
      ) : null}

      {/* Appointment Summary Box */}
      <div className="space-y-1.5 rounded-lg border bg-muted/25 p-3 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Status</span>
          <Badge variant="outline" className={statusMeta.badgeClass}>
            {statusMeta.label}
          </Badge>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Dentist</span>
          <span className="font-medium">{appointment.dentistName}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Operatory</span>
          <span className="font-medium">
            {appointment.chairRoomCode} · {appointment.chairName}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Patient Contact</span>
          <span className="font-mono">
            {appointment.patientPhone || "—"}
            {appointment.patientEmail ? ` · ${appointment.patientEmail}` : ""}
          </span>
        </div>
        {appointment.chiefComplaint ? (
          <div className="border-t pt-1.5">
            <span className="text-muted-foreground">Chief Complaint: </span>
            <span>{appointment.chiefComplaint}</span>
          </div>
        ) : null}
        {appointment.cancellationReason ? (
          <div className="border-t pt-1.5 text-rose-800 dark:text-rose-200">
            <span className="font-medium">Cancellation Reason: </span>
            <span>{appointment.cancellationReason}</span>
          </div>
        ) : null}
      </div>

      {/* Mode Views (Writable Staff Only) */}
      {!isReadOnly ? (
        mode === "overview" ? (
          <div className="space-y-3">
            {isPendingApproval ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => onTransition(appointment._id, "confirmed")}
                >
                  <CheckCircle2 className="mr-1.5 size-3.5" />
                  Approve Request
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => setMode("cancel")}
                >
                  <XCircle className="mr-1.5 size-3.5" />
                  Reject Request
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || appointment.status === "checked_in"}
                onClick={() => onTransition(appointment._id, "checked_in")}
              >
                Mark Checked In
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || appointment.status === "in_chair"}
                onClick={() => onTransition(appointment._id, "in_chair")}
              >
                Seat In Chair
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || appointment.status === "completed"}
                onClick={() => onTransition(appointment._id, "completed")}
              >
                Mark Completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || appointment.status === "no_show"}
                onClick={() => onTransition(appointment._id, "no_show")}
              >
                Mark No-Show
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t pt-2.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  submitting ||
                  appointment.status === "completed" ||
                  appointment.status === "cancelled"
                }
                onClick={() => setMode("reassign")}
              >
                <CalendarClock className="mr-1.5 size-3.5" />
                Reassign / Reschedule
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={submitting || appointment.status === "cancelled"}
                onClick={() => setMode("cancel")}
              >
                Cancel Appointment
              </Button>
            </div>
          </div>
        ) : mode === "reassign" ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">
                Reassign Dentist / Chair or Reschedule Time
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setMode("overview")}
              >
                Back
              </Button>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Dentist</Label>
                <Select
                  value={targetDentistId}
                  onValueChange={(v) => {
                    if (v) {
                      setTargetDentistId(v);
                      const match = dentists.find((d) => d._id === v);
                      if (match?.defaultChairId) {
                        setTargetChairId(match.defaultChairId);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose dentist" />
                  </SelectTrigger>
                  <SelectContent>
                    {dentists.map((d) => (
                      <SelectItem key={d._id} value={d._id}>
                        {d.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Operatory Chair</Label>
                <Select
                  value={targetChairId}
                  onValueChange={(v) => {
                    if (v) setTargetChairId(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose chair" />
                  </SelectTrigger>
                  <SelectContent>
                    {chairs.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.roomCode} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="re-date" className="text-xs">
                  Date
                </Label>
                <Input
                  id="re-date"
                  type="date"
                  value={targetDateKey}
                  onChange={(e) => setTargetDateKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="re-time" className="text-xs">
                  Start Time ({clinicTimezone})
                </Label>
                <Input
                  id="re-time"
                  type="time"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                />
              </div>
            </div>

            {/* Conflict-free quick slot suggestions */}
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Clock className="size-3" />
                Conflict-free slots on {targetDateKey}:
              </span>
              {slotQuery === undefined ? (
                <p className="text-[11px] text-muted-foreground">
                  Checking availability…
                </p>
              ) : availableSlots.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No open standard slots for this dentist on {targetDateKey}.
                </p>
              ) : (
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {availableSlots.map((slot) => {
                    const hhmm = minutesToTimeInput(slot.startMinute);
                    const picked =
                      targetTime === hhmm &&
                      targetDentistId === slot.dentistId &&
                      targetChairId === slot.chairId;
                    return (
                      <button
                        key={`${slot.startTimeUtc}-${slot.dentistId}-${slot.chairId}`}
                        type="button"
                        onClick={() => {
                          setTargetTime(hhmm);
                          setTargetDentistId(slot.dentistId);
                          setTargetChairId(slot.chairId);
                        }}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                          picked
                            ? "border-primary bg-primary text-primary-foreground"
                            : slot.isEmergencyBufferSlot
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100"
                              : "bg-background hover:bg-accent"
                        }`}
                      >
                        {formatMinutes12h(slot.startMinute)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="re-reason" className="text-xs">
                Reassignment / Reschedule Note (optional)
              </Label>
              <Input
                id="re-reason"
                placeholder="e.g., Patient requested afternoon / Chair 2 sterilization delay"
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              className="w-full"
              disabled={submitting}
              onClick={handleSaveReassignment}
            >
              {submitting
                ? "Checking conflicts & saving…"
                : "Save Reassignment / Reschedule"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
                {isPendingApproval
                  ? "Reject Pending Booking Request"
                  : "Cancel Appointment & Check Waitlist"}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setMode("overview")}
              >
                Back
              </Button>
            </div>

            {isWithinCancellationWindow ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/15 p-2 text-xs text-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>
                    {cancellationWindowHours}-Hour Policy Override:
                  </strong>{" "}
                  This booking is within the clinic&apos;s{" "}
                  {cancellationWindowHours}-hour notice window. A cancellation
                  reason is required and will be logged in the clinic audit
                  trail.
                </span>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="cancel-reason" className="text-xs">
                Cancellation Reason{" "}
                {isWithinCancellationWindow ? "(Required)" : "(Optional)"}
              </Label>
              <Input
                id="cancel-reason"
                placeholder={
                  isWithinCancellationWindow
                    ? "e.g., Patient called with medical emergency — fee waived by front desk"
                    : "e.g., Patient requested cancellation via phone"
                }
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              disabled={
                submitting ||
                (isWithinCancellationWindow && !cancelReason.trim())
              }
              onClick={handleConfirmCancel}
            >
              {submitting
                ? "Cancelling…"
                : isWithinCancellationWindow
                  ? "Confirm Policy Override Cancellation"
                  : isPendingApproval
                    ? "Confirm Reject Request"
                    : "Confirm Cancellation"}
            </Button>
          </div>
        )
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function AppointmentActionDialog({
  appointment,
  onClose,
  ...rest
}: Omit<DialogProps, "appointment"> & {
  appointment: CalendarAppointmentItem | null;
}) {
  return (
    <Dialog
      open={appointment !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      {appointment ? (
        <AppointmentActionDialogBody
          key={`${appointment._id}-${appointment.status}`}
          appointment={appointment}
          onClose={onClose}
          {...rest}
        />
      ) : null}
    </Dialog>
  );
}
