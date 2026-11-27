"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type AnnouncementSeverity,
  SeverityBadge,
} from "@/components/super-admin/status-badges";
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
import { Switch } from "@/components/ui/switch";
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Doc, Id } from "@/lib/api";

const announcementSchema = z.object({
  title: z.string().min(3, "Title is required"),
  message: z.string().min(5, "Message is required"),
  severity: z.enum(["info", "warning", "critical"]),
  targetAudience: z.enum([
    "all_clinic_staff",
    "clinic_admins_only",
    "all_users",
  ]),
  expiresDate: z.string().optional(),
});

type AnnouncementFormValues = z.infer<typeof announcementSchema>;

const AUDIENCE_LABELS: Record<
  AnnouncementFormValues["targetAudience"],
  string
> = {
  all_clinic_staff: "All Clinic Staff",
  clinic_admins_only: "Clinic Admins Only",
  all_users: "All Users (Including Patients)",
};

type FilterTab = "all" | "active" | "paused" | "expired";

export function AnnouncementsManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"systemAnnouncements"> | null>(
    null
  );
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const announcements = useQuery(api.superAdmin.listAnnouncements, {});
  const createAnnouncement = useMutation(api.superAdmin.createAnnouncement);
  const updateAnnouncement = useMutation(api.superAdmin.updateAnnouncement);
  const toggleAnnouncement = useMutation(api.superAdmin.toggleAnnouncement);
  const deleteAnnouncement = useMutation(api.superAdmin.deleteAnnouncement);

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: "",
      message: "",
      severity: "info",
      targetAudience: "all_clinic_staff",
      expiresDate: "",
    },
  });

  const severity = useWatch({ control: form.control, name: "severity" });
  const targetAudience = useWatch({
    control: form.control,
    name: "targetAudience",
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      title: "",
      message: "",
      severity: "info",
      targetAudience: "all_clinic_staff",
      expiresDate: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (item: Doc<"systemAnnouncements">) => {
    setEditing(item);
    form.reset({
      title: item.title,
      message: item.message,
      severity: item.severity,
      targetAudience: item.targetAudience,
      expiresDate: item.expiresAt
        ? new Date(item.expiresAt).toISOString().slice(0, 10)
        : "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: AnnouncementFormValues) => {
    try {
      const expiresAt = values.expiresDate
        ? Date.parse(`${values.expiresDate}T23:59:59Z`)
        : undefined;

      if (editing) {
        await updateAnnouncement({
          announcementId: editing._id,
          title: values.title,
          message: values.message,
          severity: values.severity,
          targetAudience: values.targetAudience,
          expiresAt,
        });
        toast.success("Announcement updated.");
      } else {
        await createAnnouncement({
          title: values.title,
          message: values.message,
          severity: values.severity,
          targetAudience: values.targetAudience,
          expiresAt,
        });
        toast.success("Announcement published.");
      }
      form.reset();
      setDialogOpen(false);
      setEditing(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save announcement."));
    }
  };

  const handleToggle = async (
    announcementId: Id<"systemAnnouncements">,
    isActive: boolean
  ) => {
    try {
      await toggleAnnouncement({ announcementId, isActive });
      toast.success(
        isActive ? "Announcement activated." : "Announcement paused."
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not toggle announcement."));
    }
  };

  const handleDelete = async (announcementId: Id<"systemAnnouncements">) => {
    try {
      await deleteAnnouncement({ announcementId });
      toast.success("Announcement deleted.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not delete announcement."));
    }
  };

  const filtered = useMemo(() => {
    const list = announcements ?? [];
    return list.filter((item) => {
      const isExpired = Boolean(
        nowMs > 0 && item.expiresAt && item.expiresAt < nowMs
      );
      if (filterTab === "active") return item.isActive && !isExpired;
      if (filterTab === "paused") return !item.isActive;
      if (filterTab === "expired") return isExpired;
      return true;
    });
  }, [announcements, filterTab, nowMs]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            System Announcements
          </h1>
          <p className="text-sm text-slate-600">
            Broadcast maintenance windows, billing notices, or feature launches
            across Smile dashboards.
          </p>
        </div>

        <Button
          onClick={openCreate}
          className="h-9 w-fit rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <Plus className="mr-1.5 size-4" />
          New Announcement
        </Button>
      </div>

      {/* Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["paused", "Paused"],
            ["expired", "Expired"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterTab(key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              filterTab === key
                ? "bg-slate-950 text-white"
                : "border border-slate-200/80 bg-[#F8FAFC] text-slate-600 hover:text-slate-950"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {announcements === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-14 text-center">
          <Megaphone className="size-7 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-800">
            No announcements in this view
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Publish a system banner to notify clinic admins, staff, or patients
            in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpired = Boolean(
              nowMs > 0 && item.expiresAt && item.expiresAt < nowMs
            );
            return (
              <article
                key={item._id}
                className="rounded-2xl border border-slate-200/80 bg-white p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={item.severity} />
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-[#F8FAFC] text-[11px] font-medium text-slate-700"
                      >
                        {AUDIENCE_LABELS[item.targetAudience]}
                      </Badge>
                      {isExpired ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-100 text-[11px] text-slate-600"
                        >
                          Expired
                        </Badge>
                      ) : null}
                      <span className="text-xs text-slate-500">
                        Posted {formatDateTime(item.createdAt)}
                        {item.expiresAt
                          ? ` · Expires ${formatDate(item.expiresAt)}`
                          : ""}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-950">
                      {item.title}
                    </h2>
                    <p className="text-sm text-slate-600">{item.message}</p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-600">
                        {item.isActive ? "Active" : "Paused"}
                      </span>
                      <Switch
                        checked={item.isActive}
                        onCheckedChange={(checked) =>
                          handleToggle(item._id, checked)
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Edit announcement"
                        onClick={() => openEdit(item)}
                        className="size-8 rounded-full p-0 text-slate-600 hover:bg-slate-100"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Delete announcement"
                        onClick={() => handleDelete(item._id)}
                        className="size-8 rounded-full p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Announcement Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit System Announcement"
                : "Broadcast System Announcement"}
            </DialogTitle>
            <DialogDescription>
              Active banners display immediately across targeted Smile
              dashboards.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                placeholder="Scheduled Sunday Maintenance"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.title.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ann-msg">Message</Label>
              <textarea
                id="ann-msg"
                rows={3}
                className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Describe the update or action required…"
                {...form.register("message")}
              />
              {form.formState.errors.message ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.message.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select
                  value={severity}
                  onValueChange={(v) => {
                    if (v) form.setValue("severity", v as AnnouncementSeverity);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Audience</Label>
                <Select
                  value={targetAudience}
                  onValueChange={(v) => {
                    if (
                      v === "all_clinic_staff" ||
                      v === "clinic_admins_only" ||
                      v === "all_users"
                    ) {
                      form.setValue("targetAudience", v);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_clinic_staff">
                      All Clinic Staff
                    </SelectItem>
                    <SelectItem value="clinic_admins_only">
                      Clinic Admins Only
                    </SelectItem>
                    <SelectItem value="all_users">All Users</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ann-expires">Expiry Date (optional)</Label>
              <Input
                id="ann-expires"
                type="date"
                {...form.register("expiresDate")}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
              >
                {form.formState.isSubmitting
                  ? "Saving…"
                  : editing
                    ? "Save Changes"
                    : "Publish"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
