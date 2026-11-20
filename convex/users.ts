import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/permissions";

/**
 * Called by the Clerk webhook (convex/http.ts). Upserts the `users` row and
 * resolves the role: super admin email > pending staff invitation > existing > patient.
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
      const invitation = invitations.find((i) => i.expiresAt >= now);
      if (invitation) {
        role = invitation.role;
        clinicId = invitation.clinicId;
        await ctx.db.patch(invitation._id, { status: "accepted" });
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

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        isActive: existingByEmail ? true : existing.isActive,
      });
    } else {
      await ctx.db.insert("users", {
        ...fields,
        isActive: true,
        createdAt: now,
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

/** Current signed-in user; null while the webhook has not synced them yet. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user || !user.isActive) return null;
    return {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      clinicId: user.clinicId ?? null,
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

    if (existing) {
      if (!existing.isActive) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "User account is deactivated.",
        });
      }
      return {
        _id: existing._id,
        role: existing.role,
        clinicId: existing.clinicId ?? null,
      };
    }

    const now = Date.now();
    const email = (identity.email ?? "").trim().toLowerCase();
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

    // If an admin pre-created staff by email with a pending placeholder, claim that row
    const pendingByEmail = (
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).find((u) => u.clerkId.startsWith("pending:"));

    let role = pendingByEmail?.role ?? ("patient" as const);
    let clinicId = pendingByEmail?.clinicId;

    if (superAdminEmail && email === superAdminEmail) {
      role = "super_admin";
      clinicId = undefined;
    } else if (!pendingByEmail) {
      const invitations = await ctx.db
        .query("staffInvitations")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", "pending")
        )
        .collect();
      const invitation = invitations.find((i) => i.expiresAt >= now);
      if (invitation) {
        role = invitation.role;
        clinicId = invitation.clinicId;
        await ctx.db.patch(invitation._id, { status: "accepted" });
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

    if (pendingByEmail) {
      await ctx.db.patch(pendingByEmail._id, fields);
      return {
        _id: pendingByEmail._id,
        role,
        clinicId: clinicId ?? null,
      };
    }

    const newId = await ctx.db.insert("users", {
      ...fields,
      createdAt: now,
    });

    return {
      _id: newId,
      role,
      clinicId: clinicId ?? null,
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
