"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  CalendarOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import { Switch } from "@/components/ui/switch";
import {
  DAY_SHORT_NAMES,
  formatDateTime,
  formatMinutes12h,
  getErrorCode,
  getErrorMessage,
  localDateTimeToUtc,
  minutesToTimeInput,
  timeInputToMinutes,
} from "@/lib/format";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

type WeeklyScheduleDay = {
  dayOfWeek: number;
  isWorking: boolean;
  startMinute: number;
  endMinute: number;
  breakStartMinute?: number;
  breakEndMinute?: number;
};

const DEFAULT_WEEKLY_SCHEDULE: WeeklyScheduleDay[] = [0, 1, 2, 3, 4, 5, 6].map(
  (dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek !== 0,
    startMinute: 540, // 09:00
    endMinute: 1020, // 17:00
    breakStartMinute: 720, // 12:00
    breakEndMinute: 780, // 13:00
  })
);

const COLOR_SWATCHES = [
  "#0284c7",
  "#0d9488",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
] as const;

const dentistFormSchema = z.object({
  displayName: z.string().min(2, "Display name is required"),
  licenseNumber: z.string().min(2, "License number is required"),
  specialtiesCsv: z.string().min(2, "List at least one specialty"),
  bio: z.string().optional(),
  calendarColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a valid hex color"),
  defaultChairId: z.string().optional(),
  accountMode: z.enum(["invite", "existing"]),
  userId: z.string().optional(),
  inviteEmail: z.string().optional(),
});

type DentistFormValues = z.infer<typeof dentistFormSchema>;

export function DentistsManager() {
  const { overrideClinicId, isReadOnly, buildHref } = useClinicAdminContext();
  const workspace = useQuery(api.clinicAdmin.getClinicWorkspace, {
    overrideClinicId,
  });
  const data = useQuery(api.clinicAdmin.listDentists, { overrideClinicId });

  const createDentist = useMutation(api.clinicAdmin.createDentist);
  const updateDentist = useMutation(api.clinicAdmin.updateDentist);
  const toggleDentistActive = useMutation(api.clinicAdmin.toggleDentistActive);
  const addDentistTimeOff = useMutation(api.clinicAdmin.addDentistTimeOff);
  const deleteDentistTimeOff = useMutation(
    api.clinicAdmin.deleteDentistTimeOff
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDentistId, setEditingDentistId] =
    useState<Id<"dentists"> | null>(null);
  const [schedule, setSchedule] = useState<WeeklyScheduleDay[]>(
    DEFAULT_WEEKLY_SCHEDULE
  );
  const [quotaBannerMessage, setQuotaBannerMessage] = useState<string | null>(
    null
  );

  // Time-off dialog state
  const [timeOffDentist, setTimeOffDentist] = useState<{
    id: Id<"dentists">;
    name: string;
  } | null>(null);
  const [timeOffStart, setTimeOffStart] = useState("");
  const [timeOffEnd, setTimeOffEnd] = useState("");
  const [timeOffReason, setTimeOffReason] = useState("");
  const [savingTimeOff, setSavingTimeOff] = useState(false);

  const form = useForm<DentistFormValues>({
    resolver: zodResolver(dentistFormSchema),
    defaultValues: {
      displayName: "",
      licenseNumber: "",
      specialtiesCsv: "General Dentistry",
      bio: "",
      calendarColorHex: "#0284c7",
      defaultChairId: "none",
      accountMode: "invite",
      userId: "",
      inviteEmail: "",
    },
  });

  const watchedAccountMode = useWatch({
    control: form.control,
    name: "accountMode",
  });
  const watchedUserId = useWatch({ control: form.control, name: "userId" });
  const watchedDefaultChair = useWatch({
    control: form.control,
    name: "defaultChairId",
  });
  const watchedColor = useWatch({
    control: form.control,
    name: "calendarColorHex",
  });

  const openCreate = () => {
    setEditingDentistId(null);
    setSchedule(DEFAULT_WEEKLY_SCHEDULE.map((d) => ({ ...d })));
    const firstAvailableUser = data?.availableUsers[0]?._id ?? "";
    form.reset({
      displayName: "",
      licenseNumber: "",
      specialtiesCsv: "General Dentistry",
      bio: "",
      calendarColorHex:
        COLOR_SWATCHES[(data?.dentists.length ?? 0) % COLOR_SWATCHES.length],
      defaultChairId: data?.chairs[0]?._id ?? "none",
      accountMode: firstAvailableUser ? "existing" : "invite",
      userId: firstAvailableUser,
      inviteEmail: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (dentist: NonNullable<typeof data>["dentists"][number]) => {
    setEditingDentistId(dentist._id);
    setSchedule(
      dentist.weeklySchedule.length === 7
        ? dentist.weeklySchedule.map((d) => ({ ...d }))
        : DEFAULT_WEEKLY_SCHEDULE.map((d) => ({ ...d }))
    );
    form.reset({
      displayName: dentist.displayName,
      licenseNumber: dentist.licenseNumber,
      specialtiesCsv: dentist.specialties.join(", "),
      bio: dentist.bio ?? "",
      calendarColorHex: dentist.calendarColorHex,
      defaultChairId: dentist.defaultChairId ?? "none",
      accountMode: "existing",
      userId: dentist.userId,
      inviteEmail: dentist.userEmail,
    });
    setDialogOpen(true);
  };

  const updateScheduleDay = (
    dayOfWeek: number,
    patch: Partial<WeeklyScheduleDay>
  ) => {
    setSchedule((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const onSubmit = async (values: DentistFormValues) => {
    const specialties = values.specialtiesCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const defaultChairId =
      values.defaultChairId && values.defaultChairId !== "none"
        ? (values.defaultChairId as Id<"chairs">)
        : undefined;

    try {
      if (editingDentistId) {
        await updateDentist({
          dentistId: editingDentistId,
          displayName: values.displayName,
          licenseNumber: values.licenseNumber,
          specialties,
          bio: values.bio || undefined,
          calendarColorHex: values.calendarColorHex,
          defaultChairId,
          weeklySchedule: schedule,
        });
        toast.success(`Updated ${values.displayName}.`);
      } else {
        await createDentist({
          displayName: values.displayName,
          userId:
            values.accountMode === "existing" && values.userId
              ? (values.userId as Id<"users">)
              : undefined,
          inviteEmail:
            values.accountMode === "invite" ? values.inviteEmail : undefined,
          licenseNumber: values.licenseNumber,
          specialties,
          bio: values.bio || undefined,
          calendarColorHex: values.calendarColorHex,
          defaultChairId,
          weeklySchedule: schedule,
        });
        setQuotaBannerMessage(null);
        toast.success(`Added ${values.displayName} to your clinic roster.`);
      }
      setDialogOpen(false);
    } catch (err) {
      const code = getErrorCode(err);
      const msg = getErrorMessage(err, "Failed to save dentist profile.");
      if (code === "QUOTA_EXCEEDED") {
        setQuotaBannerMessage(msg);
      }
      toast.error(msg);
    }
  };

  const handleToggleActive = async (
    dentistId: Id<"dentists">,
    isActive: boolean
  ) => {
    try {
      await toggleDentistActive({ dentistId, isActive });
      setQuotaBannerMessage(null);
      toast.success(isActive ? "Dentist activated." : "Dentist deactivated.");
    } catch (err) {
      const msg = getErrorMessage(err, "Could not update dentist status.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBannerMessage(msg);
      }
      toast.error(msg);
    }
  };

  const handleAddTimeOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timeOffDentist || !timeOffStart || !timeOffEnd) return;
    const clinicTz = workspace?.clinic.timezone || "Asia/Manila";
    const [startDatePart, startTimePart] = timeOffStart.split("T");
    const [endDatePart, endTimePart] = timeOffEnd.split("T");
    const startTimeUtc =
      startDatePart && startTimePart
        ? localDateTimeToUtc(startDatePart, startTimePart, clinicTz)
        : Date.parse(timeOffStart);
    const endTimeUtc =
      endDatePart && endTimePart
        ? localDateTimeToUtc(endDatePart, endTimePart, clinicTz)
        : Date.parse(timeOffEnd);

    if (Number.isNaN(startTimeUtc) || Number.isNaN(endTimeUtc)) {
      toast.error("Enter valid start and end dates.");
      return;
    }

    setSavingTimeOff(true);
    try {
      const res = await addDentistTimeOff({
        dentistId: timeOffDentist.id,
        startTimeUtc,
        endTimeUtc,
        reason: timeOffReason || "Scheduled leave",
      });
      if (res.overlappingCount > 0) {
        toast.warning(
          `Time-off saved, but ${res.overlappingCount} existing appointment(s) overlap this window and should be rescheduled.`
        );
      } else {
        toast.success("Time-off block added.");
      }
      setTimeOffDentist(null);
      setTimeOffStart("");
      setTimeOffEnd("");
      setTimeOffReason("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not add time off."));
    } finally {
      setSavingTimeOff(false);
    }
  };

  const handleDeleteTimeOff = async (timeOffId: Id<"dentistTimeOff">) => {
    try {
      await deleteDentistTimeOff({ timeOffId });
      toast.success("Time-off block removed.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not delete time off."));
    }
  };

  const maxDentists = workspace?.plan?.maxDentists ?? 0;
  const activeDentistCount = workspace?.clinic.activeDentistCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Dentists & Weekly Shifts
            </h1>
            {workspace?.plan ? (
              <Badge variant="outline" className="font-mono">
                {activeDentistCount}/{maxDentists} active ({workspace.plan.name})
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Manage doctor profiles, PRC licenses, default operatory chairs,
            working shifts, lunch breaks, and planned time off.
          </p>
        </div>

        <Button disabled={isReadOnly} onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          Add Dentist
        </Button>
      </div>

      {quotaBannerMessage ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Plan Dentist Quota Reached</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {quotaBannerMessage} Contact your platform administrator to
              upgrade to a higher tier (e.g., Smile Pro Clinic supports up to 8
              dentists).
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              render={<Link href={buildHref("/admin/billing")} />}
            >
              View Plan &amp; Billing
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading dentists…</p>
      ) : data.dentists.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No dentists configured yet. Add your first dentist and weekly shift
            schedule to enable online slot calculation.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.dentists.map((dentist) => {
            const workingDays = dentist.weeklySchedule.filter(
              (d) => d.isWorking
            );
            return (
              <Card
                key={dentist._id}
                className={dentist.isActive ? undefined : "opacity-65"}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: dentist.calendarColorHex }}
                      />
                      <CardTitle className="text-base">
                        {dentist.displayName}
                      </CardTitle>
                      {dentist.isPendingAccount ? (
                        <Badge variant="outline" className="text-[11px]">
                          Invite Pending
                        </Badge>
                      ) : null}
                    </div>
                    <CardDescription>
                      PRC #{dentist.licenseNumber}
                      {dentist.userEmail ? ` · ${dentist.userEmail}` : ""}
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      disabled={isReadOnly}
                      checked={dentist.isActive}
                      onCheckedChange={(checked) =>
                        handleToggleActive(dentist._id, checked)
                      }
                    />
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {dentist.bio ? (
                    <p className="text-xs text-muted-foreground">
                      {dentist.bio}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {dentist.specialties.map((sp) => (
                      <Badge key={sp} variant="secondary" className="text-xs">
                        {sp}
                      </Badge>
                    ))}
                    {dentist.defaultChairName ? (
                      <Badge variant="outline" className="text-xs">
                        Default: {dentist.defaultChairName}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Weekly Shift Schedule ({workingDays.length} working days)
                    </p>
                    <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                      {dentist.weeklySchedule.map((day) => (
                        <div
                          key={day.dayOfWeek}
                          className={`rounded px-1 py-1.5 ${
                            day.isWorking
                              ? "bg-background font-medium text-foreground ring-1 ring-border"
                              : "text-muted-foreground/50"
                          }`}
                        >
                          <div>{DAY_SHORT_NAMES[day.dayOfWeek]}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {day.isWorking
                              ? formatMinutes12h(day.startMinute).replace(
                                  ":00 ",
                                  ""
                                )
                              : "Off"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {dentist.timeOff.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Upcoming Time Off
                      </p>
                      {dentist.timeOff.map((block) => (
                        <div
                          key={block._id}
                          className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs"
                        >
                          <div>
                            <span className="font-medium">{block.reason}</span>
                            <span className="ml-2 text-muted-foreground">
                              {formatDateTime(block.startTimeUtc)} –{" "}
                              {formatDateTime(block.endTimeUtc)}
                            </span>
                          </div>
                          {!isReadOnly ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remove time off"
                              onClick={() => handleDeleteTimeOff(block._id)}
                            >
                              <Trash2 className="size-3.5 text-muted-foreground" />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isReadOnly}
                      onClick={() => openEdit(dentist)}
                    >
                      <Pencil className="mr-1.5 size-3.5" />
                      Edit Profile & Shifts
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isReadOnly}
                      onClick={() =>
                        setTimeOffDentist({
                          id: dentist._id,
                          name: dentist.displayName,
                        })
                      }
                    >
                      <CalendarOff className="mr-1.5 size-3.5" />
                      Block Time Off
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Dentist Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingDentistId
                ? "Edit Dentist & Weekly Schedule"
                : "Add Dentist Profile"}
            </DialogTitle>
            <DialogDescription>
              Assign shifts, lunch breaks, calendar color, and preferred
              operatory chair.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!editingDentistId ? (
              <div className="space-y-3 rounded-lg border bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold">
                    Account Linking
                  </Label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        watchedAccountMode === "invite" ? "default" : "outline"
                      }
                      className="h-7 text-xs"
                      onClick={() => form.setValue("accountMode", "invite")}
                    >
                      Invite by Email
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        watchedAccountMode === "existing"
                          ? "default"
                          : "outline"
                      }
                      className="h-7 text-xs"
                      disabled={(data?.availableUsers.length ?? 0) === 0}
                      onClick={() => form.setValue("accountMode", "existing")}
                    >
                      Existing Staff ({data?.availableUsers.length ?? 0})
                    </Button>
                  </div>
                </div>

                {watchedAccountMode === "existing" ? (
                  <Select
                    value={watchedUserId ?? ""}
                    onValueChange={(v) => {
                      if (v) form.setValue("userId", v);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose existing clinic user" />
                    </SelectTrigger>
                    <SelectContent>
                      {(data?.availableUsers ?? []).map((u) => (
                        <SelectItem key={u._id} value={u._id}>
                          {u.name} ({u.email} · {u.role.replace("_", " ")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="email"
                    placeholder="dr.santos@yourclinic.ph"
                    {...form.register("inviteEmail")}
                  />
                )}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dentist-name">Display Name</Label>
                <Input
                  id="dentist-name"
                  placeholder="Dr. Maria Santos, DMD"
                  {...form.register("displayName")}
                />
                {form.formState.errors.displayName ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.displayName.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dentist-prc">PRC License Number</Label>
                <Input
                  id="dentist-prc"
                  placeholder="0048291"
                  {...form.register("licenseNumber")}
                />
                {form.formState.errors.licenseNumber ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.licenseNumber.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dentist-spec">
                  Specialties (comma-separated)
                </Label>
                <Input
                  id="dentist-spec"
                  placeholder="General Dentistry, Orthodontics"
                  {...form.register("specialtiesCsv")}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Default Operatory Chair</Label>
                <Select
                  value={watchedDefaultChair ?? "none"}
                  onValueChange={(v) => form.setValue("defaultChairId", v ?? "none")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No default chair" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No preferred chair</SelectItem>
                    {(data?.chairs ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.name} ({c.roomCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dentist-bio">Short Bio (optional)</Label>
                <Input
                  id="dentist-bio"
                  placeholder="10+ years in gentle restorative care"
                  {...form.register("bio")}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Calendar Color</Label>
                <div className="flex items-center gap-2">
                  {COLOR_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => form.setValue("calendarColorHex", hex)}
                      className={`size-6 rounded-full border-2 ${
                        watchedColor === hex
                          ? "border-foreground scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Color ${hex}`}
                    />
                  ))}
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    {...form.register("calendarColorHex")}
                  />
                </div>
              </div>
            </div>

            {/* 7-Day Shift & Lunch Break Editor */}
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold">
                Weekly Shift Schedule & Lunch Breaks
              </p>
              <div className="space-y-2">
                {schedule.map((day) => (
                  <div
                    key={day.dayOfWeek}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs sm:grid-cols-[84px_1fr_1fr]"
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        checked={day.isWorking}
                        onCheckedChange={(checked) =>
                          updateScheduleDay(day.dayOfWeek, {
                            isWorking: checked,
                          })
                        }
                      />
                      <span className="font-medium">
                        {DAY_SHORT_NAMES[day.dayOfWeek]}
                      </span>
                    </div>

                    {day.isWorking ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Shift:</span>
                          <Input
                            type="time"
                            className="h-7 px-2 font-mono text-xs"
                            value={minutesToTimeInput(day.startMinute)}
                            onChange={(e) =>
                              updateScheduleDay(day.dayOfWeek, {
                                startMinute: timeInputToMinutes(
                                  e.target.value,
                                  day.startMinute
                                ),
                              })
                            }
                          />
                          <span>–</span>
                          <Input
                            type="time"
                            className="h-7 px-2 font-mono text-xs"
                            value={minutesToTimeInput(day.endMinute)}
                            onChange={(e) =>
                              updateScheduleDay(day.dayOfWeek, {
                                endMinute: timeInputToMinutes(
                                  e.target.value,
                                  day.endMinute
                                ),
                              })
                            }
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Switch
                            size="sm"
                            aria-label={`Lunch break on ${DAY_SHORT_NAMES[day.dayOfWeek]}`}
                            checked={
                              day.breakStartMinute !== undefined &&
                              day.breakEndMinute !== undefined
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                const defaultStart = Math.max(
                                  day.startMinute,
                                  Math.min(720, day.endMinute - 60)
                                );
                                const defaultEnd = Math.min(
                                  day.endMinute,
                                  defaultStart + 60
                                );
                                updateScheduleDay(day.dayOfWeek, {
                                  breakStartMinute: defaultStart,
                                  breakEndMinute:
                                    defaultEnd > defaultStart
                                      ? defaultEnd
                                      : day.endMinute,
                                });
                              } else {
                                updateScheduleDay(day.dayOfWeek, {
                                  breakStartMinute: undefined,
                                  breakEndMinute: undefined,
                                });
                              }
                            }}
                          />
                          <span className="text-muted-foreground">Break:</span>
                          {day.breakStartMinute !== undefined &&
                          day.breakEndMinute !== undefined ? (
                            <>
                              <Input
                                type="time"
                                className="h-7 w-24 px-1.5 font-mono text-xs"
                                value={minutesToTimeInput(day.breakStartMinute)}
                                onChange={(e) =>
                                  updateScheduleDay(day.dayOfWeek, {
                                    breakStartMinute: timeInputToMinutes(
                                      e.target.value,
                                      day.breakStartMinute ?? 720
                                    ),
                                  })
                                }
                              />
                              <span>–</span>
                              <Input
                                type="time"
                                className="h-7 w-24 px-1.5 font-mono text-xs"
                                value={minutesToTimeInput(day.breakEndMinute)}
                                onChange={(e) =>
                                  updateScheduleDay(day.dayOfWeek, {
                                    breakEndMinute: timeInputToMinutes(
                                      e.target.value,
                                      day.breakEndMinute ?? 780
                                    ),
                                  })
                                }
                              />
                            </>
                          ) : (
                            <span className="text-muted-foreground/70">
                              No break
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground sm:col-span-2">
                        Day off
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save Dentist"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Time-Off Dialog */}
      <Dialog
        open={timeOffDentist !== null}
        onOpenChange={(open) => !open && setTimeOffDentist(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block Time Off</DialogTitle>
            <DialogDescription>
              Schedule unavailable dates for {timeOffDentist?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddTimeOff} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="to-start">Start Date & Time</Label>
              <Input
                id="to-start"
                type="datetime-local"
                required
                value={timeOffStart}
                onChange={(e) => setTimeOffStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to-end">End Date & Time</Label>
              <Input
                id="to-end"
                type="datetime-local"
                required
                value={timeOffEnd}
                onChange={(e) => setTimeOffEnd(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to-reason">Reason</Label>
              <Input
                id="to-reason"
                placeholder="PDA Dental Convention / Leave"
                value={timeOffReason}
                onChange={(e) => setTimeOffReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTimeOffDentist(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingTimeOff}>
                {savingTimeOff ? "Blocking…" : "Add Time Off"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
