"use client";

import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Calendar,
  CalendarPlus,
  Download,
  MapPin,
  ShieldCheck,
  Stethoscope,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
import { buildGoogleCalendarUrl, downloadIcsFile } from "@/lib/calendar-export";
import { formatDateTime, formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const APPT_STATUS_LABEL: Record<string, { label: string; className: string }> =
  {
    pending_approval: {
      label: "Pending",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    },
    confirmed: {
      label: "Confirmed",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    checked_in: {
      label: "Checked In",
      className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    },
    in_chair: {
      label: "In Chair",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    completed: {
      label: "Completed",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    cancelled: {
      label: "Cancelled",
      className: "border-border bg-muted text-muted-foreground",
    },
    no_show: {
      label: "No-Show",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
  };

function ConnectedPatientPortal() {
  const appointments = useQuery(api.publicBooking.getMyAppointments, {});
  const cancelAppointment = useMutation(api.publicBooking.cancelMyAppointment);
  const [cancellingId, setCancellingId] = useState<Id<"appointments"> | null>(
    null
  );

  const handleCancel = async (appointmentId: Id<"appointments">) => {
    setCancellingId(appointmentId);
    try {
      await cancelAppointment({ appointmentId });
      toast.success("Appointment cancelled.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not cancel appointment."));
    } finally {
      setCancellingId(null);
    }
  };

  const upcoming = (appointments ?? []).filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "completed" &&
      a.status !== "no_show"
  );
  const history = (appointments ?? []).filter(
    (a) =>
      a.status === "cancelled" ||
      a.status === "completed" ||
      a.status === "no_show"
  );

  const renderList = (items: NonNullable<typeof appointments>, allowCancel: boolean) => {
    if (items.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {allowCancel
              ? "You have no upcoming dental appointments."
              : "No past appointments yet."}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {items.map((appt) => {
          const badge = APPT_STATUS_LABEL[appt.status] ?? {
            label: appt.status,
            className: "",
          };
          const calEvent = {
            title: `${appt.serviceName} — ${appt.clinicName}`,
            description: `Dentist: ${appt.dentistName}\nChair: ${appt.chairName}\nRef: ${appt.referenceCode}`,
            location: appt.clinicAddress,
            startTimeUtc: appt.startTimeUtc,
            endTimeUtc: appt.endTimeUtc,
            uid: `${appt._id}@smile-dental.app`,
          };
          return (
            <Card key={appt._id}>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {appt.referenceCode}
                    </Badge>
                    <Badge variant="outline" className={badge.className}>
                      {badge.label}
                    </Badge>
                    {appt.isDependent ? (
                      <Badge variant="secondary">Dependent: {appt.patientName}</Badge>
                    ) : null}
                  </div>
                  <CardTitle className="text-base">
                    {appt.serviceName} · {appt.clinicName}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {formatDateTime(appt.startTimeUtc)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Stethoscope className="size-3.5" />
                      {appt.dentistName} ({appt.chairName})
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {appt.clinicAddress}
                    </span>
                  </CardDescription>
                </div>

                <div className="font-mono text-sm font-semibold tabular-nums">
                  {formatPhp(appt.pricePhp)}
                </div>
              </CardHeader>

              <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <div className="flex flex-wrap gap-2">
                  {allowCancel ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={buildGoogleCalendarUrl(calEvent)}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <CalendarPlus className="mr-1.5 size-3.5" />
                        Google Calendar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          downloadIcsFile(calEvent, `${appt.referenceCode}.ics`)
                        }
                      >
                        <Download className="mr-1.5 size-3.5" />
                        Download .ICS
                      </Button>
                    </>
                  ) : null}
                  {appt.clinicSlug ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      render={<Link href={`/c/${appt.clinicSlug}`} />}
                    >
                      Book Again
                    </Button>
                  ) : null}
                </div>

                {allowCancel ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={cancellingId === appt._id}
                    onClick={() => handleCancel(appt._id)}
                  >
                    <XCircle className="mr-1.5 size-3.5" />
                    {cancellingId === appt._id ? "Cancelling…" : "Cancel"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            My Dental Appointments
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage visits for yourself and your family dependents across all
            Smile clinics.
          </p>
        </div>
        <Button render={<Link href="/clinics" />}>Book New Appointment</Button>
      </div>

      {appointments === undefined ? (
        <p className="text-sm text-muted-foreground">
          Loading your appointments…
        </p>
      ) : (
        <Tabs defaultValue="upcoming">
          <TabsList>
            <TabsTrigger value="upcoming">
              Upcoming ({upcoming.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              History ({history.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">
            {renderList(upcoming, true)}
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            {renderList(history, false)}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

export function PatientPortal() {
  const { isConfigured } = useEnvConfig();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Smile
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" render={<Link href="/clinics" />}>
            Find Clinics
          </Button>
          {isConfigured ? <UserButton /> : null}
        </div>
      </header>

      {!isConfigured ? (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Connect Clerk & Convex to view appointments</AlertTitle>
            <AlertDescription>
              Configure <code>.env.local</code> and run{" "}
              <code>npx convex dev</code> to access the patient portal.
            </AlertDescription>
          </Alert>
        </main>
      ) : (
        <ConnectedPatientPortal />
      )}
    </div>
  );
}
