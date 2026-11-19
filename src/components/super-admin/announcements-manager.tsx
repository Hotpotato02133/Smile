"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { Megaphone, Plus } from "lucide-react";
import { useState } from "react";
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
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

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

export function AnnouncementsManager() {
  const [open, setOpen] = useState(false);
  const announcements = useQuery(api.superAdmin.listAnnouncements, {});
  const createAnnouncement = useMutation(api.superAdmin.createAnnouncement);
  const toggleAnnouncement = useMutation(api.superAdmin.toggleAnnouncement);

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

  const onSubmit = async (values: AnnouncementFormValues) => {
    try {
      const expiresAt = values.expiresDate
        ? Date.parse(`${values.expiresDate}T23:59:59Z`)
        : undefined;
      await createAnnouncement({
        title: values.title,
        message: values.message,
        severity: values.severity,
        targetAudience: values.targetAudience,
        expiresAt,
      });
      toast.success("Announcement published.");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not publish announcement."));
    }
  };

  const handleToggle = async (
    announcementId: Id<"systemAnnouncements">,
    isActive: boolean
  ) => {
    try {
      await toggleAnnouncement({ announcementId, isActive });
      toast.success(isActive ? "Announcement activated." : "Announcement paused.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not toggle announcement."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            System Announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Broadcast maintenance windows, billing notices, or feature launches
            across clinics.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-1.5 size-4" />
            New Announcement
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Broadcast System Announcement</DialogTitle>
              <DialogDescription>
                Published banners display immediately in targeted dashboards.
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
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Publishing…" : "Publish"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {announcements === undefined ? (
        <p className="text-sm text-muted-foreground">Loading announcements…</p>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Megaphone className="size-6 opacity-50" />
            <p>No system announcements created yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((item) => (
            <Card key={item._id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <Badge variant="outline">
                      {AUDIENCE_LABELS[item.targetAudience]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Posted {formatDateTime(item.createdAt)}
                      {item.expiresAt
                        ? ` · Expires ${formatDate(item.expiresAt)}`
                        : ""}
                    </span>
                  </div>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <CardDescription className="text-foreground/80">
                    {item.message}
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {item.isActive ? "Active" : "Paused"}
                  </span>
                  <Switch
                    checked={item.isActive}
                    onCheckedChange={(checked) =>
                      handleToggle(item._id, checked)
                    }
                  />
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
