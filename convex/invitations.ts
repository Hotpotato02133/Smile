import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, mutation, query } from "./_generated/server";
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
    const secret = process.env.CLERK_SECRET_KEY?.trim();
    if (!secret || args.clerkId.startsWith("pending:")) {
      return { synced: false };
    }
    try {
      const res = await fetch(
        `https://api.clerk.com/v1/users/${encodeURIComponent(args.clerkId)}/metadata`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            public_metadata: {
              role: args.role,
              clinicId: args.clinicId,
            },
          }),
        }
      );
      return { synced: res.ok, status: res.status };
    } catch {
      return { synced: false };
    }
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
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Please sign in or create an account with your invited email first.",
      });
    }

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

    // Resolve signed-in user's verified email (from Clerk JWT or existing Convex user row)
    const existingByClerk = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const signedInEmail = (
      identity.email ??
      existingByClerk?.email ??
      ""
    )
      .trim()
      .toLowerCase();

    if (!signedInEmail || signedInEmail !== invitation.email.trim().toLowerCase()) {
      throw new ConvexError({
        code: "EMAIL_MISMATCH",
        message: `This invitation was issued for ${invitation.email}. Please sign in with that exact email address.`,
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

    const nameParts = (identity.name ?? "").trim().split(/\s+/);
    const firstName =
      existingByClerk?.firstName ||
      identity.givenName ||
      nameParts[0] ||
      "Smile";
    const lastName =
      existingByClerk?.lastName ||
      identity.familyName ||
      (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Member");

    const nextClinicId: Id<"clinics"> | undefined =
      invitation.role === "super_admin" ? undefined : invitation.clinicId;

    let userId: Id<"users">;
    if (existingByClerk) {
      userId = existingByClerk._id;
      await ctx.db.patch(existingByClerk._id, {
        role: invitation.role,
        clinicId: nextClinicId,
        isActive: true,
        lastLoginAt: now,
      });
    } else if (pendingByEmail) {
      userId = pendingByEmail._id;
      await ctx.db.patch(pendingByEmail._id, {
        clerkId: identity.subject,
        firstName,
        lastName,
        phone: identity.phoneNumber ?? pendingByEmail.phone,
        avatarUrl: identity.pictureUrl ?? pendingByEmail.avatarUrl,
        role: invitation.role,
        clinicId: nextClinicId,
        isActive: true,
        lastLoginAt: now,
      });
    } else {
      userId = await ctx.db.insert("users", {
        clerkId: identity.subject,
        email: signedInEmail,
        firstName,
        lastName,
        phone: identity.phoneNumber,
        avatarUrl: identity.pictureUrl,
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

    await ctx.scheduler.runAfter(0, internal.invitations.syncClerkRoleMetadata, {
      clerkId: identity.subject,
      role: invitation.role,
      clinicId: nextClinicId ?? null,
    });

    return {
      role: invitation.role,
      clinicId: nextClinicId ?? null,
      homePath: ROLE_HOME_PATH[invitation.role],
      alreadyAccepted: false,
    };
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
