"use client";

import { useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  CalendarOff,
  Clock,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dateToDateKeyInTimeZone,
  formatTimeInTimeZone,
  getErrorMessage,
  localDateTimeToUtc,
} from "@/lib/format";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function formatBlockRange(
  startUtc: number,
  endUtc: number,
  timeZone: string
): string {
  const startKey = dateToDateKeyInTimeZone(startUtc, timeZone);
  const endKey = dateToDateKeyInTimeZone(endUtc, timeZone);
  const startTime = formatTimeInTimeZone(startUtc, timeZone);
  const endTime = formatTimeInTimeZone(endUtc, timeZone);
  if (startKey === endKey) {
    return `${startKey} · ${startTime} – ${endTime}`;
  }
  return `${startKey} ${startTime} → ${endKey} ${endTime}`;
}

export function TimeOffBlockerDialog({
  open,
  onOpenChange,
  dentistId,
  clinicTimezone,
  defaultDateKey,
  isReadOnly,
  overrideClinicId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dentistId?: Id<"dentists">;
  clinicTimezone: string;
  defaultDateKey: string;
  isReadOnly: boolean;
  overrideClinicId?: Id<"clinics">;
}) {
  const [startDate, setStartDate] = useState(defaultDateKey);
  const [startTime, setStartTime] = useState("12:00");
  const [endDate, setEndDate] = useState(defaultDateKey);
  const [endTime, setEndTime] = useState("13:00");
  const [reason, setReason] = useState("");
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<Id<"dentistTimeOff"> | null>(
    null
  );
  const [nowRef] = useState<number>(() => Date.now());

  const startTimeUtc = useMemo(
    () => localDateTimeToUtc(startDate, startTime, clinicTimezone),
    [startDate, startTime, clinicTimezone]
  );
  const endTimeUtc = useMemo(
    () => localDateTimeToUtc(endDate, endTime, clinicTimezone),
    [endDate, endTime, clinicTimezone]
  );
  const hasValidRange =
    Number.isFinite(startTimeUtc) &&
    Number.isFinite(endTimeUtc) &&
    endTimeUtc > startTimeUtc;

  const timeOffData = useQuery(
    api.appointments.getDentistTimeOff,
    open ? { dentistId, overrideClinicId } : "skip"
  );

  const conflictData = useQuery(
    api.appointments.checkTimeOffConflicts,
    open && hasValidRange
      ? {
          dentistId,
          startTimeUtc,
          endTimeUtc,
          overrideClinicId,
        }
      : "skip"
  );

  const createMyTimeOff = useMutation(api.appointments.createMyTimeOff);
  const removeMyTimeOff = useMutation(api.appointments.removeMyTimeOff);

  const conflicts = conflictData?.conflicts ?? [];
  const hasConflicts = conflicts.length > 0;

  const applyPreset = (
    preset: "break30" | "break60" | "halfday" | "fullday" | "conference"
  ) => {
    setConfirmOverlap(false);
    const baseDate = startDate || defaultDateKey;
    switch (preset) {
      case "break30":
        setStartDate(baseDate);
        setEndDate(baseDate);
        setStartTime("15:00");
        setEndTime("15:30");
        setReason("Short Break");
        break;
      case "break60":
        setStartDate(baseDate);
        setEndDate(baseDate);
        setStartTime("12:00");
        setEndTime("13:00");
        setReason("Lunch / Admin Break");
        break;
      case "halfday":
        setStartDate(baseDate);
        setEndDate(baseDate);
        setStartTime("13:00");
        setEndTime("18:00");
        setReason("Half-Day Personal Leave");
        break;
      case "fullday":
        setStartDate(baseDate);
        setEndDate(baseDate);
        setStartTime("08:00");
        setEndTime("19:00");
        setReason("Full-Day Leave");
        break;
      case "conference":
        setStartDate(baseDate);
        setEndDate(addDaysToDateKey(baseDate, 1));
        setStartTime("08:00");
        setEndTime("19:00");
        setReason("Dental Conference / Continuing Education");
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasValidRange) {
      toast.error("End date & time must be after the start date & time.");
      return;
    }
    if (hasConflicts && !confirmOverlap) {
      toast.error(
        "Please confirm the overlapping appointment warning before blocking this window."
      );
      return;
    }

    setSaving(true);
    try {
      const res = await createMyTimeOff({
        dentistId,
        startTimeUtc,
        endTimeUtc,
        reason: reason.trim() || "Personal time off",
        allowOverlap: hasConflicts ? confirmOverlap : false,
      });
      if (res.overlappingCount > 0) {
        toast.warning(
          `Time-off blocked. Coordinate with Front Desk to reschedule ${res.overlappingCount} overlapping appointment${res.overlappingCount === 1 ? "" : "s"}.`
        );
      } else {
        toast.success(
          "Time-off block saved. Online booking & availability updated immediately."
        );
      }
      setReason("");
      setConfirmOverlap(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save time-off block."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (timeOffId: Id<"dentistTimeOff">) => {
    setDeletingId(timeOffId);
    try {
      await removeMyTimeOff({ timeOffId });
      toast.success("Time-off block removed. Slots are bookable again.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not remove time-off block."));
    } finally {
      setDeletingId(null);
    }
  };

  const upcomingBlocks = (timeOffData?.blocks ?? []).filter(
    (b) => b.endTimeUtc >= nowRef
  );
  const pastBlocks = (timeOffData?.blocks ?? [])
    .filter((b) => b.endTimeUtc < nowRef)
    .slice(-5)
    .reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border-slate-200/80 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[#F1EEFF] text-[#6C5CE7]">
              <CalendarOff className="size-4" />
            </span>
            Personal Time-Off &amp; Break Blocker
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {timeOffData?.dentistName
              ? `Blocking time for ${timeOffData.dentistName} (${clinicTimezone}). `
              : ""}
            Blocked windows are immediately excluded from online booking and
            walk-in slot availability.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick Presets */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">
              Quick Presets
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isReadOnly}
                onClick={() => applyPreset("break30")}
                className="h-7 rounded-full border-slate-200 bg-[#F8FAFC] px-3 text-xs font-medium text-slate-700 hover:border-[#6C5CE7]/40 hover:bg-[#F1EEFF] hover:text-[#4F3EC7]"
              >
                30m Break
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isReadOnly}
                onClick={() => applyPreset("break60")}
                className="h-7 rounded-full border-slate-200 bg-[#F8FAFC] px-3 text-xs font-medium text-slate-700 hover:border-[#6C5CE7]/40 hover:bg-[#F1EEFF] hover:text-[#4F3EC7]"
              >
                1h Break
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isReadOnly}
                onClick={() => applyPreset("halfday")}
                className="h-7 rounded-full border-slate-200 bg-[#F8FAFC] px-3 text-xs font-medium text-slate-700 hover:border-[#6C5CE7]/40 hover:bg-[#F1EEFF] hover:text-[#4F3EC7]"
              >
                Half-Day Leave
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isReadOnly}
                onClick={() => applyPreset("fullday")}
                className="h-7 rounded-full border-slate-200 bg-[#F8FAFC] px-3 text-xs font-medium text-slate-700 hover:border-[#6C5CE7]/40 hover:bg-[#F1EEFF] hover:text-[#4F3EC7]"
              >
                Full-Day Leave
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isReadOnly}
                onClick={() => applyPreset("conference")}
                className="h-7 rounded-full border-slate-200 bg-[#F8FAFC] px-3 text-xs font-medium text-slate-700 hover:border-[#6C5CE7]/40 hover:bg-[#F1EEFF] hover:text-[#4F3EC7]"
              >
                Conference (2 Days)
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="timeoff-start-date">Start Date</Label>
              <Input
                id="timeoff-start-date"
                type="date"
                disabled={isReadOnly}
                value={startDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartDate(next);
                  if (next > endDate) setEndDate(next);
                  setConfirmOverlap(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timeoff-start-time">Start Time</Label>
              <Input
                id="timeoff-start-time"
                type="time"
                disabled={isReadOnly}
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setConfirmOverlap(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timeoff-end-date">End Date</Label>
              <Input
                id="timeoff-end-date"
                type="date"
                disabled={isReadOnly}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setConfirmOverlap(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timeoff-end-time">End Time</Label>
              <Input
                id="timeoff-end-time"
                type="time"
                disabled={isReadOnly}
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setConfirmOverlap(false);
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timeoff-reason">Reason (Leave, Conference, Break)</Label>
            <Input
              id="timeoff-reason"
              disabled={isReadOnly}
              placeholder="e.g., PDA Annual Convention, Afternoon Admin Break, Personal Leave"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {!hasValidRange ? (
            <p className="text-xs text-destructive">
              End date and time must be strictly after start date and time.
            </p>
          ) : null}

          {/* Real-Time Existing Appointment Overlap Warning */}
          {hasValidRange && hasConflicts ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>
                Overlaps {conflicts.length} Existing Appointment
                {conflicts.length === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  Blocking this window will prevent new bookings immediately,
                  but the following already-booked appointments must be
                  rescheduled or reassigned by Front Desk:
                </p>
                <ul className="space-y-1.5 rounded-md bg-background/80 p-2 text-xs text-foreground">
                  {conflicts.map((c) => (
                    <li
                      key={c._id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b pb-1 last:border-b-0 last:pb-0"
                    >
                      <span className="font-medium">
                        {c.patientName} · {c.serviceName}
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        {c.dateKey} {formatTimeInTimeZone(c.startTimeUtc, clinicTimezone)}
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {c.status.replace("_", " ")}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs font-medium text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 accent-destructive"
                    checked={confirmOverlap}
                    onChange={(e) => setConfirmOverlap(e.target.checked)}
                  />
                  <span>
                    I understand existing appointments overlap and will
                    coordinate rescheduling with Front Desk.
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            className="h-10 w-full rounded-full bg-[#6C5CE7] text-xs font-semibold text-white hover:bg-[#5B4BD6]"
            disabled={
              isReadOnly ||
              saving ||
              !hasValidRange ||
              (hasConflicts && !confirmOverlap)
            }
          >
            <Plus className="mr-1.5 size-4" />
            {saving
              ? "Blocking Time Window…"
              : hasConflicts
                ? "Block Time Off Anyway"
                : "Block Time Window"}
          </Button>
        </form>

        {/* Scheduled Upcoming Time-Off List */}
        <div className="space-y-2.5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">
              Upcoming &amp; Active Blocks ({upcomingBlocks.length})
            </h3>
          </div>

          {timeOffData === undefined ? (
            <p className="py-4 text-center text-xs text-slate-500">
              Loading scheduled blocks…
            </p>
          ) : upcomingBlocks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] py-5 text-center text-xs text-slate-500">
              No upcoming time-off or break blocks scheduled.
            </p>
          ) : (
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {upcomingBlocks.map((block) => (
                <div
                  key={block._id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/85 bg-[#F8FAFC] px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {block.reason}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] tabular-nums text-slate-500">
                      <Clock className="size-3 text-slate-400" />
                      {formatBlockRange(
                        block.startTimeUtc,
                        block.endTimeUtc,
                        clinicTimezone
                      )}
                    </p>
                  </div>
                  {!isReadOnly ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Remove time-off block"
                      disabled={deletingId === block._id}
                      onClick={() => handleDelete(block._id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {pastBlocks.length > 0 ? (
            <div className="pt-2">
              <p className="mb-1.5 text-xs font-medium text-slate-500">
                Recent Past Blocks
              </p>
              <div className="space-y-1.5">
                {pastBlocks.map((block) => (
                  <div
                    key={block._id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500"
                  >
                    <span className="truncate">{block.reason}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatBlockRange(
                        block.startTimeUtc,
                        block.endTimeUtc,
                        clinicTimezone
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
