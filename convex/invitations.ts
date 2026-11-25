import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { recordAuditLog } from "./lib/audit";

const DEFAULT_DENTIST_SCHEDULE = [
  { dayOfWeek: 0, isWorking: false, startMinute: 540, endMinute: 1020 },
  {
    dayOfWeek: 1,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 2,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 3,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 4,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 5,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 6,
    isWorking: true,
    startMinute: 540,
    endMinute: 900,
  },
];

const ROLE_HOME_PATH = {
  super_admin: "/super-admin",
  clinic_admin: "/admin",
  dentist: "/staff",
  receptionist: "/front-desk",
  patient: "/patient",
} as const;

type AcceptInvitationResult = {
  role: "super_admin" | "clinic_admin" | "dentist" | "receptionist";
  clinicId: Id<"clinics"> | null;
  homePath: (typeof ROLE_HOME_PATH)[keyof typeof ROLE_HOME_PATH];
  alreadyAccepted: boolean;
};

type ClerkUserLookup = {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
};

async function patchClerkRoleMetadata(
  clerkId: string,
  role: string,
  clinicId: string | null
): Promise<{ synced: boolean; status?: number }> {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret || clerkId.startsWith("pending:")) {
    return { synced: false };
  }
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_metadata: {
            role,
            clinicId,
          },
        }),
      }
    );
    return { synced: res.ok, status: res.status };
  } catch {
    return { synced: false };
  }
}

async function fetchClerkUserProfile(
  clerkId: string
): Promise<ClerkUserLookup | null> {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret || clerkId.startsWith("pending:")) {
    return null;
  }
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
        },
      }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      first_name?: string | null;
      last_name?: string | null;
      image_url?: string | null;
      primary_email_address_id?: string | null;
      primary_phone_number_id?: string | null;
      email_addresses?: Array<{
        id: string;
        email_address: string;
        verification?: { status?: string } | null;
      }>;
      phone_numbers?: Array<{
        id: string;
        phone_number: string;
      }>;
    };

    const emails = data.email_addresses ?? [];
    const primaryEmailObj =
      emails.find((e) => e.id === data.primary_email_address_id) ?? emails[0];
    const email = (primaryEmailObj?.email_address ?? "").trim().toLowerCase();
    if (!email) return null;

    const phones = data.phone_numbers ?? [];
    const primaryPhoneObj =
      phones.find((p) => p.id === data.primary_phone_number_id) ?? phones[0];

    return {
      email,
      firstName: data.first_name?.trim() || undefined,
      lastName: data.last_name?.trim() || undefined,
      phone: primaryPhoneObj?.phone_number || undefined,
      avatarUrl: data.image_url || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors role and clinicId into Clerk `publicMetadata` so Next.js edge routing
 * (`src/proxy.ts`) immediately recognizes the user's new role without waiting for webhooks.
 */
export const syncClerkRoleMetadata = internalAction({
  args: {
    clerkId: v.string(),
    role: v.string(),
    clinicId: v.union(v.string(), v.null()),
  },
  handler: async (_ctx, args) => {
    return await patchClerkRoleMetadata(args.clerkId, args.role, args.clinicId);
  },
});

/**
 * Public sanitized lookup for `/invite/[token]`.
 * Returns ONLY non-sensitive invitation context (role, clinic display info, inviter name, status).
 */
export const getInvitationByToken = query({
  args: {
    token: v.string(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cleanToken = args.token.trim();
    if (!cleanToken) return null;

    const invitation = await ctx.db
      .query("staffInvitations")
      .withIndex("by_token", (q) => q.eq("token", cleanToken))
      .unique();

    if (!invitation) return null;

    const [clinic, inviter] = await Promise.all([
      invitation.clinicId ? ctx.db.get(invitation.clinicId) : Promise.resolve(null),
      ctx.db.get(invitation.invitedByUserId),
    ]);

    const referenceNow = args.nowMs ?? 0;
    const isExpired =
      invitation.status === "pending" &&
      referenceNow > 0 &&
      referenceNow > invitation.expiresAt;

    const effectiveStatus = isExpired ? ("expired" as const) : invitation.status;

    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email
      : "Smile Administrator";

    return {
      _id: invitation._id,
      email: invitation.email,
      role: invitation.role,
      status: effectiveStatus,
      inviterName,
      inviterNote: invitation.inviterNote ?? null,
      declineReason: invitation.declineReason ?? null,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      respondedAt: invitation.respondedAt ?? null,
      clinic: clinic
        ? {
            _id: clinic._id,
            name: clinic.name,
            slug: clinic.slug,
            city: clinic.city,
            province: clinic.province,
            primaryColorHex: clinic.primaryColorHex,
          }
        : null,
    };
  },
});

async function performAcceptInvitation(
  ctx: MutationCtx,
  params: {
    token: string;
    clerkId: string;
    verifiedEmail: string;
    givenName?: string;
    familyName?: string;
    fullName?: string;
    phone?: string;
    avatarUrl?: string;
    scheduleClerkSync: boolean;
  }
): Promise<AcceptInvitationResult> {
  const cleanToken = params.token.trim();
  const invitation = await ctx.db
    .query("staffInvitations")
    .withIndex("by_token", (q) => q.eq("token", cleanToken))
    .unique();

  if (!invitation) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "This invitation link is invalid or no longer exists.",
    });
  }

  const now = Date.now();
  if (invitation.status === "accepted") {
    return {
      role: invitation.role,
      clinicId: invitation.clinicId ?? null,
      homePath: ROLE_HOME_PATH[invitation.role],
      alreadyAccepted: true,
    };
  }

  if (invitation.status !== "pending") {
    throw new ConvexError({
      code: "INVITATION_CLOSED",
      message: `This invitation was ${invitation.status} and can no longer be accepted.`,
    });
  }

  if (now > invitation.expiresAt) {
    throw new ConvexError({
      code: "INVITATION_EXPIRED",
      message:
        "This invitation link has expired. Ask your Smile administrator to resend it.",
    });
  }

  // Resolve signed-in user's verified email (from Clerk JWT/API or existing Convex user row)
  const existingByClerk = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", params.clerkId))
    .unique();

  const signedInEmail = (
    params.verifiedEmail ||
    existingByClerk?.email ||
    ""
  )
    .trim()
    .toLowerCase();

  if (!signedInEmail) {
    throw new ConvexError({
      code: "MISSING_EMAIL_CLAIM",
      message:
        "Your session token did not include your email address. Please refresh the page or sign out and sign back in.",
    });
  }

  const invitedEmail = invitation.email.trim().toLowerCase();
  if (signedInEmail !== invitedEmail) {
    throw new ConvexError({
      code: "EMAIL_MISMATCH",
      message: `This invitation was issued for ${invitation.email}, but your session is signed in as ${signedInEmail}. Please sign in with ${invitation.email}.`,
    });
  }

  // Validate clinic still exists for clinic-scoped roles
  let targetClinic = null;
  if (invitation.role !== "super_admin") {
    if (!invitation.clinicId) {
      throw new ConvexError({
        code: "INVALID_INVITATION",
        message: "Clinic assignment is missing from this staff invitation.",
      });
    }
    targetClinic = await ctx.db.get(invitation.clinicId);
    if (!targetClinic) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "The invited dental clinic no longer exists.",
      });
    }
  }

  // Claim any pending pre-created row for this email if user isn't linked yet
  const pendingByEmail = existingByClerk
    ? null
    : (
        await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", signedInEmail))
          .collect()
      ).find((u) => u.clerkId.startsWith("pending:"));

  const nameParts = (params.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName =
    existingByClerk?.firstName ||
    params.givenName ||
    nameParts[0] ||
    "Smile";
  const lastName =
    existingByClerk?.lastName ||
    params.familyName ||
    (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Member");

  const nextClinicId: Id<"clinics"> | undefined =
    invitation.role === "super_admin" ? undefined : invitation.clinicId;

  let userId: Id<"users">;
  if (existingByClerk) {
    userId = existingByClerk._id;
    await ctx.db.patch(existingByClerk._id, {
      email: existingByClerk.email || signedInEmail,
      firstName: existingByClerk.firstName || firstName,
      lastName: existingByClerk.lastName || lastName,
      avatarUrl: existingByClerk.avatarUrl ?? params.avatarUrl,
      role: invitation.role,
      clinicId: nextClinicId,
      isActive: true,
      lastLoginAt: now,
    });
  } else if (pendingByEmail) {
    userId = pendingByEmail._id;
    await ctx.db.patch(pendingByEmail._id, {
      clerkId: params.clerkId,
      firstName,
      lastName,
      phone: params.phone ?? pendingByEmail.phone,
      avatarUrl: params.avatarUrl ?? pendingByEmail.avatarUrl,
      role: invitation.role,
      clinicId: nextClinicId,
      isActive: true,
      lastLoginAt: now,
    });
  } else {
    userId = await ctx.db.insert("users", {
      clerkId: params.clerkId,
      email: signedInEmail,
      firstName,
      lastName,
      phone: params.phone,
      avatarUrl: params.avatarUrl,
      role: invitation.role,
      clinicId: nextClinicId,
      isActive: true,
      lastLoginAt: now,
      createdAt: now,
    });
  }

  // Auto-bootstrap a starter Dentist profile so `/staff` works immediately on first login
  if (invitation.role === "dentist" && targetClinic) {
    const existingDentistRows = await ctx.db
      .query("dentists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(20);
    const alreadyLinked = existingDentistRows.some(
      (d) => d.clinicId === targetClinic._id
    );

    if (!alreadyLinked) {
      const plan = await ctx.db.get(targetClinic.planId);
      const withinQuota =
        !plan || targetClinic.activeDentistCount < plan.maxDentists;
      if (withinQuota) {
        const displayName = `Dr. ${`${firstName} ${lastName}`.trim()}`;
        await ctx.db.insert("dentists", {
          clinicId: targetClinic._id,
          userId,
          displayName,
          licenseNumber: "PENDING-PRC",
          specialties: ["General Dentistry"],
          calendarColorHex: targetClinic.primaryColorHex,
          weeklySchedule: DEFAULT_DENTIST_SCHEDULE,
          isActive: true,
        });
        await ctx.db.patch(targetClinic._id, {
          activeDentistCount: targetClinic.activeDentistCount + 1,
          updatedAt: now,
        });
      }
    }
  }

  await ctx.db.patch(invitation._id, {
    status: "accepted",
    respondedAt: now,
  });

  await recordAuditLog(ctx, {
    actorUserId: userId,
    actorRole: invitation.role,
    clinicId: nextClinicId,
    actionType: "ROLE_INVITATION_ACCEPTED",
    targetEntity: "staffInvitations",
    targetId: invitation._id,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      clinicName: targetClinic?.name ?? "Platform-wide",
    },
  });

  if (params.scheduleClerkSync) {
    await ctx.scheduler.runAfter(0, internal.invitations.syncClerkRoleMetadata, {
      clerkId: params.clerkId,
      role: invitation.role,
      clinicId: nextClinicId ?? null,
    });
  }

  return {
    role: invitation.role,
    clinicId: nextClinicId ?? null,
    homePath: ROLE_HOME_PATH[invitation.role],
    alreadyAccepted: false,
  };
}

/**
 * Internal ACID commit mutation invoked by `acceptInvitationWithFallback`.
 */
export const commitAcceptInvitation = internalMutation({
  args: {
    token: v.string(),
    clerkId: v.string(),
    verifiedEmail: v.string(),
    givenName: v.optional(v.string()),
    familyName: v.optional(v.string()),
    fullName: v.optional(v.string()),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AcceptInvitationResult> => {
    return await performAcceptInvitation(ctx, {
      ...args,
      scheduleClerkSync: false,
    });
  },
});

/**
 * Resilient invitation acceptance action for `/invite/[token]`.
 * Uses the authenticated Clerk JWT (`identity.email`), falls back to verifying the
 * authenticated `identity.subject` directly against Clerk's Backend API if a stale
 * token omits `email`, commits the role atomically in Convex, and awaits Clerk
 * `publicMetadata` sync before returning so edge routing works immediately.
 */
export const acceptInvitationWithFallback = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args): Promise<AcceptInvitationResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message:
          "Please sign in or create an account with your invited email first.",
      });
    }

    let verifiedEmail = (identity.email ?? "").trim().toLowerCase();
    let givenName = identity.givenName;
    let familyName = identity.familyName;
    let phone = identity.phoneNumber;
    let avatarUrl = identity.pictureUrl;

    if (!verifiedEmail) {
      const clerkProfile = await fetchClerkUserProfile(identity.subject);
      if (clerkProfile) {
        verifiedEmail = clerkProfile.email;
        givenName = givenName ?? clerkProfile.firstName;
        familyName = familyName ?? clerkProfile.lastName;
        phone = phone ?? clerkProfile.phone;
        avatarUrl = avatarUrl ?? clerkProfile.avatarUrl;
      }
    }

    const result: AcceptInvitationResult = await ctx.runMutation(
      internal.invitations.commitAcceptInvitation,
      {
        token: args.token,
        clerkId: identity.subject,
        verifiedEmail,
        givenName,
        familyName,
        fullName: identity.name,
        phone,
        avatarUrl,
      }
    );

    // Sync Clerk publicMetadata synchronously before returning so `/front-desk`, `/admin`, etc.
    // recognize the new role immediately on redirect.
    await patchClerkRoleMetadata(
      identity.subject,
      result.role,
      result.clinicId ?? null
    );

    return result;
  },
});

/**
 * Authenticated acceptance of a role invitation on `/invite/[token]`.
 * Enforces exact email match between the signed-in Clerk identity and `invitation.email`,
 * assigns the role & clinicId in Convex `users`, bootstraps a starter `dentists` profile
 * for Dentist invites, logs to `platformAuditLogs`, and syncs Clerk `publicMetadata`.
 */
export const acceptInvitation = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args): Promise<AcceptInvitationResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Please sign in or create an account with your invited email first.",
      });
    }

    return await performAcceptInvitation(ctx, {
      token: args.token,
      clerkId: identity.subject,
      verifiedEmail: (identity.email ?? "").trim().toLowerCase(),
      givenName: identity.givenName,
      familyName: identity.familyName,
      fullName: identity.name,
      phone: identity.phoneNumber,
      avatarUrl: identity.pictureUrl,
      scheduleClerkSync: true,
    });
  },
});

/**
 * Allows the recipient to decline an invitation directly from `/invite/[token]`
 * without having to create an account first (authorized by the unguessable token).
 */
export const declineInvitation = mutation({
  args: {
    token: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cleanToken = args.token.trim();
    const invitation = await ctx.db
      .query("staffInvitations")
      .withIndex("by_token", (q) => q.eq("token", cleanToken))
      .unique();

    if (!invitation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "This invitation link is invalid or no longer exists.",
      });
    }

    if (invitation.status === "declined") {
      return { status: "declined" as const };
    }

    if (invitation.status !== "pending") {
      throw new ConvexError({
        code: "INVITATION_CLOSED",
        message: `This invitation is already ${invitation.status}.`,
      });
    }

    const now = Date.now();
    const cleanReason = args.reason?.trim() || undefined;

    await ctx.db.patch(invitation._id, {
      status: "declined",
      declineReason: cleanReason,
      respondedAt: now,
    });

    // Record audit log using the signed-in user if present, otherwise attribute to inviter reference
    const identity = await ctx.auth.getUserIdentity();
    const signedInUser = identity
      ? await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
          .unique()
      : null;

    await recordAuditLog(ctx, {
      actorUserId: signedInUser?._id ?? invitation.invitedByUserId,
      actorRole: signedInUser?.role ?? "invitee",
      clinicId: invitation.clinicId,
      actionType: "ROLE_INVITATION_DECLINED",
      targetEntity: "staffInvitations",
      targetId: invitation._id,
      metadata: {
        email: invitation.email,
        role: invitation.role,
        reason: cleanReason ?? null,
      },
    });

    return { status: "declined" as const };
  },
});
