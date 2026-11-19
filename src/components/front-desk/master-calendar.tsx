"use client";

import "./big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale";
import { useMemo, useState } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  type View,
} from "react-big-calendar";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../convex/_generated/dataModel";

const locales = { "en-US": enUS };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales,
});

export type CalendarAppointmentItem = {
  _id: Id<"appointments">;
  patientId: Id<"patients">;
  dentistId: Id<"dentists">;
  chairId: Id<"chairs">;
  dateKey: string;
  startTimeUtc: number;
  endTimeUtc: number;
  status: string;
  referenceCode: string;
  patientName: string;
  dentistName: string;
  dentistColorHex: string;
  chairName: string;
  chairRoomCode: string;
  serviceName: string;
  hasMedicalAlert: boolean;
};

type CalendarEvent = {
  id: Id<"appointments">;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  colorHex: string;
  status: string;
  item: CalendarAppointmentItem;
};

type CalendarResource = {
  resourceId: string;
  resourceTitle: string;
};

export function MasterCalendar({
  date,
  onNavigateDate,
  appointments,
  chairs,
  dentists,
  onSelectAppointment,
}: {
  date: Date;
  onNavigateDate: (next: Date) => void;
  appointments: CalendarAppointmentItem[];
  chairs: { _id: Id<"chairs">; name: string; roomCode: string }[];
  dentists: { _id: Id<"dentists">; displayName: string }[];
  onSelectAppointment: (appt: CalendarAppointmentItem) => void;
}) {
  const [view, setView] = useState<View>("day");
  const [groupBy, setGroupBy] = useState<"chair" | "dentist">("chair");

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
        .filter((a) => a.status !== "cancelled")
        .map((appt) => ({
          id: appt._id,
          title: `${appt.hasMedicalAlert ? "⚠ " : ""}${appt.patientName} — ${appt.serviceName} [${appt.status.replace("_", " ")}]`,
          start: new Date(appt.startTimeUtc),
          end: new Date(appt.endTimeUtc),
          resourceId: groupBy === "chair" ? appt.chairId : appt.dentistId,
          colorHex: appt.dentistColorHex,
          status: appt.status,
          item: appt,
        })),
    [appointments, groupBy]
  );

  const minTime = useMemo(() => new Date(1970, 0, 1, 7, 0, 0), []);
  const maxTime = useMemo(() => new Date(1970, 0, 1, 20, 0, 0), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
        </div>

        <p className="text-xs text-muted-foreground">
          Click any booking block to check in, seat in chair, or reschedule.
        </p>
      </div>

      <div className="smile-rbc h-[640px]">
        <BigCalendar<CalendarEvent, CalendarResource>
          localizer={localizer}
          events={events}
          date={date}
          view={view}
          onView={setView}
          onNavigate={onNavigateDate}
          views={["day", "week", "agenda"]}
          resources={view === "day" && resources.length > 0 ? resources : undefined}
          resourceIdAccessor="resourceId"
          resourceTitleAccessor="resourceTitle"
          step={15}
          timeslots={2}
          min={minTime}
          max={maxTime}
          onSelectEvent={(ev) => onSelectAppointment(ev.item)}
          eventPropGetter={(event) => ({
            style: {
              backgroundColor: event.colorHex,
              color: "#ffffff",
              opacity: event.status === "completed" ? 0.65 : 1,
            },
          })}
        />
      </div>
    </div>
  );
}
