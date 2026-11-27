"use client";

import "./big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  type EventProps,
  type View,
} from "react-big-calendar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMinutes12h } from "@/lib/format";
import type { Id } from "@/lib/api";

const locales = { "en-US": enUS };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales,
});

export type AppointmentStatus =
  | "pending_approval"
  | "confirmed"
  | "checked_in"
  | "in_chair"
  | "completed"
  | "cancelled"
  | "no_show";

export type CalendarAppointmentItem = {
  _id: Id<"appointments">;
  patientId: Id<"patients">;
  dentistId: Id<"dentists">;
  chairId: Id<"chairs">;
  serviceId: Id<"services">;
  dateKey: string;
  startTimeUtc: number;
  endTimeUtc: number;
  status: AppointmentStatus;
  bookingSource: string;
  referenceCode: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string | null;
  noShowCount: number;
  dentistName: string;
  dentistColorHex: string;
  chairName: string;
  chairRoomCode: string;
  serviceName: string;
  chiefComplaint?: string;
  cancellationReason?: string;
  hasMedicalAlert: boolean;
  medicalSummary: {
    allergies: string[];
    isTakingBloodThinners: boolean;
    isPregnant: boolean;
    dentalAnxietyLevel: string;
  } | null;
};

type CalendarEvent = {
  id: Id<"appointments">;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  colorHex: string;
  status: AppointmentStatus;
  item: CalendarAppointmentItem;
};

type CalendarResource = {
  resourceId: string;
  resourceTitle: string;
};

export const STATUS_BADGE_META: Record<
  AppointmentStatus,
  { label: string; shortLabel: string; pillClass: string; badgeClass: string }
> = {
  pending_approval: {
    label: "Pending Approval",
    shortLabel: "Pending",
    pillClass: "bg-amber-400 text-amber-950",
    badgeClass:
      "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  confirmed: {
    label: "Confirmed",
    shortLabel: "Confirmed",
    pillClass: "bg-white/20 text-white",
    badgeClass:
      "border-sky-500/40 bg-sky-500/15 text-sky-900 dark:text-sky-200",
  },
  checked_in: {
    label: "Checked In",
    shortLabel: "Checked In",
    pillClass: "bg-indigo-950/75 text-indigo-100",
    badgeClass:
      "border-indigo-500/40 bg-indigo-500/15 text-indigo-900 dark:text-indigo-200",
  },
  in_chair: {
    label: "In Chair",
    shortLabel: "In Chair",
    pillClass: "bg-emerald-950/80 text-emerald-100",
    badgeClass:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
  },
  completed: {
    label: "Completed",
    shortLabel: "Done",
    pillClass: "bg-black/30 text-white/95",
    badgeClass:
      "border-slate-500/40 bg-slate-500/15 text-slate-800 dark:text-slate-200",
  },
  cancelled: {
    label: "Cancelled",
    shortLabel: "Cancelled",
    pillClass: "bg-rose-950/85 text-rose-100",
    badgeClass:
      "border-rose-500/40 bg-rose-500/15 text-rose-900 dark:text-rose-200",
  },
  no_show: {
    label: "No-Show",
    shortLabel: "No-Show",
    pillClass: "bg-orange-950/85 text-orange-100",
    badgeClass:
      "border-orange-500/40 bg-orange-500/15 text-orange-900 dark:text-orange-200",
  },
};

function CalendarEventBlock({ event }: EventProps<CalendarEvent>) {
  const { item } = event;
  const meta = STATUS_BADGE_META[item.status] ?? STATUS_BADGE_META.confirmed;

  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <div className="flex items-center justify-between gap-1">
        <span
          className={`truncate font-semibold ${
            item.status === "cancelled" ? "line-through opacity-85" : ""
          }`}
        >
          {item.hasMedicalAlert ? "⚠ " : ""}
          {item.patientName}
        </span>
        <span
          className={`shrink-0 rounded px-1 py-0.25 text-[9px] font-semibold uppercase tracking-wide ${meta.pillClass}`}
        >
          {meta.shortLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 text-[10px] opacity-90">
        <span className="truncate">{item.serviceName}</span>
        {item.noShowCount > 0 ? (
          <span className="shrink-0 rounded bg-orange-950/80 px-1 text-[9px] font-semibold text-orange-100">
            NS×{item.noShowCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function MasterCalendar({
  date,
  view,
  onViewChange,
  onNavigateDate,
  appointments,
  chairs,
  dentists,
  emergencyWindow,
  onSelectAppointment,
}: {
  date: Date;
  view: View;
  onViewChange: (next: View) => void;
  onNavigateDate: (next: Date) => void;
  appointments: CalendarAppointmentItem[];
  chairs: { _id: Id<"chairs">; name: string; roomCode: string }[];
  dentists: {
    _id: Id<"dentists">;
    displayName: string;
    calendarColorHex: string;
  }[];
  emergencyWindow: { startMinute: number; endMinute: number } | null;
  onSelectAppointment: (appt: CalendarAppointmentItem) => void;
}) {
  const [groupBy, setGroupBy] = useState<"chair" | "dentist">("chair");
  const [showCancelled, setShowCancelled] = useState(true);

  const resources: CalendarResource[] = useMemo(() => {
    if (groupBy === "chair") {
      return chairs.map((c) => ({
        resourceId: c._id,
        resourceTitle: `${c.roomCode} · ${c.name}`,
      }));
    }
    return dentists.map((d) => ({
      resourceId: d._id,
      resourceTitle: d.displayName,
    }));
  }, [groupBy, chairs, dentists]);

  const events: CalendarEvent[] = useMemo(
    () =>
      appointments
        .filter((a) => showCancelled || a.status !== "cancelled")
        .map((appt) => ({
          id: appt._id,
          title: `${appt.hasMedicalAlert ? "⚠ " : ""}${appt.patientName} — ${appt.serviceName} (${STATUS_BADGE_META[appt.status].label})`,
          start: new Date(appt.startTimeUtc),
          end: new Date(appt.endTimeUtc),
          resourceId: groupBy === "chair" ? appt.chairId : appt.dentistId,
          colorHex: appt.dentistColorHex,
          status: appt.status,
          item: appt,
        })),
    [appointments, groupBy, showCancelled]
  );

  const minTime = useMemo(() => new Date(1970, 0, 1, 7, 0, 0), []);
  const maxTime = useMemo(() => new Date(1970, 0, 1, 20, 0, 0), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Day view columns:</span>
          <Button
            size="sm"
            variant={groupBy === "chair" ? "secondary" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setGroupBy("chair")}
          >
            By Operatory Chair
          </Button>
          <Button
            size="sm"
            variant={groupBy === "dentist" ? "secondary" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setGroupBy("dentist")}
          >
            By Dentist
          </Button>

          <div className="ml-2 flex items-center gap-1.5 border-l pl-3">
            <Switch
              id="cal-show-cancelled"
              checked={showCancelled}
              onCheckedChange={setShowCancelled}
            />
            <Label
              htmlFor="cal-show-cancelled"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Show Cancelled
            </Label>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Click any booking to check in, reassign dentist/chair, reschedule, or
          cancel.
        </p>
      </div>

      {/* Dentist Color Legend & Daily Emergency Buffer Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {dentists.map((d) => (
            <span key={d._id} className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: d.calendarColorHex }}
              />
              <span className="font-medium text-foreground/90">
                {d.displayName}
              </span>
            </span>
          ))}
        </div>
        {emergencyWindow ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-900 dark:text-amber-200">
            <ShieldAlert className="size-3.5" />
            Emergency Buffer:{" "}
            {formatMinutes12h(emergencyWindow.startMinute)} –{" "}
            {formatMinutes12h(emergencyWindow.endMinute)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <AlertTriangle className="size-3" />
            No emergency buffer configured for this day
          </span>
        )}
      </div>

      <div className="smile-rbc h-[660px]">
        <BigCalendar<CalendarEvent, CalendarResource>
          localizer={localizer}
          events={events}
          date={date}
          view={view}
          onView={onViewChange}
          onNavigate={onNavigateDate}
          views={["day", "week", "agenda"]}
          resources={
            view === "day" && resources.length > 0 ? resources : undefined
          }
          resourceIdAccessor="resourceId"
          resourceTitleAccessor="resourceTitle"
          step={15}
          timeslots={2}
          min={minTime}
          max={maxTime}
          components={{
            event: CalendarEventBlock,
          }}
          onSelectEvent={(ev) => onSelectAppointment(ev.item)}
          eventPropGetter={(event) => {
            const isCancelled = event.status === "cancelled";
            const isNoShow = event.status === "no_show";
            const isPending = event.status === "pending_approval";
            return {
              style: {
                backgroundColor: isCancelled
                  ? "#64748b"
                  : isNoShow
                    ? "#c2410c"
                    : event.colorHex,
                color: "#ffffff",
                opacity:
                  event.status === "completed"
                    ? 0.72
                    : isCancelled
                      ? 0.6
                      : 1,
                border: isPending
                  ? "2px dashed #fbbf24"
                  : event.status === "in_chair"
                    ? "2px solid #34d399"
                    : "none",
              },
            };
          }}
        />
      </div>
    </div>
  );
}
