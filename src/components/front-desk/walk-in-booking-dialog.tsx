"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { Plus, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const walkInSchema = z.object({
  bookingSource: z.enum([
    "front_desk_walk_in",
    "front_desk_phone",
    "dentist_followup",
  ]),
  serviceId: z.string().min(1, "Select a dental service"),
  dentistId: z.string().min(1, "Select a dentist"),
  chairId: z.string().min(1, "Select an operatory chair"),
  dateKey: z.string().min(8, "Select a date"),
  startTime: z.string().min(4, "Select a start time"),
  chiefComplaint: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  sex: z.enum(["male", "female", "other"]),
});

type WalkInFormValues = z.infer<typeof walkInSchema>;

export function WalkInBookingDialog({
  defaultDateKey,
  dentists,
  chairs,
  services,
  disabled,
  overrideClinicId,
}: {
  defaultDateKey: string;
  dentists: { _id: Id<"dentists">; displayName: string }[];
  chairs: { _id: Id<"chairs">; name: string; roomCode: string }[];
  services: {
    _id: Id<"services">;
    name: string;
    durationMinutes: number;
    pricePhp: number;
  }[];
  disabled: boolean;
  overrideClinicId?: Id<"clinics">;
}) {
  const [open, setOpen] = useState(false);
  const [patientMode, setPatientMode] = useState<"existing" | "new">("new");
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] =
    useState<Id<"patients"> | null>(null);

  const matchingPatients = useQuery(
    api.appointments.searchClinicPatients,
    open ? { search: patientSearch.trim() || undefined, overrideClinicId } : "skip"
  );

  const createWalkInBooking = useMutation(api.appointments.createWalkInBooking);

  const form = useForm<WalkInFormValues>({
    resolver: zodResolver(walkInSchema),
    defaultValues: {
      bookingSource: "front_desk_walk_in",
      serviceId: services[0]?._id ?? "",
      dentistId: dentists[0]?._id ?? "",
      chairId: chairs[0]?._id ?? "",
      dateKey: defaultDateKey,
      startTime: "09:00",
      chiefComplaint: "",
      firstName: "",
      lastName: "",
      phone: "",
      dateOfBirth: "1995-01-01",
      sex: "female",
    },
  });

  const watchedSource = useWatch({
    control: form.control,
    name: "bookingSource",
  });
  const watchedServiceId = useWatch({
    control: form.control,
    name: "serviceId",
  });
  const watchedDentistId = useWatch({
    control: form.control,
    name: "dentistId",
  });
  const watchedChairId = useWatch({ control: form.control, name: "chairId" });
  const watchedSex = useWatch({ control: form.control, name: "sex" });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      form.reset({
        bookingSource: "front_desk_walk_in",
        serviceId: services[0]?._id ?? "",
        dentistId: dentists[0]?._id ?? "",
        chairId: chairs[0]?._id ?? "",
        dateKey: defaultDateKey,
        startTime: "09:00",
        chiefComplaint: "",
        firstName: "",
        lastName: "",
        phone: "",
        dateOfBirth: "1995-01-01",
        sex: "female",
      });
      setSelectedPatientId(null);
    }
  };

  const onSubmit = async (values: WalkInFormValues) => {
    if (patientMode === "existing" && !selectedPatientId) {
      toast.error("Please select an existing patient from the search list.");
      return;
    }
    if (
      patientMode === "new" &&
      (!values.firstName?.trim() ||
        !values.lastName?.trim() ||
        !values.phone?.trim())
    ) {
      toast.error("Enter first name, last name, and phone for the walk-in guest.");
      return;
    }

    // Build local Manila (+08:00) timestamp from dateKey + HH:MM
    const startTimeUtc = Date.parse(
      `${values.dateKey}T${values.startTime}:00+08:00`
    );
    if (Number.isNaN(startTimeUtc)) {
      toast.error("Invalid date or time.");
      return;
    }

    try {
      const res = await createWalkInBooking({
        dateKey: values.dateKey,
        startTimeUtc,
        dentistId: values.dentistId as Id<"dentists">,
        chairId: values.chairId as Id<"chairs">,
        serviceId: values.serviceId as Id<"services">,
        bookingSource: values.bookingSource,
        existingPatientId:
          patientMode === "existing" ? (selectedPatientId ?? undefined) : undefined,
        newPatient:
          patientMode === "new"
            ? {
                firstName: values.firstName!.trim(),
                lastName: values.lastName!.trim(),
                phone: values.phone!.trim(),
                dateOfBirth: values.dateOfBirth || "1995-01-01",
                sex: values.sex,
              }
            : undefined,
        chiefComplaint: values.chiefComplaint?.trim() || undefined,
      });
      toast.success(`Booked ${res.referenceCode}.`);
      setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not create booking."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button disabled={disabled} />}>
        <Plus className="mr-1.5 size-4" />
        Walk-In / Phone Book
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Walk-In & Phone Quick-Book</DialogTitle>
          <DialogDescription>
            Search an existing clinic patient or register a walk-in guest
            without requiring a Clerk account. ACID conflict checks run for both
            dentist and chair.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Patient Mode Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={patientMode === "new" ? "default" : "outline"}
              onClick={() => setPatientMode("new")}
            >
              <UserPlus className="mr-1.5 size-3.5" />
              New Walk-In Guest
            </Button>
            <Button
              type="button"
              size="sm"
              variant={patientMode === "existing" ? "default" : "outline"}
              onClick={() => setPatientMode("existing")}
            >
              <Search className="mr-1.5 size-3.5" />
              Existing Patient
            </Button>
          </div>

          {patientMode === "existing" ? (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <Input
                placeholder="Search by patient name or mobile number…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {(matchingPatients ?? []).length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    No matching patients found.
                  </p>
                ) : (
                  (matchingPatients ?? []).map((p) => (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => setSelectedPatientId(p._id)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                        selectedPatientId === p._id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="font-mono opacity-80">{p.phone}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="wi-first">First Name</Label>
                  <Input id="wi-first" {...form.register("firstName")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wi-last">Last Name</Label>
                  <Input id="wi-last" {...form.register("lastName")} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="wi-phone">Mobile Phone</Label>
                  <Input
                    id="wi-phone"
                    placeholder="+63 917…"
                    {...form.register("phone")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wi-dob">Date of Birth</Label>
                  <Input
                    id="wi-dob"
                    type="date"
                    {...form.register("dateOfBirth")}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Sex</Label>
                  <Select
                    value={watchedSex}
                    onValueChange={(v) => {
                      if (v === "male" || v === "female" || v === "other") {
                        form.setValue("sex", v);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Scheduling Details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Booking Source</Label>
              <Select
                value={watchedSource}
                onValueChange={(v) => {
                  if (
                    v === "front_desk_walk_in" ||
                    v === "front_desk_phone" ||
                    v === "dentist_followup"
                  ) {
                    form.setValue("bookingSource", v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="front_desk_walk_in">
                    Walk-In (Check In Immediately)
                  </SelectItem>
                  <SelectItem value="front_desk_phone">
                    Phone Booking (Confirmed)
                  </SelectItem>
                  <SelectItem value="dentist_followup">
                    Dentist Follow-Up
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Dental Procedure</Label>
              <Select
                value={watchedServiceId}
                onValueChange={(v) => {
                  if (v) form.setValue("serviceId", v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose procedure" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name} ({s.durationMinutes}m · {formatPhp(s.pricePhp)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Dentist</Label>
              <Select
                value={watchedDentistId}
                onValueChange={(v) => {
                  if (v) form.setValue("dentistId", v);
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

            <div className="space-y-1.5">
              <Label>Operatory Chair</Label>
              <Select
                value={watchedChairId}
                onValueChange={(v) => {
                  if (v) form.setValue("chairId", v);
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wi-date">Date</Label>
              <Input id="wi-date" type="date" {...form.register("dateKey")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wi-time">Start Time (Asia/Manila)</Label>
              <Input id="wi-time" type="time" {...form.register("startTime")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wi-chief">Chief Complaint (optional)</Label>
            <Input
              id="wi-chief"
              placeholder="e.g., Walk-in toothache triage"
              {...form.register("chiefComplaint")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Booking…" : "Confirm Booking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
