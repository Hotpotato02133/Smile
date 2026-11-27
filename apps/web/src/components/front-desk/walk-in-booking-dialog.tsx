"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Clock,
  Plus,
  Search,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  formatMinutes12h,
  formatPhp,
  getErrorMessage,
  localDateTimeToUtc,
  minutesToTimeInput,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const walkInSchema = z.object({
  bookingSource: z.enum([
    "front_desk_walk_in",
    "front_desk_phone",
    "dentist_followup",
    "waitlist_claim",
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
  email: z.string().optional(),
  dateOfBirth: z.string().optional(),
  sex: z.enum(["male", "female", "other"]),
  allergiesCsv: z.string().optional(),
  conditionsCsv: z.string().optional(),
  isTakingBloodThinners: z.boolean(),
  isPregnant: z.boolean(),
  dentalAnxietyLevel: z.enum(["none", "mild", "moderate", "severe"]),
});

type WalkInFormValues = z.infer<typeof walkInSchema>;

export type WalkInBookingPrefill = {
  patientId: Id<"patients">;
  patientName: string;
  patientPhone: string;
  serviceId?: Id<"services">;
  dentistId?: Id<"dentists"> | null;
  dateKey?: string;
  waitlistId?: Id<"waitlist">;
};

type WalkInDialogSharedProps = {
  clinicId: Id<"clinics">;
  clinicTimezone: string;
  defaultDateKey: string;
  emergencyWindow: { startMinute: number; endMinute: number } | null;
  dentists: {
    _id: Id<"dentists">;
    displayName: string;
    defaultChairId?: Id<"chairs"> | null;
  }[];
  chairs: { _id: Id<"chairs">; name: string; roomCode: string }[];
  services: {
    _id: Id<"services">;
    name: string;
    durationMinutes: number;
    bufferMinutes?: number;
    pricePhp: number;
  }[];
  overrideClinicId?: Id<"clinics">;
  prefill?: WalkInBookingPrefill | null;
};

function WalkInBookingFormBody({
  clinicId,
  clinicTimezone,
  defaultDateKey,
  emergencyWindow,
  dentists,
  chairs,
  services,
  overrideClinicId,
  prefill,
  onClose,
}: WalkInDialogSharedProps & { onClose: () => void }) {
  const [patientMode, setPatientMode] = useState<"existing" | "new">(
    prefill ? "existing" : "new"
  );
  const [patientSearch, setPatientSearch] = useState(
    prefill?.patientName ?? ""
  );
  const [selectedPatientId, setSelectedPatientId] =
    useState<Id<"patients"> | null>(prefill?.patientId ?? null);
  const [showMedicalIntake, setShowMedicalIntake] = useState(false);

  const matchingPatients = useQuery(api.appointments.searchClinicPatients, {
    search: patientSearch.trim() || undefined,
    overrideClinicId,
  });

  const createWalkInBooking = useMutation(api.appointments.createWalkInBooking);

  const initialDentist = prefill?.dentistId
    ? dentists.find((d) => d._id === prefill.dentistId)
    : dentists[0];

  const form = useForm<WalkInFormValues>({
    resolver: zodResolver(walkInSchema),
    defaultValues: {
      bookingSource: prefill?.waitlistId
        ? "waitlist_claim"
        : prefill
          ? "front_desk_phone"
          : "front_desk_walk_in",
      serviceId: prefill?.serviceId ?? services[0]?._id ?? "",
      dentistId: initialDentist?._id ?? dentists[0]?._id ?? "",
      chairId: initialDentist?.defaultChairId ?? chairs[0]?._id ?? "",
      dateKey: prefill?.dateKey ?? defaultDateKey,
      startTime: "09:00",
      chiefComplaint: "",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      dateOfBirth: "1995-01-01",
      sex: "female",
      allergiesCsv: "",
      conditionsCsv: "",
      isTakingBloodThinners: false,
      isPregnant: false,
      dentalAnxietyLevel: "none",
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
  const watchedDateKey = useWatch({ control: form.control, name: "dateKey" });
  const watchedStartTime = useWatch({
    control: form.control,
    name: "startTime",
  });
  const watchedSex = useWatch({ control: form.control, name: "sex" });
  const watchedPhone = useWatch({ control: form.control, name: "phone" });
  const watchedBloodThinners = useWatch({
    control: form.control,
    name: "isTakingBloodThinners",
  });
  const watchedPregnant = useWatch({
    control: form.control,
    name: "isPregnant",
  });
  const watchedAnxiety = useWatch({
    control: form.control,
    name: "dentalAnxietyLevel",
  });

  // Live conflict-checked available slots (including clinic's daily emergency buffer blocks)
  const slotQuery = useQuery(
    api.availability.getAvailableSlots,
    watchedServiceId && watchedDateKey
      ? {
          clinicId,
          serviceId: watchedServiceId as Id<"services">,
          dateKey: watchedDateKey,
          preferredDentistId: watchedDentistId
            ? (watchedDentistId as Id<"dentists">)
            : undefined,
          includeEmergencyBuffer: true,
        }
      : "skip"
  );

  // Check duplicate phone number for new walk-in guests
  const duplicatePhoneCheck = useQuery(
    api.appointments.searchClinicPatients,
    patientMode === "new" &&
      (watchedPhone?.replace(/[\s()-]/g, "").length ?? 0) >= 7
      ? { search: watchedPhone?.trim(), overrideClinicId }
      : "skip"
  );

  const availableSlots = useMemo(() => slotQuery?.slots ?? [], [slotQuery]);
  const emergencySlotsCount = useMemo(
    () => availableSlots.filter((s) => s.isEmergencyBufferSlot).length,
    [availableSlots]
  );

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
      toast.error(
        "Enter first name, last name, and phone for the walk-in guest."
      );
      return;
    }

    const startTimeUtc = localDateTimeToUtc(
      values.dateKey,
      values.startTime,
      clinicTimezone
    );
    if (Number.isNaN(startTimeUtc)) {
      toast.error("Invalid date or time.");
      return;
    }

    const allergies = (values.allergiesCsv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const conditions = (values.conditionsCsv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await createWalkInBooking({
        dateKey: values.dateKey,
        startTimeUtc,
        dentistId: values.dentistId as Id<"dentists">,
        chairId: values.chairId as Id<"chairs">,
        serviceId: values.serviceId as Id<"services">,
        bookingSource: values.bookingSource,
        waitlistId: prefill?.waitlistId,
        existingPatientId:
          patientMode === "existing"
            ? (selectedPatientId ?? undefined)
            : undefined,
        newPatient:
          patientMode === "new"
            ? {
                firstName: values.firstName!.trim(),
                lastName: values.lastName!.trim(),
                phone: values.phone!.trim(),
                email: values.email?.trim() || undefined,
                dateOfBirth: values.dateOfBirth || "1995-01-01",
                sex: values.sex,
                allergies,
                conditions,
                isTakingBloodThinners: values.isTakingBloodThinners,
                isPregnant: values.isPregnant,
                dentalAnxietyLevel: values.dentalAnxietyLevel,
              }
            : undefined,
        chiefComplaint: values.chiefComplaint?.trim() || undefined,
      });
      toast.success(
        prefill?.waitlistId
          ? `Waitlist slot booked (${res.referenceCode}) and marked claimed.`
          : `Booked ${res.referenceCode}.`
      );
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not create booking."));
    }
  };

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {prefill?.waitlistId
            ? `Book Waitlisted Patient · ${prefill.patientName}`
            : "Walk-In & Phone Quick-Book"}
        </DialogTitle>
        <DialogDescription>
          Search an existing clinic patient or register a walk-in guest without
          requiring a Clerk account. ACID conflict checks validate dentist,
          chair, sterilization buffer, and emergency blocks.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Patient Mode Toggle */}
        {!prefill?.waitlistId ? (
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
        ) : null}

        {patientMode === "existing" ? (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <Input
              placeholder="Search by patient name, mobile number, or email…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
            />
            <div className="max-h-40 space-y-1 overflow-y-auto">
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
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                      selectedPatientId === p._id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      {p.noShowCount > 0 ? (
                        <Badge
                          variant="outline"
                          className={`h-4 px-1 text-[10px] ${
                            selectedPatientId === p._id
                              ? "border-orange-200 text-orange-100"
                              : "border-orange-500/40 bg-orange-500/15 text-orange-800 dark:text-orange-200"
                          }`}
                        >
                          {p.noShowCount} No-Show{p.noShowCount > 1 ? "s" : ""}
                        </Badge>
                      ) : null}
                      {p.hasMedicalAlert ? (
                        <Badge
                          variant="destructive"
                          className="h-4 px-1 text-[10px]"
                        >
                          Med Alert
                        </Badge>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono opacity-80">
                      {p.phone}
                    </span>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="wi-phone">Mobile Phone</Label>
                <Input
                  id="wi-phone"
                  placeholder="+63 917…"
                  {...form.register("phone")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wi-email">Email (optional)</Label>
                <Input
                  id="wi-email"
                  type="email"
                  placeholder="patient@example.com"
                  {...form.register("email")}
                />
              </div>
            </div>

            {duplicatePhoneCheck && duplicatePhoneCheck.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  Existing record found for this phone:{" "}
                  <strong>
                    {duplicatePhoneCheck[0].firstName}{" "}
                    {duplicatePhoneCheck[0].lastName}
                  </strong>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  onClick={() => {
                    setPatientMode("existing");
                    setSelectedPatientId(duplicatePhoneCheck[0]._id);
                    setPatientSearch(duplicatePhoneCheck[0].phone);
                  }}
                >
                  Use Existing
                </Button>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
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

            <div className="border-t pt-2">
              <button
                type="button"
                onClick={() => setShowMedicalIntake((s) => !s)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {showMedicalIntake
                  ? "Hide quick medical intake flags"
                  : "+ Add allergies / medical intake alerts (optional)"}
              </button>
              {showMedicalIntake ? (
                <div className="mt-2.5 space-y-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="wi-allergies" className="text-xs">
                        Allergies (comma-separated)
                      </Label>
                      <Input
                        id="wi-allergies"
                        placeholder="Lidocaine, Penicillin, Latex"
                        {...form.register("allergiesCsv")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="wi-cond" className="text-xs">
                        Conditions (comma-separated)
                      </Label>
                      <Input
                        id="wi-cond"
                        placeholder="Hypertension, Diabetes"
                        {...form.register("conditionsCsv")}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={watchedBloodThinners}
                        onCheckedChange={(c) =>
                          form.setValue("isTakingBloodThinners", c)
                        }
                      />
                      Blood Thinners
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={watchedPregnant}
                        onCheckedChange={(c) => form.setValue("isPregnant", c)}
                      />
                      Pregnant
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Anxiety:</span>
                      <Select
                        value={watchedAnxiety}
                        onValueChange={(v) => {
                          if (
                            v === "none" ||
                            v === "mild" ||
                            v === "moderate" ||
                            v === "severe"
                          ) {
                            form.setValue("dentalAnxietyLevel", v);
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="mild">Mild</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="severe">Severe</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ) : null}
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
                  v === "dentist_followup" ||
                  v === "waitlist_claim"
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
                <SelectItem value="waitlist_claim">
                  Waitlist Opening Claim
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
                if (v) {
                  form.setValue("dentistId", v);
                  const match = dentists.find((d) => d._id === v);
                  if (match?.defaultChairId) {
                    form.setValue("chairId", match.defaultChairId);
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
            <Label htmlFor="wi-time">Start Time ({clinicTimezone})</Label>
            <Input id="wi-time" type="time" {...form.register("startTime")} />
          </div>
        </div>

        {/* Live Conflict-Checked Slots + Daily Emergency Buffer Picker */}
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Clock className="size-3.5 text-muted-foreground" />
              Open Slots on {watchedDateKey}
            </span>
            {emergencyWindow ? (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                <ShieldAlert className="size-3" />
                Emergency Buffer ({formatMinutes12h(emergencyWindow.startMinute)}
                –{formatMinutes12h(emergencyWindow.endMinute)})
                {emergencySlotsCount > 0
                  ? ` · ${emergencySlotsCount} open`
                  : ""}
              </span>
            ) : null}
          </div>

          {slotQuery === undefined ? (
            <p className="text-xs text-muted-foreground">
              Checking dentist & chair availability…
            </p>
          ) : availableSlots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No standard open slots for this dentist on {watchedDateKey}. You
              may choose another dentist or enter a custom walk-in time above.
            </p>
          ) : (
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {availableSlots.map((slot) => {
                const slotHHMM = minutesToTimeInput(slot.startMinute);
                const isPicked =
                  watchedStartTime === slotHHMM &&
                  watchedDentistId === slot.dentistId &&
                  watchedChairId === slot.chairId;
                return (
                  <button
                    key={`${slot.startTimeUtc}-${slot.dentistId}-${slot.chairId}`}
                    type="button"
                    onClick={() => {
                      form.setValue("startTime", slotHHMM);
                      form.setValue("dentistId", slot.dentistId);
                      form.setValue("chairId", slot.chairId);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                      isPicked
                        ? "border-primary bg-primary text-primary-foreground"
                        : slot.isEmergencyBufferSlot
                          ? "border-amber-500/50 bg-amber-500/15 text-amber-950 hover:bg-amber-500/25 dark:text-amber-100"
                          : "bg-background hover:bg-accent"
                    }`}
                  >
                    <span>{formatMinutes12h(slot.startMinute)}</span>
                    {slot.isEmergencyBufferSlot ? (
                      <span className="rounded bg-amber-600 px-1 text-[9px] font-sans font-semibold text-white">
                        EMERG
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
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
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Booking…" : "Confirm Booking"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function WalkInBookingDialog({
  disabled,
  externalOpen,
  onExternalOpenChange,
  prefill,
  ...rest
}: WalkInDialogSharedProps & {
  disabled: boolean;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (onExternalOpenChange) onExternalOpenChange(next);
    else setInternalOpen(next);
  };

  const formKey = prefill
    ? `prefill-${prefill.patientId}-${prefill.waitlistId ?? ""}-${prefill.dateKey ?? rest.defaultDateKey}`
    : `new-${rest.defaultDateKey}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {externalOpen === undefined ? (
        <DialogTrigger render={<Button disabled={disabled} />}>
          <Plus className="mr-1.5 size-4" />
          Walk-In / Phone Book
        </DialogTrigger>
      ) : null}
      {open ? (
        <WalkInBookingFormBody
          key={formKey}
          prefill={prefill}
          onClose={() => setOpen(false)}
          {...rest}
        />
      ) : null}
    </Dialog>
  );
}
