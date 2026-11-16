import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
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

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

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
      email,
      firstName: args.firstName,
      lastName: args.lastName,
      phone: args.phone,
      avatarUrl: args.avatarUrl,
      role,
      clinicId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("users", {
        clerkId: args.clerkId,
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

/** Used by clients that need a guaranteed-authenticated read of their own profile. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    return { role: user.role, clinicId: user.clinicId ?? null };
  },
});
