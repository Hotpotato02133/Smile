"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { MailPlus, XCircle } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(["receptionist", "dentist", "clinic_admin"]),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

export function StaffManager() {
  const { overrideClinicId, isReadOnly } = useClinicAdminContext();
  const data = useQuery(api.clinicAdmin.listStaff, { overrideClinicId });

  const inviteStaff = useMutation(api.clinicAdmin.inviteStaff);
  const revokeInvitation = useMutation(api.clinicAdmin.revokeStaffInvitation);
  const toggleStaffActive = useMutation(api.clinicAdmin.toggleStaffActive);

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
      toast.success(
        `Invited ${values.email} as ${values.role.replace("_", " ")}.`
      );
      form.reset({ email: "", role: values.role });
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to send staff invitation."));
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
      await toggleStaffActive({ userId, isActive });
      toast.success(isActive ? "Staff member reactivated." : "Staff member deactivated.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update staff status."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Staff & Invitations
        </h1>
        <p className="text-sm text-muted-foreground">
          Invite receptionists, dentists, and clinic admins. Invited users are
          automatically assigned their role and clinic when they sign up via
          Clerk.
        </p>
      </div>

      {/* Invite Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite Clinic Team Member</CardTitle>
          <CardDescription>
            Invitations remain valid for 7 days and link automatically on first
            Clerk sign-up.
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
                {data.staff.map((member) => (
                  <TableRow key={member._id}>
                    <TableCell className="font-medium">
                      {`${member.firstName} ${member.lastName}`.trim() || "—"}
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
                        disabled={isReadOnly}
                        checked={member.isActive}
                        onCheckedChange={(checked) =>
                          handleToggleStaff(member._id, checked)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
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
            Waiting for the invited team member to complete Clerk sign-up.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Revoke</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingInvitations.map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {inv.role.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(inv.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(inv.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isReadOnly}
                        onClick={() => handleRevoke(inv._id)}
                      >
                        <XCircle className="mr-1 size-3.5" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
