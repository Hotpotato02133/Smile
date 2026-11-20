"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  HeartPulse,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  hasCriticalMedicalFlags,
  type PatientDashboardData,
  type PatientProfileItem,
} from "@/components/patient/types";

const COMMON_ALLERGIES = ["Lidocaine", "Penicillin", "Latex", "NSAIDs", "Aspirin"];
const COMMON_CONDITIONS = [
  "Hypertension",
  "Diabetes",
  "Heart Disease",
  "Asthma",
  "Bleeding Disorder",
];

const profileFormSchema = z.object({
  clinicId: z.string().min(1, "Please select a dental clinic."),
  profileKind: z.enum(["self", "dependent"]),
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  dateOfBirth: z.string().min(4, "Date of birth is required."),
  sex: z.enum(["male", "female", "other"]),
  phone: z.string().trim().min(7, "Valid phone number is required."),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  allergiesText: z.string().optional(),
  conditionsText: z.string().optional(),
  isTakingBloodThinners: z.boolean(),
  isPregnant: z.boolean(),
  dentalAnxietyLevel: z.enum(["none", "mild", "moderate", "severe"]),
  notes: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

function parseCommaList(text?: string): string[] {
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

interface FamilyHealthViewProps {
  data: PatientDashboardData;
  createDialogOpen: boolean;
  onCreateDialogOpenChange: (open: boolean) => void;
}

export function FamilyHealthView({
  data,
  createDialogOpen,
  onCreateDialogOpenChange,
}: FamilyHealthViewProps) {
  const updateProfile = useMutation(api.patientPortal.updateMyMedicalProfile);
  const createProfile = useMutation(
    api.patientPortal.createSelfOrDependentProfile
  );

  const [editingProfile, setEditingProfile] =
    useState<PatientProfileItem | null>(null);

  const isDialogOpen = createDialogOpen || editingProfile !== null;
  const isEditing = editingProfile !== null;

  const defaultClinicId =
    data.profiles[0]?.clinicId ?? data.featuredClinics[0]?._id ?? "";

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: editingProfile
      ? {
          clinicId: editingProfile.clinicId,
          profileKind: editingProfile.isDependent ? "dependent" : "self",
          firstName: editingProfile.firstName,
          lastName: editingProfile.lastName,
          dateOfBirth: editingProfile.dateOfBirth,
          sex: editingProfile.sex,
          phone: editingProfile.phone,
          address: editingProfile.address,
          emergencyContactName: editingProfile.emergencyContactName,
          emergencyContactPhone: editingProfile.emergencyContactPhone,
          allergiesText: editingProfile.medicalHistory.allergies.join(", "),
          conditionsText: editingProfile.medicalHistory.conditions.join(", "),
          isTakingBloodThinners:
            editingProfile.medicalHistory.isTakingBloodThinners,
          isPregnant: editingProfile.medicalHistory.isPregnant,
          dentalAnxietyLevel: editingProfile.medicalHistory.dentalAnxietyLevel,
          notes: editingProfile.medicalHistory.notes,
        }
      : {
          clinicId: defaultClinicId,
          profileKind: data.profiles.length === 0 ? "self" : "dependent",
          firstName: data.profiles.length === 0 ? data.user.firstName : "",
          lastName: data.profiles.length === 0 ? data.user.lastName : "",
          dateOfBirth: "1995-01-01",
          sex: "other",
          phone: data.user.phone || "",
          address: "",
          emergencyContactName: "",
          emergencyContactPhone: "",
          allergiesText: "",
          conditionsText: "",
          isTakingBloodThinners: false,
          isPregnant: false,
          dentalAnxietyLevel: "none",
          notes: "",
        },
  });

  const toggleChipInField = (
    fieldName: "allergiesText" | "conditionsText",
    chip: string
  ) => {
    const current = parseCommaList(form.getValues(fieldName));
    const exists = current.some(
      (item) => item.toLowerCase() === chip.toLowerCase()
    );
    const next = exists
      ? current.filter((item) => item.toLowerCase() !== chip.toLowerCase())
      : [...current, chip];
    form.setValue(fieldName, next.join(", "), { shouldDirty: true });
  };

  const closeDialog = () => {
    setEditingProfile(null);
    onCreateDialogOpenChange(false);
  };

  const onSubmit = async (values: ProfileFormValues) => {
    const medicalHistory = {
      allergies: parseCommaList(values.allergiesText),
      conditions: parseCommaList(values.conditionsText),
      isTakingBloodThinners: values.isTakingBloodThinners,
      isPregnant: values.isPregnant,
      dentalAnxietyLevel: values.dentalAnxietyLevel,
      notes: values.notes?.trim() || undefined,
    };

    try {
      if (editingProfile) {
        await updateProfile({
          patientId: editingProfile._id,
          firstName: values.firstName,
          lastName: values.lastName,
          dateOfBirth: values.dateOfBirth,
          sex: values.sex,
          phone: values.phone,
          address: values.address,
          emergencyContactName: values.emergencyContactName,
          emergencyContactPhone: values.emergencyContactPhone,
          medicalHistory,
        });
        toast.success("Health intake profile updated.");
      } else {
        await createProfile({
          clinicId: values.clinicId as Id<"clinics">,
          profileKind: values.profileKind,
          firstName: values.firstName,
          lastName: values.lastName,
          dateOfBirth: values.dateOfBirth,
          sex: values.sex,
          phone: values.phone,
          address: values.address,
          emergencyContactName: values.emergencyContactName,
          emergencyContactPhone: values.emergencyContactPhone,
          medicalHistory,
        });
        toast.success(
          values.profileKind === "dependent"
            ? "Family dependent added and ready for booking."
            : "Patient intake profile saved."
        );
      }
      closeDialog();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save profile."));
    }
  };

  const allergiesText = useWatch({
    control: form.control,
    name: "allergiesText",
  });
  const conditionsText = useWatch({
    control: form.control,
    name: "conditionsText",
  });

  const allergiesList = parseCommaList(allergiesText);
  const conditionsList = parseCommaList(conditionsText);

  return (
    <div className="flex flex-col gap-6">
      {/* Title Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950">
            Family &amp; Health Profiles
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Keep allergies, medications, and family dependents (children or
            senior parents) up to date—isolated per clinic for your privacy.
          </p>
        </div>

        <button
          type="button"
          disabled={data.featuredClinics.length === 0}
          onClick={() => {
            setEditingProfile(null);
            onCreateDialogOpenChange(true);
          }}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6] disabled:opacity-50 cursor-pointer"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Add Self / Dependent</span>
        </button>
      </div>

      {/* Profiles Grid or Guided Empty State */}
      {data.profiles.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200/80 bg-white px-6 py-12 text-center">
          <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-[#EEF7FD] text-[#6C5CE7]">
            <Users className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-lg font-bold text-slate-950">
            No saved clinic profiles yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
            Pre-register yourself or a family dependent now, or your profile
            will automatically save during Step 3 of your first online booking.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {data.featuredClinics.length > 0 ? (
              <button
                type="button"
                onClick={() => onCreateDialogOpenChange(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7] cursor-pointer"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>Create Intake Profile</span>
              </button>
            ) : null}
            <Link
              href="/clinics"
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-5 text-sm font-semibold text-slate-800 hover:bg-[#EAF1F8]"
            >
              <span>Browse Clinics</span>
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.profiles.map((profile) => {
            const hasAlerts = hasCriticalMedicalFlags(profile);
            const mh = profile.medicalHistory;

            return (
              <article
                key={profile._id}
                className="flex flex-col justify-between rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#EEF7FD] font-heading text-sm font-bold text-[#4F3EC7]">
                        {profile.firstName.slice(0, 1).toUpperCase()}
                        {profile.lastName.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h2 className="font-heading text-base font-bold text-slate-950">
                            {profile.firstName} {profile.lastName}
                          </h2>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              profile.isDependent
                                ? "bg-[#EFEBFF] text-[#4F3EC7]"
                                : "bg-slate-100 text-slate-700"
                            )}
                          >
                            {profile.isDependent ? "Family Dependent" : "Primary"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {profile.clinicName} · DOB {profile.dateOfBirth}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEditingProfile(profile)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-[#EFEBFF] hover:text-[#4F3EC7] cursor-pointer"
                    >
                      <Pencil className="size-3" aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  </div>

                  {/* Contact & Emergency Summary */}
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3.5 text-slate-400" aria-hidden="true" />
                      {profile.phone}
                    </span>
                    {profile.emergencyContactName ? (
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3.5 text-slate-400" aria-hidden="true" />
                        Emergency: {profile.emergencyContactName}
                        {profile.emergencyContactPhone
                          ? ` (${profile.emergencyContactPhone})`
                          : ""}
                      </span>
                    ) : null}
                  </div>

                  {/* Medical Alert Flags */}
                  <div
                    className={cn(
                      "mt-4 rounded-2xl p-3.5 text-xs",
                      hasAlerts
                        ? "border border-rose-200/90 bg-rose-50/75"
                        : "bg-[#F7FAFD]"
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {hasAlerts ? (
                        <>
                          <AlertTriangle
                            className="size-3.5 text-rose-600"
                            aria-hidden="true"
                          />
                          <span className="text-rose-800">
                            Chairside Medical Alerts
                          </span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck
                            className="size-3.5 text-emerald-600"
                            aria-hidden="true"
                          />
                          <span className="text-slate-900">
                            Medical Intake Summary
                          </span>
                        </>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {mh.allergies.length > 0 ? (
                        mh.allergies.map((allergy) => (
                          <span
                            key={allergy}
                            className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white"
                          >
                            Allergy: {allergy}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                          No known allergies
                        </span>
                      )}

                      {mh.isTakingBloodThinners ? (
                        <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                          Blood Thinners
                        </span>
                      ) : null}

                      {mh.isPregnant ? (
                        <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                          Pregnant
                        </span>
                      ) : null}

                      {mh.conditions.map((cond) => (
                        <span
                          key={cond}
                          className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-800 border border-slate-200/80"
                        >
                          {cond}
                        </span>
                      ))}

                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize",
                          mh.dentalAnxietyLevel === "severe"
                            ? "bg-rose-600 font-semibold text-white"
                            : "bg-white text-slate-700 border border-slate-200/80"
                        )}
                      >
                        Anxiety: {mh.dentalAnxietyLevel}
                      </span>
                    </div>

                    {mh.notes ? (
                      <p className="mt-2 text-xs text-slate-700">{mh.notes}</p>
                    ) : null}
                  </div>
                </div>

                {/* Footer Quick Book */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <HeartPulse className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                    {profile.nextRecallDate
                      ? `Recall due ${profile.nextRecallDate}`
                      : "Synced with clinic chart"}
                  </span>
                  {profile.clinicSlug ? (
                    <Link
                      href={`/c/${profile.clinicSlug}`}
                      className="inline-flex items-center gap-1 font-semibold text-[#5B4BD6] hover:text-[#4332B8]"
                    >
                      <span>Book for {profile.firstName}</span>
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Profile & Medical Intake Modal */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-bold">
              {isEditing
                ? `Update ${editingProfile.firstName}'s Health Profile`
                : "Add Self or Family Dependent Profile"}
            </DialogTitle>
            <DialogDescription>
              Saved intake details automatically pre-fill during online booking
              and alert your dentist chairside before procedures.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-1"
          >
            {!isEditing ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Profile Type
                  </label>
                  <select
                    {...form.register("profileKind")}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                  >
                    <option value="self">Myself (Primary Patient)</option>
                    <option value="dependent">
                      Family Dependent (Child / Senior Parent)
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Dental Clinic
                  </label>
                  <select
                    {...form.register("clinicId")}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                  >
                    {data.featuredClinics.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.city})
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.clinicId ? (
                    <p className="text-xs text-rose-600">
                      {form.formState.errors.clinicId.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  First Name
                </label>
                <input
                  type="text"
                  {...form.register("firstName")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
                {form.formState.errors.firstName ? (
                  <p className="text-xs text-rose-600">
                    {form.formState.errors.firstName.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Last Name
                </label>
                <input
                  type="text"
                  {...form.register("lastName")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
                {form.formState.errors.lastName ? (
                  <p className="text-xs text-rose-600">
                    {form.formState.errors.lastName.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Date of Birth
                </label>
                <input
                  type="date"
                  {...form.register("dateOfBirth")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Sex
                </label>
                <select
                  {...form.register("sex")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Prefer not to say</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  placeholder="0917 000 0000"
                  {...form.register("phone")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
                {form.formState.errors.phone ? (
                  <p className="text-xs text-rose-600">
                    {form.formState.errors.phone.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Emergency Contact Name
                </label>
                <input
                  type="text"
                  placeholder="Optional"
                  {...form.register("emergencyContactName")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Emergency Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="Optional"
                  {...form.register("emergencyContactPhone")}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Structured Dental & Medical Intake */}
            <div className="space-y-3 rounded-2xl bg-[#F7FAFD] p-4">
              <p className="font-heading text-sm font-bold text-slate-950">
                Dental &amp; Medical Intake Flags
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Allergies (comma-separated or tap common triggers)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_ALLERGIES.map((chip) => {
                    const active = allergiesList.some(
                      (a) => a.toLowerCase() === chip.toLowerCase()
                    );
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => toggleChipInField("allergiesText", chip)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                          active
                            ? "bg-rose-600 text-white"
                            : "bg-white text-slate-700 border border-slate-200 hover:border-rose-300"
                        )}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="e.g., Lidocaine, Penicillin"
                  {...form.register("allergiesText")}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#6C5CE7] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Medical Conditions
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_CONDITIONS.map((chip) => {
                    const active = conditionsList.some(
                      (c) => c.toLowerCase() === chip.toLowerCase()
                    );
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() =>
                          toggleChipInField("conditionsText", chip)
                        }
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                          active
                            ? "bg-[#6C5CE7] text-white"
                            : "bg-white text-slate-700 border border-slate-200 hover:border-[#6C5CE7]/40"
                        )}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="e.g., Hypertension, Diabetes"
                  {...form.register("conditionsText")}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#6C5CE7] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-medium text-slate-800 border border-slate-200/80 cursor-pointer">
                  <input
                    type="checkbox"
                    {...form.register("isTakingBloodThinners")}
                    className="size-4 accent-[#6C5CE7]"
                  />
                  <span>Taking Blood Thinners</span>
                </label>

                <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-medium text-slate-800 border border-slate-200/80 cursor-pointer">
                  <input
                    type="checkbox"
                    {...form.register("isPregnant")}
                    className="size-4 accent-[#6C5CE7]"
                  />
                  <span>Currently Pregnant</span>
                </label>

                <div className="space-y-1">
                  <select
                    {...form.register("dentalAnxietyLevel")}
                    aria-label="Dental anxiety level"
                    className="h-full min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 focus:border-[#6C5CE7] focus:outline-none"
                  >
                    <option value="none">Anxiety: None</option>
                    <option value="mild">Anxiety: Mild</option>
                    <option value="moderate">Anxiety: Moderate</option>
                    <option value="severe">Anxiety: Severe</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Additional Clinical Notes (optional)
                </label>
                <input
                  type="text"
                  placeholder="Sensitivities, preferred hand signals, or medications…"
                  {...form.register("notes")}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#6C5CE7] focus:outline-none"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <button
                type="button"
                onClick={closeDialog}
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#F5F7FA] px-5 text-sm font-semibold text-slate-800 hover:bg-[#EAF1F8] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#6C5CE7] px-6 text-sm font-semibold text-white hover:bg-[#5B4BD6] disabled:opacity-50 cursor-pointer"
              >
                {form.formState.isSubmitting
                  ? "Saving…"
                  : isEditing
                    ? "Save Changes"
                    : "Save Profile"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
