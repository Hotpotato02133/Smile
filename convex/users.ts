import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { recordAuditLog } from "./lib/audit";
import { getAuthenticatedUser } from "./lib/permissions";

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

async function ensureStarterDentistProfile(
  ctx: MutationCtx,
  params: {
    clinicId: Id<"clinics">;
    userId: Id<"users">;
    firstName: string;
    lastName: string;
    now: number;
  }
) {
  const clinic = await ctx.db.get(params.clinicId);
  if (!clinic) return;

  const existingDentistRows = await ctx.db
    .query("dentists")
    .withIndex("by_user", (q) => q.eq("userId", params.userId))
    .take(20);
  if (existingDentistRows.some((d) => d.clinicId === clinic._id)) {
    return;
  }

  const plan = await ctx.db.get(clinic.planId);
  if (plan && clinic.activeDentistCount >= plan.maxDentists) {
    return;
  }

  const fullName = `${params.firstName} ${params.lastName}`.trim() || "Dentist";
  const displayName = /^dr\.?\s/i.test(fullName) ? fullName : `Dr. ${fullName}`;

  await ctx.db.insert("dentists", {
    clinicId: clinic._id,
    userId: params.userId,
    displayName,
    licenseNumber: "PENDING-PRC",
    specialties: ["General Dentistry"],
    calendarColorHex: clinic.primaryColorHex,
    weeklySchedule: DEFAULT_DENTIST_SCHEDULE,
    isActive: true,
  });

  await ctx.db.patch(clinic._id, {
    activeDentistCount: clinic.activeDentistCount + 1,
    updatedAt: params.now,
  });
}

/**
 * Called by the Clerk webhook (convex/http.ts). Upserts the `users` row and
 * resolves the role: super admin email > pending clinic staff invitation > existing > patient.
 */
export const upsertFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = args.email.trim().toLowerCase();
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

    const existingByClerk = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    // If a clinic admin pre-created a dentist profile before Clerk sign-up, claim that row
    // so `dentists.userId` stays linked to the real user account.
    const existingByEmail = existingByClerk
      ? null
      : (
          await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect()
        ).find((u) => u.clerkId.startsWith("pending:"));

    const existing = existingByClerk ?? existingByEmail ?? null;

    let role = existing?.role ?? ("patient" as const);
    let clinicId = existing?.clinicId;
    let acceptedInvitation: {
      _id: Id<"staffInvitations">;
      role: "clinic_admin" | "dentist" | "receptionist";
      clinicId: Id<"clinics">;
      email: string;
    } | null = null;

    if (superAdminEmail && email === superAdminEmail) {
      role = "super_admin";
      clinicId = undefined;
    } else {
      const invitations = await ctx.db
        .query("staffInvitations")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", "pending")
        )
        .collect();
      // Auto-assign clinic-scoped staff invitations on Clerk sign-up (super_admin invites still require explicit /invite/[token] acceptance).
      let clinicInvite: (typeof invitations)[number] | undefined;
      for (const inv of invitations) {
        if (
          inv.role !== "super_admin" &&
          inv.clinicId !== undefined &&
          inv.expiresAt >= now &&
          (!clinicInvite || inv.createdAt > clinicInvite.createdAt)
        ) {
          clinicInvite = inv;
        }
      }

      if (clinicInvite && clinicInvite.clinicId && clinicInvite.role !== "super_admin") {
        role = clinicInvite.role;
        clinicId = clinicInvite.clinicId;
        await ctx.db.patch(clinicInvite._id, {
          status: "accepted",
          respondedAt: now,
        });
        acceptedInvitation = {
          _id: clinicInvite._id,
          role: clinicInvite.role,
          clinicId: clinicInvite.clinicId,
          email: clinicInvite.email,
        };
      }
    }

    const fields = {
      clerkId: args.clerkId,
      email,
      firstName: args.firstName,
      lastName: args.lastName,
      phone: args.phone,
      avatarUrl: args.avatarUrl,
      role,
      clinicId,
    };

    let userId: Id<"users">;
    if (existing) {
      userId = existing._id;
      await ctx.db.patch(existing._id, {
        ...fields,
        isActive: existingByEmail ? true : existing.isActive,
      });
    } else {
      userId = await ctx.db.insert("users", {
        ...fields,
        isActive: true,
        createdAt: now,
      });
    }

    if (acceptedInvitation) {
      if (acceptedInvitation.role === "dentist") {
        await ensureStarterDentistProfile(ctx, {
          clinicId: acceptedInvitation.clinicId,
          userId,
          firstName: args.firstName,
          lastName: args.lastName,
          now,
        });
      }
      await recordAuditLog(ctx, {
        actorUserId: userId,
        actorRole: acceptedInvitation.role,
        clinicId: acceptedInvitation.clinicId,
        actionType: "ROLE_INVITATION_ACCEPTED",
        targetEntity: "staffInvitations",
        targetId: acceptedInvitation._id,
        metadata: {
          email: acceptedInvitation.email,
          role: acceptedInvitation.role,
          via: "clerk_webhook",
        },
      });
    }

    return { role, clinicId: clinicId ?? null };
  },
});

/** Soft-deactivates the user when deleted in Clerk (keeps clinical history intact). */
export const deactivateFromClerk = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (user) {
      await ctx.db.patch(user._id, { isActive: false });
    }
  },
});

/**
 * Current signed-in user; `null` only while unauthenticated or before the Clerk webhook/sync creates the row.
 * Returns `isActive: false` for deactivated accounts so auth guards can render the deactivated state cleanly
 * without throwing server errors into the client console.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;
    return {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      clinicId: user.clinicId ?? null,
      isActive: user.isActive,
    };
  },
});

export const touchLastLogin = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (user) await ctx.db.patch(user._id, { lastLoginAt: Date.now() });
  },
});

/**
 * Idempotently ensures the current authenticated Clerk user exists in Convex `users`.
 * Solves race conditions and local development environments where Clerk webhook forwarding
 * has not delivered `user.created` yet. Enforces Law #2 and Law #3.
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign-in required." });
    }
    const clerkId = identity.subject;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    const now = Date.now();
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

    if (existing) {
      if (!existing.isActive) {
        return {
          _id: existing._id,
          role: existing.role,
          clinicId: existing.clinicId ?? null,
          isActive: false as const,
        };
      }
      const existingEmail = existing.email.trim().toLowerCase();
      // Promote root Super Admin if SUPER_ADMIN_EMAIL was configured after sign-up
      if (
        superAdminEmail &&
        existingEmail === superAdminEmail &&
        existing.role !== "super_admin"
      ) {
        await ctx.db.patch(existing._id, {
          role: "super_admin",
          clinicId: undefined,
        });
        return {
          _id: existing._id,
          role: "super_admin" as const,
          clinicId: null,
          isActive: true as const,
        };
      }
      // If an existing patient has a pending clinic staff invitation, auto-accept it
      if (existing.role === "patient" && existingEmail) {
        const invitations = await ctx.db
          .query("staffInvitations")
          .withIndex("by_email_and_status", (q) =>
            q.eq("email", existingEmail).eq("status", "pending")
          )
          .collect();
        let clinicInvite: (typeof invitations)[number] | undefined;
        for (const inv of invitations) {
          if (
            inv.role !== "super_admin" &&
            inv.clinicId !== undefined &&
            inv.expiresAt >= now &&
            (!clinicInvite || inv.createdAt > clinicInvite.createdAt)
          ) {
            clinicInvite = inv;
          }
        }
        if (
          clinicInvite &&
          clinicInvite.clinicId &&
          clinicInvite.role !== "super_admin"
        ) {
          await ctx.db.patch(existing._id, {
            role: clinicInvite.role,
            clinicId: clinicInvite.clinicId,
          });
          await ctx.db.patch(clinicInvite._id, {
            status: "accepted",
            respondedAt: now,
          });
          if (clinicInvite.role === "dentist") {
            await ensureStarterDentistProfile(ctx, {
              clinicId: clinicInvite.clinicId,
              userId: existing._id,
              firstName: existing.firstName,
              lastName: existing.lastName,
              now,
            });
          }
          await recordAuditLog(ctx, {
            actorUserId: existing._id,
            actorRole: clinicInvite.role,
            clinicId: clinicInvite.clinicId,
            actionType: "ROLE_INVITATION_ACCEPTED",
            targetEntity: "staffInvitations",
            targetId: clinicInvite._id,
            metadata: {
              email: clinicInvite.email,
              role: clinicInvite.role,
              via: "ensure_current_user",
            },
          });
          return {
            _id: existing._id,
            role: clinicInvite.role,
            clinicId: clinicInvite.clinicId,
            isActive: true as const,
          };
        }
      }
      return {
        _id: existing._id,
        role: existing.role,
        clinicId: existing.clinicId ?? null,
        isActive: true as const,
      };
    }

    const email = (identity.email ?? "").trim().toLowerCase();

    // If an admin pre-created staff by email with a pending placeholder, claim that row
    const pendingByEmail = (
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).find((u) => u.clerkId.startsWith("pending:"));

    let role = pendingByEmail?.role ?? ("patient" as const);
    let clinicId = pendingByEmail?.clinicId;
    let acceptedInvitation: {
      _id: Id<"staffInvitations">;
      role: "clinic_admin" | "dentist" | "receptionist";
      clinicId: Id<"clinics">;
      email: string;
    } | null = null;

    if (superAdminEmail && email === superAdminEmail) {
      role = "super_admin";
      clinicId = undefined;
    } else {
      const invitations = await ctx.db
        .query("staffInvitations")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", "pending")
        )
        .collect();
      let clinicInvite: (typeof invitations)[number] | undefined;
      for (const inv of invitations) {
        if (
          inv.role !== "super_admin" &&
          inv.clinicId !== undefined &&
          inv.expiresAt >= now &&
          (!clinicInvite || inv.createdAt > clinicInvite.createdAt)
        ) {
          clinicInvite = inv;
        }
      }
      if (clinicInvite && clinicInvite.clinicId && clinicInvite.role !== "super_admin") {
        role = clinicInvite.role;
        clinicId = clinicInvite.clinicId;
        await ctx.db.patch(clinicInvite._id, {
          status: "accepted",
          respondedAt: now,
        });
        acceptedInvitation = {
          _id: clinicInvite._id,
          role: clinicInvite.role,
          clinicId: clinicInvite.clinicId,
          email: clinicInvite.email,
        };
      }
    }

    const nameParts = (identity.name ?? "").trim().split(/\s+/);
    const firstName = identity.givenName ?? nameParts[0] ?? "Patient";
    const lastName =
      identity.familyName ?? (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    const fields = {
      clerkId,
      email,
      firstName,
      lastName,
      phone: identity.phoneNumber,
      avatarUrl: identity.pictureUrl,
      role,
      clinicId,
      isActive: true,
    };

    let userId: Id<"users">;
    if (pendingByEmail) {
      userId = pendingByEmail._id;
      await ctx.db.patch(pendingByEmail._id, fields);
    } else {
      userId = await ctx.db.insert("users", {
        ...fields,
        createdAt: now,
      });
    }

    if (acceptedInvitation) {
      if (acceptedInvitation.role === "dentist") {
        await ensureStarterDentistProfile(ctx, {
          clinicId: acceptedInvitation.clinicId,
          userId,
          firstName,
          lastName,
          now,
        });
      }
      await recordAuditLog(ctx, {
        actorUserId: userId,
        actorRole: acceptedInvitation.role,
        clinicId: acceptedInvitation.clinicId,
        actionType: "ROLE_INVITATION_ACCEPTED",
        targetEntity: "staffInvitations",
        targetId: acceptedInvitation._id,
        metadata: {
          email: acceptedInvitation.email,
          role: acceptedInvitation.role,
          via: "ensure_current_user",
        },
      });
    }

    return {
      _id: userId,
      role,
      clinicId: clinicId ?? null,
      isActive: true as const,
    };
  },
});

/** Used by clients that need a guaranteed-authenticated read of their own profile. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    return { role: user.role, clinicId: user.clinicId ?? null };
  },
});
