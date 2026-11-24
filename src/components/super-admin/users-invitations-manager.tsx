"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  Mail,
  MailCheck,
  MailWarning,
  Pencil,
  RefreshCw,
  Search,
  Shield,
  Stethoscope,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type AssignableRole = "super_admin" | "clinic_admin" | "dentist" | "receptionist";
type AllRole = AssignableRole | "patient";
type InviteStatusFilter = "all" | "pending" | "accepted" | "declined" | "revoked";

const ROLE_CARDS: {
  role: AssignableRole;
  label: string;
  description: string;
  icon: typeof Shield;
  needsClinic: boolean;
}[] = [
  {
    role: "clinic_admin",
    label: "Clinic Admin",
    description: "Manage dentists, chairs, services, staff & clinic reports",
    icon: Building2,
    needsClinic: true,
  },
  {
    role: "dentist",
    label: "Dentist",
    description: "Chair queue, 32-tooth SVG Odontogram & X-ray charts",
    icon: Stethoscope,
    needsClinic: true,
  },
  {
    role: "receptionist",
    label: "Receptionist",
    description: "Front-desk calendar, walk-ins & live Check-In Kanban",
    icon: UserCheck,
    needsClinic: true,
  },
  {
    role: "super_admin",
    label: "Super Admin",
    description: "Full SaaS platform control, billing ledger & all clinics",
    icon: Shield,
    needsClinic: false,
  },
];

const ROLE_BADGE_STYLE: Record<AllRole, { label: string; className: string }> = {
  super_admin: {
    label: "Super Admin",
    className: "border-[#6C5CE7]/25 bg-[#F1EEFF] text-[#4F3EC7]",
  },
  clinic_admin: {
    label: "Clinic Admin",
    className: "border-sky-200/80 bg-[#EEF7FD] text-sky-900",
  },
  dentist: {
    label: "Dentist",
    className: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
  },
  receptionist: {
    label: "Receptionist",
    className: "border-amber-200/80 bg-amber-50 text-amber-900",
  },
  patient: {
    label: "Patient",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
};

const INVITE_STATUS_STYLE: Record<
  "pending" | "accepted" | "declined" | "revoked" | "expired",
  { label: string; className: string; dotClass: string }
> = {
  pending: {
    label: "Pending",
    className: "border-amber-200/80 bg-amber-50 text-amber-900",
    dotClass: "bg-amber-500",
  },
  accepted: {
    label: "Accepted",
    className: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
    dotClass: "bg-emerald-500",
  },
  declined: {
    label: "Declined",
    className: "border-rose-200/80 bg-rose-50 text-rose-800",
    dotClass: "bg-rose-500",
  },
  revoked: {
    label: "Revoked",
    className: "border-slate-200 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
  },
  expired: {
    label: "Expired",
    className: "border-slate-200 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
  },
};

const inviteSchema = z
  .object({
    email: z.string().email("Enter a valid email address"),
    role: z.enum(["super_admin", "clinic_admin", "dentist", "receptionist"]),
    clinicId: z.string().optional(),
    inviterNote: z.string().max(400, "Keep note under 400 characters").optional(),
    expiresInDays: z.enum(["2", "7", "14"]),
  })
  .refine(
    (data) => data.role === "super_admin" || Boolean(data.clinicId?.trim()),
    {
      message: "Select a dental clinic for this role",
      path: ["clinicId"],
    }
  );

type InviteFormValues = z.infer<typeof inviteSchema>;

function RoleBadge({ role }: { role: AllRole }) {
  const cfg = ROLE_BADGE_STYLE[role];
  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </Badge>
  );
}

export function UsersInvitationsManager() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [lastCreatedLink, setLastCreatedLink] = useState<{
    email: string;
    role: AssignableRole;
    url: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters
  const [inviteStatusFilter, setInviteStatusFilter] =
    useState<InviteStatusFilter>("all");
  const [inviteSearch, setInviteSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | AllRole>("all");
  const [userSearch, setUserSearch] = useState("");
  const [nowMs, setNowMs] = useState<number>(0);

  // Edit User modal state
  const [editingUser, setEditingUser] = useState<{
    _id: Id<"users">;
    email: string;
    name: string;
    role: AllRole;
    clinicId: Id<"clinics"> | null;
    isActive: boolean;
    isRootOwner: boolean;
  } | null>(null);
  const [editRole, setEditRole] = useState<AllRole>("patient");
  const [editClinicId, setEditClinicId] = useState<string>("");
  const [editActive, setEditActive] = useState<boolean>(true);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const userData = useQuery(api.superAdmin.listAllUsers, {
    role: userRoleFilter === "all" ? undefined : userRoleFilter,
    search: userSearch.trim() || undefined,
  });
  const allUsersForLookup = useQuery(api.superAdmin.listAllUsers, {});
  const invitations = useQuery(api.superAdmin.listAllInvitations, {
    status: inviteStatusFilter === "all" ? undefined : inviteStatusFilter,
    search: inviteSearch.trim() || undefined,
  });
  const clinics = useQuery(api.superAdmin.listClinics, {});

  const createInvitation = useMutation(api.superAdmin.createRoleInvitation);
  const resendInvitation = useMutation(api.superAdmin.resendInvitation);
  const revokeInvitation = useMutation(api.superAdmin.revokeInvitation);
  const updateUser = useMutation(api.superAdmin.updateUserRoleOrStatus);

  const callerIsRootOwner = userData?.callerIsRootOwner ?? false;

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: "clinic_admin",
      clinicId: "",
      inviterNote: "",
      expiresInDays: "7",
    },
  });

  const watchedEmail = useWatch({ control: form.control, name: "email" });
  const watchedRole = useWatch({ control: form.control, name: "role" });
  const watchedClinicId = useWatch({ control: form.control, name: "clinicId" });
  const watchedExpiry = useWatch({
    control: form.control,
    name: "expiresInDays",
  });

  const existingEmailMatch = useMemo(() => {
    const clean = watchedEmail?.trim().toLowerCase();
    if (!clean || !allUsersForLookup) return null;
    return (
      allUsersForLookup.users.find((u) => u.email.toLowerCase() === clean) ??
      null
    );
  }, [watchedEmail, allUsersForLookup]);

  const buildInviteUrl = (token: string) => {
    if (typeof window === "undefined") return `/invite/${token}`;
    return `${window.location.origin}/invite/${token}`;
  };

  const copyLink = async (token: string, idKey: string) => {
    const url = buildInviteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(idKey);
      toast.success("Invitation link copied to clipboard.");
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === idKey ? null : curr));
      }, 2000);
    } catch {
      toast.error("Could not copy link automatically.");
    }
  };

  const openInviteModal = () => {
    setLastCreatedLink(null);
    form.reset({
      email: "",
      role: clinics && clinics.length > 0 ? "clinic_admin" : "super_admin",
      clinicId: clinics?.[0]?._id ?? "",
      inviterNote: "",
      expiresInDays: "7",
    });
    setInviteOpen(true);
  };

  const onSubmitInvite = async (values: InviteFormValues) => {
    try {
      const res = await createInvitation({
        email: values.email,
        role: values.role,
        clinicId:
          values.role === "super_admin"
            ? undefined
            : (values.clinicId as Id<"clinics">),
        inviterNote: values.inviterNote || undefined,
        expiresInDays: Number(values.expiresInDays),
      });

      const url = buildInviteUrl(res.token);
      setLastCreatedLink({
        email: values.email.trim().toLowerCase(),
        role: values.role,
        url,
      });
      toast.success(
        `Invitation queued for ${values.email} (${ROLE_BADGE_STYLE[values.role].label}).`
      );
      form.reset({
        email: "",
        role: values.role,
        clinicId: values.clinicId,
        inviterNote: "",
        expiresInDays: values.expiresInDays,
      });
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to send role invitation."));
    }
  };

  const handleResend = async (invitationId: Id<"staffInvitations">) => {
    try {
      await resendInvitation({ invitationId });
      toast.success("Invitation email re-queued and expiry extended 7 days.");
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

  const openEditUser = (u: NonNullable<typeof userData>["users"][number]) => {
    setEditingUser({
      _id: u._id,
      email: u.email,
      name: `${u.firstName} ${u.lastName}`.trim() || u.email,
      role: u.role,
      clinicId: u.clinicId,
      isActive: u.isActive,
      isRootOwner: u.isRootOwner,
    });
    setEditRole(u.role);
    setEditClinicId(u.clinicId ?? clinics?.[0]?._id ?? "");
    setEditActive(u.isActive);
  };

  const handleSaveUserEdit = async () => {
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      const needsClinic =
        editRole !== "super_admin" && editRole !== "patient";
      await updateUser({
        userId: editingUser._id,
        role: editRole,
        clinicId: needsClinic ? (editClinicId as Id<"clinics">) : null,
        isActive: editActive,
      });
      toast.success(`Updated role & status for ${editingUser.email}.`);
      setEditingUser(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update user account."));
    } finally {
      setSavingEdit(false);
    }
  };

  const allUsers = allUsersForLookup?.users ?? [];
  const superAdminCount = allUsers.filter((u) => u.role === "super_admin").length;
  const clinicAdminCount = allUsers.filter(
    (u) => u.role === "clinic_admin"
  ).length;
  const clinicalStaffCount = allUsers.filter(
    (u) => u.role === "dentist" || u.role === "receptionist"
  ).length;
  const pendingInvitesCount = (invitations ?? []).filter(
    (i) => i.status === "pending" && (nowMs === 0 || i.expiresAt >= nowMs)
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Users &amp; Role Invitations
          </h1>
          <p className="text-sm text-slate-600">
            Assign Super Admin, Clinic Admin, Dentist, or Receptionist roles by
            email with instant Gmail invitations and Accept/Decline tracking.
          </p>
        </div>
        <Button
          onClick={openInviteModal}
          className="h-9 w-fit rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <UserPlus className="mr-1.5 size-4" />
          Invite User
        </Button>
      </div>

      {/* Unified 4-Column KPI Strip */}
      <section className="grid grid-cols-2 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-[#F8FAFC] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="border-r border-slate-200/80 p-4 sm:border-r-0 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Super Admins</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-950">
            {superAdminCount}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Clinic Admins</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-950">
            {clinicAdminCount}
          </p>
        </div>
        <div className="border-r border-slate-200/80 p-4 sm:border-r-0 sm:p-5">
          <p className="text-xs font-medium text-slate-500">
            Dentists &amp; Desk
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-950">
            {clinicalStaffCount}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Pending Invites</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-950">
            {pendingInvitesCount}
          </p>
        </div>
      </section>

      <Tabs defaultValue="invitations">
        <TabsList className="rounded-full bg-[#F6F8FB] p-1">
          <TabsTrigger value="invitations" className="rounded-full px-4 text-xs">
            Role Invitations ({invitations?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="directory" className="rounded-full px-4 text-xs">
            Active Directory ({allUsers.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: INVITATIONS TRACKER */}
        <TabsContent value="invitations" className="mt-4">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {(
                  [
                    ["all", "All"],
                    ["pending", "Pending"],
                    ["accepted", "Accepted"],
                    ["declined", "Declined"],
                    ["revoked", "Revoked"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setInviteStatusFilter(key)}
                    className={cn(
                      "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      inviteStatusFilter === key
                        ? "bg-slate-950 text-white"
                        : "border border-slate-200/80 bg-[#F8FAFC] text-slate-600 hover:text-slate-950"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-72">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                <Input
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Search invited email…"
                  className="h-9 rounded-full border-slate-200 bg-[#F8FAFC] pl-9 text-xs"
                />
              </div>
            </div>

            <div className="mt-5">
              {invitations === undefined ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-xl bg-slate-100"
                    />
                  ))}
                </div>
              ) : invitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-12 text-center">
                  <Mail className="size-7 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    No role invitations found
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">
                    Click Invite User to email a Super Admin, Clinic Admin,
                    Dentist, or Receptionist with a one-click Accept/Decline
                    link.
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Recipient</TableHead>
                          <TableHead>Assigned Role</TableHead>
                          <TableHead>Workspace</TableHead>
                          <TableHead>Response</TableHead>
                          <TableHead>Email Delivery</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invitations.map((inv) => {
                          const isExpired =
                            inv.status === "pending" &&
                            nowMs > 0 &&
                            nowMs > inv.expiresAt;
                          const displayStatus = isExpired
                            ? "expired"
                            : inv.status;
                          const st = INVITE_STATUS_STYLE[displayStatus];

                          return (
                            <TableRow key={inv._id}>
                              <TableCell>
                                <div className="font-mono text-xs font-semibold text-slate-950">
                                  {inv.email}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Invited by {inv.inviterName} ·{" "}
                                  {formatDate(inv.createdAt)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <RoleBadge role={inv.role} />
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">
                                {inv.clinicName ? (
                                  <span className="inline-flex items-center gap-1.5 font-medium">
                                    <span
                                      className="size-2 rounded-full"
                                      style={{
                                        backgroundColor: inv.clinicColorHex,
                                      }}
                                    />
                                    {inv.clinicName}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">
                                    Smile Platform
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.className}`}
                                >
                                  <span
                                    className={`size-1.5 rounded-full ${st.dotClass}`}
                                  />
                                  {st.label}
                                </Badge>
                                {inv.declineReason ? (
                                  <p
                                    title={inv.declineReason}
                                    className="mt-1 max-w-[180px] truncate text-[11px] text-rose-700"
                                  >
                                    “{inv.declineReason}”
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                {inv.emailStatus === "sent" ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                    <MailCheck className="size-3.5" />
                                    Sent
                                  </span>
                                ) : inv.emailStatus === "queued" ? (
                                  <span className="text-xs text-slate-500">
                                    Sending…
                                  </span>
                                ) : inv.emailStatus === "failed" ? (
                                  <span
                                    title={inv.emailError ?? "Delivery failed"}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"
                                  >
                                    <MailWarning className="size-3.5" />
                                    Failed
                                  </span>
                                ) : (
                                  <span
                                    title={
                                      inv.emailError ??
                                      "Share invite link manually"
                                    }
                                    className="text-xs text-slate-500"
                                  >
                                    Link ready
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums text-slate-600">
                                {formatDate(inv.expiresAt)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {inv.token && inv.status === "pending" ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        copyLink(inv.token!, inv._id)
                                      }
                                      className="h-7 rounded-full px-2.5 text-xs"
                                    >
                                      {copiedId === inv._id ? (
                                        <Check className="mr-1 size-3 text-emerald-600" />
                                      ) : (
                                        <Copy className="mr-1 size-3" />
                                      )}
                                      {copiedId === inv._id ? "Copied" : "Link"}
                                    </Button>
                                  ) : null}
                                  {inv.status !== "accepted" ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleResend(inv._id)}
                                      className="h-7 rounded-full px-2.5 text-xs"
                                    >
                                      <RefreshCw className="mr-1 size-3" />
                                      Resend
                                    </Button>
                                  ) : null}
                                  {inv.status === "pending" ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRevoke(inv._id)}
                                      className="h-7 rounded-full px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile Invitation Cards */}
                  <div className="space-y-3 md:hidden">
                    {invitations.map((inv) => {
                      const isExpired =
                        inv.status === "pending" &&
                        nowMs > 0 &&
                        nowMs > inv.expiresAt;
                      const displayStatus = isExpired ? "expired" : inv.status;
                      const st = INVITE_STATUS_STYLE[displayStatus];

                      return (
                        <div
                          key={inv._id}
                          className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-4"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs font-semibold text-slate-950">
                                {inv.email}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {inv.clinicName ?? "Smile Platform"} · Expires{" "}
                                {formatDate(inv.expiresAt)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.className}`}
                            >
                              <span
                                className={`size-1.5 rounded-full ${st.dotClass}`}
                              />
                              {st.label}
                            </Badge>
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <RoleBadge role={inv.role} />
                            <span className="text-[11px] text-slate-500">
                              Email: {inv.emailStatus}
                            </span>
                          </div>

                          {inv.declineReason ? (
                            <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800">
                              Decline note: “{inv.declineReason}”
                            </p>
                          ) : null}

                          <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-200/70 pt-2.5">
                            {inv.token && inv.status === "pending" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyLink(inv.token!, inv._id)}
                                className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs"
                              >
                                <Copy className="mr-1 size-3" />
                                Copy Link
                              </Button>
                            ) : null}
                            {inv.status !== "accepted" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResend(inv._id)}
                                className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs"
                              >
                                Resend
                              </Button>
                            ) : null}
                            {inv.status === "pending" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRevoke(inv._id)}
                                className="h-7 rounded-full px-2.5 text-xs text-rose-700"
                              >
                                Revoke
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </section>
        </TabsContent>

        {/* TAB 2: ACTIVE USER DIRECTORY */}
        <TabsContent value="directory" className="mt-4">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {(
                  [
                    ["all", "All Roles"],
                    ["super_admin", "Super Admin"],
                    ["clinic_admin", "Clinic Admin"],
                    ["dentist", "Dentist"],
                    ["receptionist", "Receptionist"],
                    ["patient", "Patient"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setUserRoleFilter(key)}
                    className={cn(
                      "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      userRoleFilter === key
                        ? "bg-slate-950 text-white"
                        : "border border-slate-200/80 bg-[#F8FAFC] text-slate-600 hover:text-slate-950"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-72">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="h-9 rounded-full border-slate-200 bg-[#F8FAFC] pl-9 text-xs"
                />
              </div>
            </div>

            <div className="mt-5">
              {userData === undefined ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-xl bg-slate-100"
                    />
                  ))}
                </div>
              ) : userData.users.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] py-12 text-center">
                  <Users className="size-7 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    No user accounts match this filter
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>User</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Assigned Clinic</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Joined</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {userData.users.map((u) => (
                          <TableRow key={u._id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-950">
                                  {`${u.firstName} ${u.lastName}`.trim() ||
                                    "Smile User"}
                                </span>
                                {u.isRootOwner ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-700"
                                  >
                                    Root Owner
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="font-mono text-xs text-slate-500">
                                {u.email}
                              </div>
                            </TableCell>
                            <TableCell>
                              <RoleBadge role={u.role} />
                            </TableCell>
                            <TableCell className="text-xs text-slate-700">
                              {u.clinicName ?? (
                                <span className="text-slate-400">
                                  {u.role === "super_admin"
                                    ? "All clinics"
                                    : "Global patient"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  u.isActive
                                    ? "rounded-full border-emerald-200 bg-emerald-50 text-[11px] font-semibold text-emerald-800"
                                    : "rounded-full border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-800"
                                }
                              >
                                {u.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-slate-500">
                              {formatDateTime(u.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={u.isRootOwner}
                                onClick={() => openEditUser(u)}
                                className="h-7 rounded-full border-slate-200 px-3 text-xs font-semibold"
                              >
                                <Pencil className="mr-1 size-3" />
                                Edit Role
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile User Cards */}
                  <div className="space-y-3 md:hidden">
                    {userData.users.map((u) => (
                      <div
                        key={u._id}
                        className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {`${u.firstName} ${u.lastName}`.trim() ||
                                "Smile User"}
                            </p>
                            <p className="truncate font-mono text-xs text-slate-500">
                              {u.email}
                            </p>
                          </div>
                          <RoleBadge role={u.role} />
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs text-slate-500">
                            {u.clinicName ??
                              (u.role === "super_admin"
                                ? "All clinics"
                                : "Patient account")}
                          </span>
                          {!u.isRootOwner ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditUser(u)}
                              className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                            >
                              Edit Role
                            </Button>
                          ) : (
                            <span className="text-[11px] font-semibold text-slate-500">
                              Root Owner
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {/* INVITE USER MODAL (Visual 4-Role Selector) */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite User &amp; Assign Role</DialogTitle>
            <DialogDescription>
              Sends a Gmail-ready invitation with a secure Accept/Decline link.
              Once accepted, they sign in with this exact email to open their
              workspace.
            </DialogDescription>
          </DialogHeader>

          {lastCreatedLink ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
              <p className="font-semibold">
                Invitation sent to{" "}
                <span className="font-mono">{lastCreatedLink.email}</span> (
                {ROLE_BADGE_STYLE[lastCreatedLink.role].label})
              </p>
              <p className="mt-1 text-emerald-900/80">
                Email delivery is queued via Resend. You can also copy the
                direct invite link below:
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Input
                  readOnly
                  value={lastCreatedLink.url}
                  className="h-8 bg-white font-mono text-[11px]"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastCreatedLink.url);
                    toast.success("Direct invite link copied!");
                  }}
                  className="h-8 shrink-0 rounded-lg bg-emerald-800 px-3 text-xs text-white hover:bg-emerald-900"
                >
                  <Copy className="mr-1 size-3" />
                  Copy
                </Button>
              </div>
            </div>
          ) : null}

          <form
            onSubmit={form.handleSubmit(onSubmitInvite)}
            className="space-y-4"
          >
            {/* Step 1: Email */}
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Recipient Email (Gmail / Work)</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="dr.santos@gmail.com"
                {...form.register("email")}
              />
              {existingEmailMatch ? (
                <p className="rounded-xl border border-sky-200 bg-[#EEF7FD] px-3 py-1.5 text-xs text-sky-900">
                  Existing Smile account found (currently{" "}
                  <strong>
                    {ROLE_BADGE_STYLE[existingEmailMatch.role].label}
                  </strong>
                  ). Accepting will update their role immediately.
                </p>
              ) : null}
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            {/* Step 2: 2x2 Visual Role Selector */}
            <div className="space-y-1.5">
              <Label>Assign Role</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLE_CARDS.map((card) => {
                  const Icon = card.icon;
                  const selected = watchedRole === card.role;
                  const disabled =
                    card.role === "super_admin" && !callerIsRootOwner;
                  return (
                    <button
                      key={card.role}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        form.setValue("role", card.role, {
                          shouldValidate: true,
                        });
                        if (!card.needsClinic) {
                          form.setValue("clinicId", "");
                        } else if (!watchedClinicId && clinics?.[0]?._id) {
                          form.setValue("clinicId", clinics[0]._id);
                        }
                      }}
                      className={cn(
                        "flex flex-col items-start rounded-xl border p-3 text-left transition-colors cursor-pointer",
                        selected
                          ? "border-[#6C5CE7] bg-[#F1EEFF]/60 ring-1 ring-[#6C5CE7]"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                        disabled && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950">
                          <Icon
                            className={cn(
                              "size-3.5",
                              selected ? "text-[#6C5CE7]" : "text-slate-500"
                            )}
                          />
                          {card.label}
                        </span>
                        {selected ? (
                          <span className="flex size-4 items-center justify-center rounded-full bg-[#6C5CE7] text-white">
                            <Check className="size-2.5" />
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-slate-600">
                        {card.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Conditional Clinic Picker */}
            {watchedRole !== "super_admin" ? (
              <div className="space-y-1.5">
                <Label>Assign to Dental Clinic</Label>
                {clinics && clinics.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                    <p className="max-w-xs">
                      No dental clinics provisioned yet. Provision a clinic
                      first before inviting clinic staff.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href="/super-admin/clinics" />}
                      onClick={() => setInviteOpen(false)}
                      className="h-7 rounded-full border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                    >
                      Go to Clinics
                      <ArrowRight className="ml-1 size-3" />
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={watchedClinicId ?? ""}
                    onValueChange={(v) => {
                      if (v) form.setValue("clinicId", v, { shouldValidate: true });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose dental clinic" />
                    </SelectTrigger>
                    <SelectContent>
                      {(clinics ?? []).map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          {c.name} — {c.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {form.formState.errors.clinicId ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.clinicId.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-[#6C5CE7]/25 bg-[#F1EEFF]/50 px-3.5 py-2.5 text-xs text-[#4F3EC7]">
                <strong>Platform-Wide Privilege:</strong> Accepting this
                invitation grants full Super Admin access across all dental
                clinics and billing records.
              </div>
            )}

            {/* Step 4: Note & Expiry */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invite-note">Personal Note (optional)</Label>
                <Input
                  id="invite-note"
                  placeholder="Welcome aboard! Accept to access your schedule."
                  {...form.register("inviterNote")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Link Expires In</Label>
                <Select
                  value={watchedExpiry}
                  onValueChange={(v) => {
                    if (v === "2" || v === "7" || v === "14") {
                      form.setValue("expiresInDays", v);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">48 hours</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
              >
                Close
              </Button>
              <Button
                type="submit"
                disabled={
                  form.formState.isSubmitting ||
                  (watchedRole !== "super_admin" &&
                    (clinics?.length ?? 0) === 0)
                }
                className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
              >
                {form.formState.isSubmitting
                  ? "Sending Invitation…"
                  : "Send Email Invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT EXISTING USER ROLE / STATUS DIALOG */}
      <Dialog
        open={editingUser !== null}
        onOpenChange={(v) => !v && setEditingUser(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Account Role &amp; Access</DialogTitle>
            <DialogDescription>
              {editingUser?.name} ({editingUser?.email})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={editRole}
                onValueChange={(v) => {
                  if (v) setEditRole(v as AllRole);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {callerIsRootOwner ? (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  ) : null}
                  <SelectItem value="clinic_admin">Clinic Admin</SelectItem>
                  <SelectItem value="dentist">Dentist</SelectItem>
                  <SelectItem value="receptionist">Receptionist</SelectItem>
                  <SelectItem value="patient">Patient</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editRole !== "super_admin" && editRole !== "patient" ? (
              <div className="space-y-1.5">
                <Label>Assigned Clinic</Label>
                <Select
                  value={editClinicId}
                  onValueChange={(v) => {
                    if (v) setEditClinicId(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clinics ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.name} — {c.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3 text-xs">
              <div>
                <p className="font-semibold text-slate-900">Account Active</p>
                <p className="text-slate-500">
                  Deactivating blocks portal access while keeping clinical logs
                  intact.
                </p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingUser(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={savingEdit}
              onClick={handleSaveUserEdit}
              className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
            >
              {savingEdit ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
