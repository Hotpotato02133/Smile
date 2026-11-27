"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  Copy,
  MailPlus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatDateTime,
  getErrorCode,
  getErrorMessage,
} from "@/lib/format";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(["receptionist", "dentist", "clinic_admin"]),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

function EmailDeliveryBadge({
  status,
  error,
}: {
  status?: "queued" | "sent" | "failed" | "skipped";
  error?: string;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-[11px]">
        Pending
      </Badge>
    );
  }
  const styles: Record<typeof status, string> = {
    sent: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    queued:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
    skipped:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    failed:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300",
  };
  return (
    <div className="space-y-0.5">
      <Badge variant="outline" className={`capitalize text-[11px] ${styles[status]}`}>
        {status}
      </Badge>
      {error ? (
        <p className="max-w-[200px] truncate text-[11px] text-muted-foreground" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StaffManager() {
  const { overrideClinicId, isReadOnly, buildHref } = useClinicAdminContext();
  const data = useQuery(api.clinicAdmin.listStaff, { overrideClinicId });

  const inviteStaff = useMutation(api.clinicAdmin.inviteStaff);
  const resendInvitation = useMutation(api.clinicAdmin.resendStaffInvitation);
  const revokeInvitation = useMutation(api.clinicAdmin.revokeStaffInvitation);
  const toggleStaffActive = useMutation(api.clinicAdmin.toggleStaffActive);

  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    const id = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: "receptionist",
    },
  });

  const watchedRole = useWatch({ control: form.control, name: "role" });

  const onSubmit = async (values: InviteFormValues) => {
    try {
      await inviteStaff(values);
      setQuotaBanner(null);
      toast.success(
        `Invited ${values.email} as ${values.role.replace("_", " ")}. Invitation email queued.`
      );
      form.reset({ email: "", role: values.role });
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to send staff invitation.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBanner(msg);
      }
      toast.error(msg);
    }
  };

  const handleCopyInviteLink = async (token?: string) => {
    if (!token) {
      toast.error("Resend this invitation to generate a shareable invite link.");
      return;
    }
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied to clipboard.");
    } catch {
      toast.error("Could not copy link. Copy manually from browser.");
    }
  };

  const handleResend = async (invitationId: Id<"staffInvitations">) => {
    try {
      await resendInvitation({ invitationId });
      toast.success("Invitation email re-queued and expiry extended by 7 days.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not resend invitation."));
    }
  };

  const handleRevoke = async (invitationId: Id<"staffInvitations">) => {
    try {
      await revokeInvitation({ invitationId });
      toast.success("Invitation revoked.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not revoke invitation."));
    }
  };

  const handleToggleStaff = async (userId: Id<"users">, isActive: boolean) => {
    try {
      const res = await toggleStaffActive({ userId, isActive });
      if (!isActive && res.deactivatedDentistProfile) {
        toast.success(
          "Staff account and linked dentist scheduling profile deactivated."
        );
      } else {
        toast.success(
          isActive ? "Staff member reactivated." : "Staff member deactivated."
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update staff status."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Staff &amp; Invitations
        </h1>
        <p className="text-sm text-muted-foreground">
          Invite receptionists, dentists, and clinic admins. Invited team
          members receive a branded Resend email and are automatically assigned
          their role and clinic when signing up via Clerk or clicking their
          invite link.
        </p>
      </div>

      {quotaBanner ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Plan Dentist Quota Reached</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{quotaBanner}</span>
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

      {/* Invite Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite Clinic Team Member</CardTitle>
          <CardDescription>
            Invitations remain valid for 7 days and link automatically on first
            Clerk sign-up or via the emailed invite link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email Address</Label>
              <Input
                id="staff-email"
                type="email"
                disabled={isReadOnly}
                placeholder="frontdesk@yourclinic.ph"
                {...form.register("email")}
              />
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                disabled={isReadOnly}
                value={watchedRole}
                onValueChange={(v) => {
                  if (
                    v === "receptionist" ||
                    v === "dentist" ||
                    v === "clinic_admin"
                  ) {
                    form.setValue("role", v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receptionist">Receptionist</SelectItem>
                  <SelectItem value="dentist">Dentist</SelectItem>
                  <SelectItem value="clinic_admin">Clinic Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              disabled={isReadOnly || form.formState.isSubmitting}
            >
              <MailPlus className="mr-1.5 size-4" />
              {form.formState.isSubmitting ? "Inviting…" : "Send Invite"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Active Team Roster */}
      <Card>
        <CardHeader>
          <CardTitle>Clinic Team Roster</CardTitle>
          <CardDescription>
            Active and deactivated staff accounts linked to this clinic.
            Deactivating a dentist also pauses their online booking profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data === undefined ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading staff…
            </p>
          ) : data.staff.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No staff accounts linked yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.staff.map((member) => {
                  const isSelf = member._id === data.currentUserId;
                  return (
                    <TableRow
                      key={member._id}
                      className={member.isActive ? undefined : "opacity-65"}
                    >
                      <TableCell className="font-medium">
                        <span>
                          {`${member.firstName} ${member.lastName}`.trim() ||
                            "—"}
                        </span>
                        {isSelf ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            You
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {member.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {member.role.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(member.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          disabled={isReadOnly || isSelf}
                          checked={member.isActive}
                          onCheckedChange={(checked) =>
                            handleToggleStaff(member._id, checked)
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>
            Waiting for invited team members to complete Clerk sign-up or accept
            their link. Copy the link directly if email delivery is skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data === undefined ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading invitations…
            </p>
          ) : data.pendingInvitations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pendingInvitations.map((inv) => {
                    const isExpired = nowMs > 0 && inv.expiresAt < nowMs;
                    return (
                      <TableRow key={inv._id}>
                        <TableCell className="font-medium">
                          {inv.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {inv.role.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <EmailDeliveryBadge
                            status={inv.emailStatus}
                            error={inv.emailError}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(inv.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <span>{formatDate(inv.expiresAt)}</span>
                            {isExpired ? (
                              <Badge variant="destructive" className="text-[10px]">
                                Expired
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleCopyInviteLink(inv.token)}
                            >
                              <Copy className="mr-1 size-3.5" />
                              Copy Link
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={isReadOnly}
                              onClick={() => handleResend(inv._id)}
                            >
                              <RefreshCw className="mr-1 size-3.5" />
                              Resend
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              disabled={isReadOnly}
                              onClick={() => handleRevoke(inv._id)}
                            >
                              <XCircle className="mr-1 size-3.5" />
                              Revoke
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recently Declined Invitations */}
      {data && data.declinedInvitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Declined Invitations</CardTitle>
            <CardDescription>
              Recent team invitations declined by their recipients.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Responded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.declinedInvitations.map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {inv.role.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inv.declineReason || "No reason provided"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inv.respondedAt ? formatDateTime(inv.respondedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
