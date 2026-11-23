"use client";

import { SignInButton } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, LogIn, ShieldAlert, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const COMMON_ALLERGIES = [
  "Lidocaine",
  "Penicillin",
  "Latex",
  "NSAIDs",
  "Amoxicillin",
] as const;

const COMMON_CONDITIONS = [
  "Hypertension",
  "Diabetes",
  "Heart Disease",
  "Asthma",
  "Bleeding Disorder",
] as const;

const intakeSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: z.string().min(4, "Date of birth is required"),
  sex: z.enum(["male", "female", "other"]),
  phone: z.string().min(6, "Phone number is required"),
  email: z.string().email("Enter a valid email").or(z.literal("")),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  allergies: z.array(z.string()),
  otherAllergies: z.string().optional(),
  conditions: z.array(z.string()),
  otherConditions: z.string().optional(),
  isTakingBloodThinners: z.boolean(),
  isPregnant: z.boolean(),
  dentalAnxietyLevel: z.enum(["none", "mild", "moderate", "severe"]),
  medicalNotes: z.string().optional(),
  chiefComplaint: z.string().optional(),
});

type IntakeFormValues = z.infer<typeof intakeSchema>;

export type PatientIntakeSubmitPayload = {
  bookingFor: "self" | "dependent";
  existingPatientId?: Id<"patients">;
  chiefComplaint?: string;
  patientProfile: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    sex: "male" | "female" | "other";
    email?: string;
    phone: string;
    address?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    medicalHistory: {
      allergies: string[];
      conditions: string[];
      isTakingBloodThinners: boolean;
      isPregnant: boolean;
      dentalAnxietyLevel: "none" | "mild" | "moderate" | "severe";
      notes?: string;
    };
  };
};

function profileToDefaults(
  profile: Doc<"patients"> | null,
  fallbackUser: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  } | null
): IntakeFormValues {
  const knownAllergies = (profile?.medicalHistory.allergies ?? []).filter((a) =>
    (COMMON_ALLERGIES as readonly string[]).includes(a)
  );
  const extraAllergies = (profile?.medicalHistory.allergies ?? []).filter(
    (a) => !(COMMON_ALLERGIES as readonly string[]).includes(a)
  );
  const knownConditions = (profile?.medicalHistory.conditions ?? []).filter((c) =>
    (COMMON_CONDITIONS as readonly string[]).includes(c)
  );
  const extraConditions = (profile?.medicalHistory.conditions ?? []).filter(
    (c) => !(COMMON_CONDITIONS as readonly string[]).includes(c)
  );

  return {
    firstName: profile?.firstName ?? fallbackUser?.firstName ?? "",
    lastName: profile?.lastName ?? fallbackUser?.lastName ?? "",
    dateOfBirth: profile?.dateOfBirth ?? "",
    sex: profile?.sex ?? "female",
    phone: profile?.phone ?? fallbackUser?.phone ?? "",
    email: profile?.email ?? fallbackUser?.email ?? "",
    address: profile?.address ?? "",
    emergencyContactName: profile?.emergencyContactName ?? "",
    emergencyContactPhone: profile?.emergencyContactPhone ?? "",
    allergies: knownAllergies,
    otherAllergies: extraAllergies.join(", "),
    conditions: knownConditions,
    otherConditions: extraConditions.join(", "),
    isTakingBloodThinners:
      profile?.medicalHistory.isTakingBloodThinners ?? false,
    isPregnant: profile?.medicalHistory.isPregnant ?? false,
    dentalAnxietyLevel: profile?.medicalHistory.dentalAnxietyLevel ?? "none",
    medicalNotes: profile?.medicalHistory.notes ?? "",
    chiefComplaint: "",
  };
}

function IntakeFormInner({
  bookingFor,
  existingPatientId,
  initialValues,
  submitting,
  onBack,
  onSubmit,
}: {
  bookingFor: "self" | "dependent";
  existingPatientId?: Id<"patients">;
  initialValues: IntakeFormValues;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (payload: PatientIntakeSubmitPayload) => Promise<void>;
}) {
  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: initialValues,
  });

  const watchedSex = useWatch({ control: form.control, name: "sex" });
  const watchedAllergies =
    useWatch({ control: form.control, name: "allergies" }) ?? [];
  const watchedConditions =
    useWatch({ control: form.control, name: "conditions" }) ?? [];
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

  const toggleItem = (field: "allergies" | "conditions", item: string) => {
    const current = field === "allergies" ? watchedAllergies : watchedConditions;
    const next = current.includes(item)
      ? current.filter((x) => x !== item)
      : [...current, item];
    form.setValue(field, next);
  };

  const handleFormSubmit = async (values: IntakeFormValues) => {
    const extraAllergies = (values.otherAllergies ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const mergedAllergies = Array.from(
      new Set([...values.allergies, ...extraAllergies])
    );
    const extraConditions = (values.otherConditions ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const mergedConditions = Array.from(
      new Set([...values.conditions, ...extraConditions])
    );

    await onSubmit({
      bookingFor,
      existingPatientId,
      chiefComplaint: values.chiefComplaint?.trim() || undefined,
      patientProfile: {
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth,
        sex: values.sex,
        email: values.email || undefined,
        phone: values.phone,
        address: values.address || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        medicalHistory: {
          allergies: mergedAllergies,
          conditions: mergedConditions,
          isTakingBloodThinners: values.isTakingBloodThinners,
          isPregnant: values.isPregnant,
          dentalAnxietyLevel: values.dentalAnxietyLevel,
          notes: values.medicalNotes?.trim() || undefined,
        },
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pt-first">First Name</Label>
          <Input id="pt-first" {...form.register("firstName")} />
          {form.formState.errors.firstName ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.firstName.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-last">Last Name</Label>
          <Input id="pt-last" {...form.register("lastName")} />
          {form.formState.errors.lastName ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.lastName.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pt-dob">Date of Birth</Label>
          <Input id="pt-dob" type="date" {...form.register("dateOfBirth")} />
          {form.formState.errors.dateOfBirth ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.dateOfBirth.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
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

        <div className="space-y-1.5">
          <Label htmlFor="pt-phone">Mobile Number</Label>
          <Input
            id="pt-phone"
            placeholder="+63 917 000 0000"
            {...form.register("phone")}
          />
          {form.formState.errors.phone ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.phone.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pt-email">Email (for reminders)</Label>
          <Input id="pt-email" type="email" {...form.register("email")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-emerg">Emergency Contact (Name / Phone)</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              id="pt-emerg"
              placeholder="Contact Name"
              {...form.register("emergencyContactName")}
            />
            <Input
              placeholder="Phone"
              {...form.register("emergencyContactPhone")}
            />
          </div>
        </div>
      </div>

      {/* Dental & Medical Intake Flags */}
      <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-semibold">Dental & Medical Safety Intake</h3>
          <p className="text-xs text-muted-foreground">
            Shared privately with your assigned dentist before treatment.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Known Allergies</Label>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_ALLERGIES.map((allergy) => {
              const active = watchedAllergies.includes(allergy);
              return (
                <Button
                  key={allergy}
                  type="button"
                  size="sm"
                  variant={active ? "destructive" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => toggleItem("allergies", allergy)}
                >
                  {allergy}
                </Button>
              );
            })}
          </div>
          <Input
            placeholder="Other allergies (comma-separated, optional)"
            className="text-xs"
            {...form.register("otherAllergies")}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Medical Conditions</Label>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_CONDITIONS.map((cond) => {
              const active = watchedConditions.includes(cond);
              return (
                <Button
                  key={cond}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => toggleItem("conditions", cond)}
                >
                  {cond}
                </Button>
              );
            })}
          </div>
          <Input
            placeholder="Other medical conditions (comma-separated, optional)"
            className="text-xs"
            {...form.register("otherConditions")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
            <span className="text-xs font-medium">Taking Blood Thinners</span>
            <Switch
              checked={Boolean(watchedBloodThinners)}
              onCheckedChange={(checked) =>
                form.setValue("isTakingBloodThinners", checked)
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
            <span className="text-xs font-medium">Currently Pregnant</span>
            <Switch
              checked={Boolean(watchedPregnant)}
              onCheckedChange={(checked) => form.setValue("isPregnant", checked)}
            />
          </div>

          <div className="space-y-1">
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
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Dental Anxiety" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Anxiety: None</SelectItem>
                <SelectItem value="mild">Anxiety: Mild</SelectItem>
                <SelectItem value="moderate">Anxiety: Moderate</SelectItem>
                <SelectItem value="severe">Anxiety: Severe</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pt-chief">Chief Complaint / Reason for Visit</Label>
            <Input
              id="pt-chief"
              placeholder="e.g., Routine 6-month cleaning or sensitivity on upper right molar"
              {...form.register("chiefComplaint")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-med-notes">Additional Medical / Comfort Notes</Label>
            <Input
              id="pt-med-notes"
              placeholder="e.g., Medications, tooth sensitivity, or preferred hand signals"
              {...form.register("medicalNotes")}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" />
          Change Time Slot
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Confirming Booking…" : "Confirm Appointment"}
        </Button>
      </div>
    </form>
  );
}

export function PatientIntakeStep({
  clinicId,
  initialPatientId,
  submitting,
  onBack,
  onSubmit,
}: {
  clinicId: Id<"clinics">;
  initialPatientId?: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (payload: PatientIntakeSubmitPayload) => Promise<void>;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const profileData = useQuery(
    api.publicBooking.getMyPatientProfilesForClinic,
    isAuthenticated ? { clinicId } : "skip"
  );

  // Immediately provision Convex user row after Clerk sign-in/sign-up so new patients never stall
  useEffect(() => {
    if (isAuthenticated) {
      void ensureUser().catch(() => {});
    }
  }, [isAuthenticated, ensureUser]);

  const [bookingForOverride, setBookingFor] = useState<
    "self" | "dependent" | null
  >(null);
  const [selectedDependentOverride, setSelectedDependentId] = useState<
    string | null
  >(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Checking your account…
        </CardContent>
      </Card>
    );
  }

  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign In to Complete Your Booking</CardTitle>
          <CardDescription>
            Your selected time slot is held for 5 minutes. Sign in or create a
            free Smile account so we can securely link your dental chart and
            family dependents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1.5 size-4" />
            Back to Slots
          </Button>
          <SignInButton mode="modal">
            <Button>
              <LogIn className="mr-1.5 size-4" />
              Sign In / Create Account
            </Button>
          </SignInButton>
        </CardContent>
      </Card>
    );
  }

  if (profileData === undefined) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading your patient profile…
        </CardContent>
      </Card>
    );
  }

  if (profileData === null) {
    return (
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Finishing account sync…</AlertTitle>
        <AlertDescription>
          Your account is syncing with Convex. Wait a moment or refresh to
          complete your booking.
        </AlertDescription>
      </Alert>
    );
  }

  const matchedInitialDependent = initialPatientId
    ? (profileData.dependents.find((d) => d._id === initialPatientId) ?? null)
    : null;
  const bookingFor: "self" | "dependent" =
    bookingForOverride ?? (matchedInitialDependent ? "dependent" : "self");
  const selectedDependentId =
    selectedDependentOverride ??
    (matchedInitialDependent ? matchedInitialDependent._id : "new");

  const activeDependent =
    bookingFor === "dependent" && selectedDependentId !== "new"
      ? profileData.dependents.find((d) => d._id === selectedDependentId) ?? null
      : null;

  const formKey =
    bookingFor === "self"
      ? `self-${profileData.selfProfile?._id ?? "new"}`
      : `dep-${activeDependent?._id ?? "new"}`;

  const initialValues =
    bookingFor === "self"
      ? profileToDefaults(profileData.selfProfile, profileData.user)
      : profileToDefaults(
          activeDependent,
          activeDependent
            ? null
            : {
                firstName: "",
                lastName: profileData.user.lastName,
                email: profileData.user.email,
                phone: profileData.selfProfile?.phone ?? profileData.user.phone,
              }
        );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Patient Profile & Medical Intake</CardTitle>
          <CardDescription>
            Book for yourself or select/add a child or senior family dependent.
          </CardDescription>
        </div>

        {/* Self vs Family Dependent Selector */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={bookingFor === "self" ? "default" : "outline"}
            onClick={() => setBookingFor("self")}
          >
            Myself
          </Button>
          <Button
            type="button"
            size="sm"
            variant={bookingFor === "dependent" ? "default" : "outline"}
            onClick={() => setBookingFor("dependent")}
          >
            <Users className="mr-1.5 size-3.5" />
            Family Dependent
          </Button>
        </div>

        {bookingFor === "dependent" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
            <Button
              type="button"
              size="sm"
              variant={selectedDependentId === "new" ? "secondary" : "ghost"}
              onClick={() => setSelectedDependentId("new")}
            >
              <UserPlus className="mr-1.5 size-3.5" />
              New Dependent
            </Button>
            {profileData.dependents.map((dep) => (
              <Button
                key={dep._id}
                type="button"
                size="sm"
                variant={selectedDependentId === dep._id ? "secondary" : "ghost"}
                onClick={() => setSelectedDependentId(dep._id)}
              >
                {dep.firstName} {dep.lastName}
              </Button>
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <IntakeFormInner
          key={formKey}
          bookingFor={bookingFor}
          existingPatientId={activeDependent?._id}
          initialValues={initialValues}
          submitting={submitting}
          onBack={onBack}
          onSubmit={onSubmit}
        />
      </CardContent>
    </Card>
  );
}
