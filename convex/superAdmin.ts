import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  DAY_MS,
  generateInviteToken,
  GRACE_PERIOD_MS,
  recordAuditLog,
  toManilaDateKey,
  toManilaMonthKey,
} from "./lib/audit";
import { isRootSuperAdmin, requireSuperAdmin } from "./lib/permissions";
import { DEFAULT_SERVICE_CATALOG } from "./lib/serviceCatalog";

const clinicStatusValidator = v.union(
  v.literal("trial"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("suspended"),
  v.literal("archived")
);

const billingCycleValidator = v.union(
  v.literal("monthly"),
  v.literal("annual"),
  v.literal("trial")
);

const featureFlagsValidator = v.object({
  odontogramEnabled: v.boolean(),
  xrayStorageEnabled: v.boolean(),
  waitlistAutomationEnabled: v.boolean(),
  recallAutomationEnabled: v.boolean(),
  customBrandingEnabled: v.boolean(),
});

const DEFAULT_OPERATING_HOURS = [
  { dayOfWeek: 0, isOpen: false, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 1, isOpen: true, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 2, isOpen: true, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 3, isOpen: true, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 4, isOpen: true, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 5, isOpen: true, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 6, isOpen: true, openMinute: 540, closeMinute: 1020 },
];

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const listClinics = query({
  args: {
    status: v.optional(clinicStatusValidator),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const clinics = args.status
      ? await ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .take(500)
      : await ctx.db.query("clinics").take(500);

    const plans = await ctx.db.query("subscriptionPlans").take(50);
    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      plans.map((p) => [p._id, p])
    );

    const term = args.search?.trim().toLowerCase();
    const filtered = term
      ? clinics.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.slug.toLowerCase().includes(term) ||
          c.city.toLowerCase().includes(term) ||
          c.province.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term)
      )
      : clinics;

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    return filtered.map((clinic) => {
      const plan = planMap.get(clinic.planId);
      return {
        ...clinic,
        plan: plan
          ? {
            _id: plan._id,
            code: plan.code,
            name: plan.name,
            monthlyPricePhp: plan.monthlyPricePhp,
            annualPricePhp: plan.annualPricePhp,
            maxDentists: plan.maxDentists,
            maxChairs: plan.maxChairs,
            maxAppointmentsPerMonth: plan.maxAppointmentsPerMonth,
            maxStorageBytes: plan.maxStorageBytes,
            maxEmailsPerMonth: plan.maxEmailsPerMonth,
          }
          : null,
      };
    });
  },
});

export const getClinicDetail = query({
  args: { clinicId: v.id("clinics") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    const [plan, pendingInvitations, payments, recentAuditLogs, staff] =
      await Promise.all([
        ctx.db.get(clinic.planId),
        ctx.db
          .query("staffInvitations")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", args.clinicId).eq("status", "pending")
          )
          .collect(),
        ctx.db
          .query("subscriptionPayments")
          .withIndex("by_clinic", (q) => q.eq("clinicId", args.clinicId))
          .order("desc")
          .take(15),
        ctx.db
          .query("platformAuditLogs")
          .withIndex("by_clinic_and_date", (q) => q.eq("clinicId", args.clinicId))
          .order("desc")
          .take(20),
        ctx.db
          .query("users")
          .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", args.clinicId))
          .collect(),
      ]);

    return {
      clinic,
      plan,
      pendingInvitations,
      payments,
      recentAuditLogs,
      staffCount: staff.length,
    };
  },
});

export const createClinic = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    tagline: v.optional(v.string()),
    primaryColorHex: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    province: v.string(),
    timezone: v.optional(v.string()),
    planId: v.id("subscriptionPlans"),
    billingCycle: billingCycleValidator,
    ownerEmail: v.optional(v.string()),
    slotIntervalMinutes: v.optional(v.number()),
    cancellationWindowHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const name = args.name.trim();
    const slug = args.slug.trim().toLowerCase();
    const email = args.email.trim().toLowerCase();
    const primaryColorHex = HEX_COLOR_REGEX.test(args.primaryColorHex.trim())
      ? args.primaryColorHex.trim()
      : "#0284c7";

    if (name.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Clinic name must be at least 2 characters.",
      });
    }
    if (!SLUG_REGEX.test(slug)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Clinic slug must use lowercase letters, numbers, and hyphens only.",
      });
    }

    const existingSlug = await ctx.db
      .query("clinics")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existingSlug) {
      throw new ConvexError({
        code: "SLUG_TAKEN",
        message: `Slug "${slug}" is already assigned to another clinic.`,
      });
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Selected subscription plan does not exist.",
      });
    }

    const now = Date.now();
    const isTrial = args.billingCycle === "trial" || plan.code === "trial";
    const durationDays = isTrial
      ? Math.max(plan.trialDays || 14, 1)
      : args.billingCycle === "annual"
        ? 365
        : 30;
    const subscriptionEndsAt = now + durationDays * DAY_MS;

    const clinicId = await ctx.db.insert("clinics", {
      name,
      slug,
      tagline: args.tagline?.trim() || undefined,
      primaryColorHex,
      email,
      phone: args.phone.trim(),
      address: args.address.trim(),
      city: args.city.trim(),
      province: args.province.trim(),
      timezone: args.timezone?.trim() || "Asia/Manila",
      planId: plan._id,
      status: isTrial ? "trial" : "active",
      billingCycle: isTrial ? "trial" : args.billingCycle,
      trialEndsAt: isTrial ? subscriptionEndsAt : undefined,
      subscriptionStartsAt: now,
      subscriptionEndsAt,
      featureFlags: { ...plan.defaultFeatures },
      activeDentistCount: 0,
      activeChairCount: 1,
      currentMonthKey: toManilaMonthKey(now),
      currentMonthAppointmentCount: 0,
      currentMonthEmailCount: 0,
      storageUsedBytes: 0,
      lifetimeAppointmentCount: 0,
      slotIntervalMinutes: args.slotIntervalMinutes === 15 ? 15 : 30,
      cancellationWindowHours: args.cancellationWindowHours ?? 24,
      emergencyBufferMinutesPerDay: 30,
      operatingHours: DEFAULT_OPERATING_HOURS,
      createdAt: now,
      updatedAt: now,
    });

    // Seed 1 default operatory chair so the clinic is immediately ready for scheduling
    await ctx.db.insert("chairs", {
      clinicId,
      name: "Operatory Chair 1",
      roomCode: "OP-1",
      supportedCategoryTags: ["General"],
      isActive: true,
    });

    // Seed default dental service catalog for the newly provisioned clinic
    for (const svc of DEFAULT_SERVICE_CATALOG) {
      await ctx.db.insert("services", {
        clinicId,
        name: svc.name,
        category: svc.category,
        description: svc.description,
        durationMinutes: svc.durationMinutes,
        bufferMinutes: svc.bufferMinutes,
        pricePhp: svc.pricePhp,
        requiresXray: svc.requiresXray,
        requiredChairTag:
          "requiredChairTag" in svc ? svc.requiredChairTag : undefined,
        isActive: true,
      });
    }

    const inviteEmail = args.ownerEmail?.trim().toLowerCase() || email;
    let ownerInviteToken: string | null = null;
    if (inviteEmail) {
      const inviteToken = generateInviteToken();
      ownerInviteToken = inviteToken;
      const invitationId = await ctx.db.insert("staffInvitations", {
        clinicId,
        email: inviteEmail,
        role: "clinic_admin",
        token: inviteToken,
        invitedByUserId: actor._id,
        status: "pending",
        emailStatus: "queued",
        expiresAt: now + 7 * DAY_MS,
        createdAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendRoleInvitationEmail,
        { invitationId }
      );
    }

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CLINIC_CREATED",
      targetEntity: "clinics",
      targetId: clinicId,
      metadata: {
        name,
        slug,
        planCode: plan.code,
        billingCycle: isTrial ? "trial" : args.billingCycle,
        ownerInviteEmail: inviteEmail,
        defaultChairSeeded: "OP-1",
      },
    });

    return { clinicId, slug, ownerInviteToken };
  },
});

export const updateClinicStatus = mutation({
  args: {
    clinicId: v.id("clinics"),
    status: clinicStatusValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    const now = Date.now();
    const previousStatus = clinic.status;
    const gracePeriodEndsAt =
      args.status === "past_due"
        ? now + GRACE_PERIOD_MS
        : args.status === "active"
          ? undefined
          : clinic.gracePeriodEndsAt;

    await ctx.db.patch(args.clinicId, {
      status: args.status,
      gracePeriodEndsAt,
      updatedAt: now,
    });

    if (
      (args.status === "past_due" || args.status === "suspended") &&
      previousStatus !== args.status &&
      clinic.email
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendSubscriptionStatusAlert,
        {
          clinicId: clinic._id,
          clinicName: clinic.name,
          clinicEmail: clinic.email,
          newStatus: args.status,
          subscriptionEndsAt: clinic.subscriptionEndsAt,
          gracePeriodEndsAt,
        }
      );
    }

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType:
        args.status === "suspended"
          ? "CLINIC_SUSPENDED"
          : "CLINIC_STATUS_CHANGED",
      targetEntity: "clinics",
      targetId: args.clinicId,
      metadata: {
        clinicName: clinic.name,
        previousStatus,
        newStatus: args.status,
        reason: args.reason?.trim() || null,
      },
    });

    return {
      clinicId: args.clinicId,
      status: args.status,
      isSubscriptionExpired: args.status === "active" && clinic.subscriptionEndsAt < now,
    };
  },
});

export const changeClinicPlan = mutation({
  args: {
    clinicId: v.id("clinics"),
    planId: v.id("subscriptionPlans"),
    billingCycle: billingCycleValidator,
    syncDefaultFeatures: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const [clinic, newPlan] = await Promise.all([
      ctx.db.get(args.clinicId),
      ctx.db.get(args.planId),
    ]);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }
    if (!newPlan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Target subscription plan not found.",
      });
    }

    const previousPlan = await ctx.db.get(clinic.planId);
    const now = Date.now();

    await ctx.db.patch(args.clinicId, {
      planId: newPlan._id,
      billingCycle: args.billingCycle,
      featureFlags: args.syncDefaultFeatures
        ? { ...newPlan.defaultFeatures }
        : clinic.featureFlags,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_PLAN_CHANGED",
      targetEntity: "clinics",
      targetId: args.clinicId,
      metadata: {
        clinicName: clinic.name,
        previousPlanCode: previousPlan?.code ?? null,
        newPlanCode: newPlan.code,
        billingCycle: args.billingCycle,
        syncDefaultFeatures: Boolean(args.syncDefaultFeatures),
      },
    });

    return { clinicId: args.clinicId, planCode: newPlan.code };
  },
});

export const updateClinicFeatures = mutation({
  args: {
    clinicId: v.id("clinics"),
    featureFlags: featureFlagsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    await ctx.db.patch(args.clinicId, {
      featureFlags: args.featureFlags,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_FEATURES_UPDATED",
      targetEntity: "clinics",
      targetId: args.clinicId,
      metadata: {
        clinicName: clinic.name,
        previousFlags: clinic.featureFlags,
        newFlags: args.featureFlags,
      },
    });

    return { clinicId: args.clinicId };
  },
});

export const inviteClinicAdmin = mutation({
  args: {
    clinicId: v.id("clinics"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide a valid Clinic Admin email address.",
      });
    }

    const now = Date.now();
    const existingPending = await ctx.db
      .query("staffInvitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending")
      )
      .collect();

    for (const inv of existingPending) {
      if (inv.clinicId === args.clinicId) {
        await ctx.db.patch(inv._id, { status: "revoked" });
      }
    }

    const token = generateInviteToken();
    const invitationId = await ctx.db.insert("staffInvitations", {
      clinicId: args.clinicId,
      email,
      role: "clinic_admin",
      token,
      invitedByUserId: actor._id,
      status: "pending",
      emailStatus: "queued",
      expiresAt: now + 7 * DAY_MS,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendRoleInvitationEmail,
      { invitationId }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_ADMIN_INVITED",
      targetEntity: "staffInvitations",
      targetId: invitationId,
      metadata: { clinicName: clinic.name, email },
    });

    return { invitationId, token };
  },
});

export const revokeInvitation = mutation({
  args: {
    invitationId: v.id("staffInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    }

    await ctx.db.patch(args.invitationId, { status: "revoked" });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: invitation.clinicId,
      actionType: "CLINIC_ADMIN_INVITE_REVOKED",
      targetEntity: "staffInvitations",
      targetId: args.invitationId,
      metadata: { email: invitation.email, role: invitation.role },
    });

    return { invitationId: args.invitationId };
  },
});

export const updateClinicDetails = mutation({
  args: {
    clinicId: v.id("clinics"),
    name: v.string(),
    tagline: v.optional(v.string()),
    primaryColorHex: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    province: v.string(),
    timezone: v.optional(v.string()),
    slotIntervalMinutes: v.optional(v.number()),
    cancellationWindowHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    const primaryColorHex = HEX_COLOR_REGEX.test(args.primaryColorHex.trim())
      ? args.primaryColorHex.trim()
      : clinic.primaryColorHex;

    if (name.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Clinic name must be at least 2 characters.",
      });
    }

    await ctx.db.patch(args.clinicId, {
      name,
      tagline: args.tagline?.trim() || undefined,
      primaryColorHex,
      email,
      phone: args.phone.trim(),
      address: args.address.trim(),
      city: args.city.trim(),
      province: args.province.trim(),
      timezone: args.timezone?.trim() || clinic.timezone,
      slotIntervalMinutes:
        args.slotIntervalMinutes === 15
          ? 15
          : args.slotIntervalMinutes === 30
            ? 30
            : clinic.slotIntervalMinutes,
      cancellationWindowHours:
        args.cancellationWindowHours !== undefined
          ? Math.max(0, Math.min(168, Math.round(args.cancellationWindowHours)))
          : clinic.cancellationWindowHours,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_DETAILS_UPDATED",
      targetEntity: "clinics",
      targetId: args.clinicId,
      metadata: {
        previousName: clinic.name,
        newName: name,
        city: args.city.trim(),
        province: args.province.trim(),
      },
    });

    return { clinicId: args.clinicId };
  },
});

export const extendClinicSubscription = mutation({
  args: {
    clinicId: v.id("clinics"),
    extraDays: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }

    const days = Math.round(args.extraDays);
    if (days < 1 || days > 365) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Extension must be between 1 and 365 days.",
      });
    }

    const now = Date.now();
    const baseEnd = Math.max(clinic.subscriptionEndsAt, now);
    const nextEnd = baseEnd + days * DAY_MS;

    await ctx.db.patch(args.clinicId, {
      subscriptionEndsAt: nextEnd,
      trialEndsAt:
        clinic.status === "trial" ? nextEnd : clinic.trialEndsAt,
      status: clinic.status === "past_due" ? "active" : clinic.status,
      gracePeriodEndsAt:
        clinic.status === "past_due" ? undefined : clinic.gracePeriodEndsAt,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_SUBSCRIPTION_EXTENDED",
      targetEntity: "clinics",
      targetId: args.clinicId,
      metadata: {
        clinicName: clinic.name,
        extraDays: days,
        previousEndsAt: clinic.subscriptionEndsAt,
        newEndsAt: nextEnd,
        reason: args.reason?.trim() || null,
      },
    });

    return { clinicId: args.clinicId, subscriptionEndsAt: nextEnd };
  },
});

export const sendRenewalReminder = mutation({
  args: {
    clinicId: v.id("clinics"),
    customNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }
    if (!clinic.email?.trim()) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "This clinic has no contact email configured.",
      });
    }

    const plan = await ctx.db.get(clinic.planId);
    const amountPhp =
      clinic.billingCycle === "annual"
        ? (plan?.annualPricePhp ?? 0)
        : (plan?.monthlyPricePhp ?? 0);

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendClinicRenewalReminderEmail,
      {
        clinicId: clinic._id,
        clinicName: clinic.name,
        clinicEmail: clinic.email,
        clinicTimezone: clinic.timezone,
        planName: plan?.name ?? "Smile Plan",
        status: clinic.status,
        amountPhp,
        billingCycle: clinic.billingCycle,
        subscriptionEndsAt: clinic.subscriptionEndsAt,
        customNote: args.customNote?.trim() || undefined,
      }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: clinic._id,
      actionType: "SUBSCRIPTION_RENEWAL_REMINDER_SENT",
      targetEntity: "clinics",
      targetId: clinic._id,
      metadata: {
        clinicName: clinic.name,
        sentTo: clinic.email,
        status: clinic.status,
        subscriptionEndsAt: clinic.subscriptionEndsAt,
      },
    });

    return { clinicId: clinic._id, sentTo: clinic.email };
  },
});

export const listAnnouncements = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const items = args.activeOnly
      ? await ctx.db
        .query("systemAnnouncements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .order("desc")
        .collect()
      : await ctx.db.query("systemAnnouncements").order("desc").collect();

    return items;
  },
});

export const createAnnouncement = mutation({
  args: {
    title: v.string(),
    message: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
    targetAudience: v.union(
      v.literal("all_clinic_staff"),
      v.literal("clinic_admins_only"),
      v.literal("all_users")
    ),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const title = args.title.trim();
    const message = args.message.trim();
    if (!title || !message) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Announcement title and message are required.",
      });
    }

    const announcementId = await ctx.db.insert("systemAnnouncements", {
      title,
      message,
      severity: args.severity,
      targetAudience: args.targetAudience,
      isActive: true,
      expiresAt: args.expiresAt,
      createdByUserId: actor._id,
      createdAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "ANNOUNCEMENT_CREATED",
      targetEntity: "systemAnnouncements",
      targetId: announcementId,
      metadata: { title, severity: args.severity, targetAudience: args.targetAudience },
    });

    return { announcementId };
  },
});

export const toggleAnnouncement = mutation({
  args: {
    announcementId: v.id("systemAnnouncements"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const existing = await ctx.db.get(args.announcementId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Announcement not found.",
      });
    }

    await ctx.db.patch(args.announcementId, { isActive: args.isActive });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "ANNOUNCEMENT_UPDATED",
      targetEntity: "systemAnnouncements",
      targetId: args.announcementId,
      metadata: { title: existing.title, isActive: args.isActive },
    });

    return { announcementId: args.announcementId, isActive: args.isActive };
  },
});

export const updateAnnouncement = mutation({
  args: {
    announcementId: v.id("systemAnnouncements"),
    title: v.string(),
    message: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
    targetAudience: v.union(
      v.literal("all_clinic_staff"),
      v.literal("clinic_admins_only"),
      v.literal("all_users")
    ),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const existing = await ctx.db.get(args.announcementId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Announcement not found.",
      });
    }

    const title = args.title.trim();
    const message = args.message.trim();
    if (!title || !message) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Announcement title and message are required.",
      });
    }

    await ctx.db.patch(args.announcementId, {
      title,
      message,
      severity: args.severity,
      targetAudience: args.targetAudience,
      expiresAt: args.expiresAt,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "ANNOUNCEMENT_EDITED",
      targetEntity: "systemAnnouncements",
      targetId: args.announcementId,
      metadata: {
        title,
        severity: args.severity,
        targetAudience: args.targetAudience,
        expiresAt: args.expiresAt ?? null,
      },
    });

    return { announcementId: args.announcementId };
  },
});

export const deleteAnnouncement = mutation({
  args: {
    announcementId: v.id("systemAnnouncements"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const existing = await ctx.db.get(args.announcementId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Announcement not found.",
      });
    }

    await ctx.db.delete(args.announcementId);

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "ANNOUNCEMENT_DELETED",
      targetEntity: "systemAnnouncements",
      targetId: args.announcementId,
      metadata: { title: existing.title, targetAudience: existing.targetAudience },
    });

    return { announcementId: args.announcementId };
  },
});

export const triggerDailyRollup = mutation({
  args: {
    targetDateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);
    const dateKey = args.targetDateKey?.trim() || toManilaDateKey(Date.now());

    const result: { dateKey: string; clinicsRolledUp: number } =
      await ctx.runMutation(internal.cronJobs.rollupDailyAnalytics, {
        targetDateKey: dateKey,
      });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "PLATFORM_ROLLUP_TRIGGERED",
      targetEntity: "platformMetricsDaily",
      targetId: result.dateKey,
      metadata: {
        dateKey: result.dateKey,
        clinicsRolledUp: result.clinicsRolledUp,
      },
    });

    return result;
  },
});

export const ensureDefaultPlans = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSuperAdmin(ctx);
    const result: { plansCreated: number } = await ctx.runMutation(
      internal.seed.initializePlatform,
      {}
    );

    if (result.plansCreated > 0) {
      await recordAuditLog(ctx, {
        actorUserId: actor._id,
        actorRole: actor.role,
        actionType: "DEFAULT_PLANS_SEEDED",
        targetEntity: "subscriptionPlans",
        targetId: "seed",
        metadata: { plansCreated: result.plansCreated },
      });
    }

    return result;
  },
});

export const listAuditActors = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const [superAdmins, clinicAdmins, dentists, receptionists] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "super_admin"))
        .take(20),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "clinic_admin"))
        .take(100),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "dentist"))
        .take(100),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "receptionist"))
        .take(100),
    ]);

    return [...superAdmins, ...clinicAdmins, ...dentists, ...receptionists].map(
      (u) => ({
        _id: u._id,
        name: `${u.firstName} ${u.lastName}`.trim() || u.email,
        email: u.email,
        role: u.role,
      })
    );
  },
});

export const listAuditLogsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    clinicId: v.optional(v.id("clinics")),
    actorUserId: v.optional(v.id("users")),
    actionType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const result = args.clinicId
      ? await ctx.db
        .query("platformAuditLogs")
        .withIndex("by_clinic_and_date", (q) => q.eq("clinicId", args.clinicId))
        .order("desc")
        .paginate(args.paginationOpts)
      : args.actorUserId
        ? await ctx.db
          .query("platformAuditLogs")
          .withIndex("by_actor", (q) => q.eq("actorUserId", args.actorUserId!))
          .order("desc")
          .paginate(args.paginationOpts)
        : await ctx.db
          .query("platformAuditLogs")
          .withIndex("by_created_at")
          .order("desc")
          .paginate(args.paginationOpts);

    const actionFilter = args.actionType?.trim();
    const filtered = result.page.filter((log) => {
      if (args.clinicId && args.actorUserId && log.actorUserId !== args.actorUserId) {
        return false;
      }
      if (actionFilter && log.actionType !== actionFilter) {
        return false;
      }
      return true;
    });

    const actorIds = Array.from(new Set(filtered.map((l) => l.actorUserId)));
    const clinicIds = Array.from(
      new Set(
        filtered
          .map((l) => l.clinicId)
          .filter((id): id is Id<"clinics"> => id !== undefined)
      )
    );

    const [actors, clinics] = await Promise.all([
      Promise.all(actorIds.map((id) => ctx.db.get(id))),
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
    ]);

    const actorMap = new Map(
      actors
        .filter((u): u is Doc<"users"> => u !== null)
        .map((u) => [u._id, u])
    );
    const clinicMap = new Map(
      clinics
        .filter((c): c is Doc<"clinics"> => c !== null)
        .map((c) => [c._id, c])
    );

    return {
      ...result,
      page: filtered.map((log) => {
        const actor = actorMap.get(log.actorUserId);
        const clinic = log.clinicId ? clinicMap.get(log.clinicId) : null;
        return {
          ...log,
          actorName: actor
            ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email
            : "Unknown User",
          actorEmail: actor?.email ?? "",
          clinicName: clinic?.name ?? null,
        };
      }),
    };
  },
});

export const listAuditLogs = query({
  args: {
    clinicId: v.optional(v.id("clinics")),
    actionType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const takeLimit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const logs = args.clinicId
      ? await ctx.db
        .query("platformAuditLogs")
        .withIndex("by_clinic_and_date", (q) => q.eq("clinicId", args.clinicId))
        .order("desc")
        .take(takeLimit)
      : await ctx.db
        .query("platformAuditLogs")
        .withIndex("by_created_at")
        .order("desc")
        .take(takeLimit);

    const actionFilter = args.actionType?.trim();
    const filtered = actionFilter
      ? logs.filter((l) => l.actionType === actionFilter)
      : logs;

    const actorIds = Array.from(new Set(filtered.map((l) => l.actorUserId)));
    const clinicIds = Array.from(
      new Set(
        filtered
          .map((l) => l.clinicId)
          .filter((id): id is Id<"clinics"> => id !== undefined)
      )
    );

    const [actors, clinics] = await Promise.all([
      Promise.all(actorIds.map((id) => ctx.db.get(id))),
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
    ]);

    const actorMap = new Map(
      actors
        .filter((u): u is Doc<"users"> => u !== null)
        .map((u) => [u._id, u])
    );
    const clinicMap = new Map(
      clinics
        .filter((c): c is Doc<"clinics"> => c !== null)
        .map((c) => [c._id, c])
    );

    return filtered.map((log) => {
      const actor = actorMap.get(log.actorUserId);
      const clinic = log.clinicId ? clinicMap.get(log.clinicId) : null;
      return {
        ...log,
        actorName: actor
          ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email
          : "Unknown User",
        actorEmail: actor?.email ?? "",
        clinicName: clinic?.name ?? null,
      };
    });
  },
});

const assignableRoleValidator = v.union(
  v.literal("super_admin"),
  v.literal("clinic_admin"),
  v.literal("dentist"),
  v.literal("receptionist")
);

const allRoleValidator = v.union(
  v.literal("super_admin"),
  v.literal("clinic_admin"),
  v.literal("dentist"),
  v.literal("receptionist"),
  v.literal("patient")
);

export const listAllUsers = query({
  args: {
    role: v.optional(allRoleValidator),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const rows = args.role
      ? await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", args.role!))
        .order("desc")
        .take(250)
      : await ctx.db.query("users").order("desc").take(250);

    const term = args.search?.trim().toLowerCase();
    const filtered: Doc<"users">[] = [];
    for (const u of rows) {
      if (
        term &&
        !u.email.toLowerCase().includes(term) &&
        !`${u.firstName} ${u.lastName}`.toLowerCase().includes(term)
      ) {
        continue;
      }
      filtered.push(u);
    }

    const clinicIds = Array.from(
      new Set(
        filtered
          .map((u) => u.clinicId)
          .filter((id): id is Id<"clinics"> => id !== undefined)
      )
    );
    const clinics = await Promise.all(clinicIds.map((id) => ctx.db.get(id)));
    const clinicMap = new Map(
      clinics
        .filter((c): c is Doc<"clinics"> => c !== null)
        .map((c) => [c._id, c])
    );

    const rootOwnerEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

    return {
      callerIsRootOwner: isRootSuperAdmin(actor),
      callerUserId: actor._id,
      users: filtered.map((u) => {
        const clinic = u.clinicId ? clinicMap.get(u.clinicId) : null;
        return {
          _id: u._id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          clinicId: u.clinicId ?? null,
          clinicName: clinic?.name ?? null,
          clinicSlug: clinic?.slug ?? null,
          isActive: u.isActive,
          isRootOwner: Boolean(
            rootOwnerEmail && u.email.trim().toLowerCase() === rootOwnerEmail
          ),
          lastLoginAt: u.lastLoginAt ?? null,
          createdAt: u.createdAt,
        };
      }),
    };
  },
});

export const listAllInvitations = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("revoked")
      )
    ),
    role: v.optional(assignableRoleValidator),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const rows = args.status
      ? await ctx.db
        .query("staffInvitations")
        .withIndex("by_status_and_created", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(200)
      : await ctx.db.query("staffInvitations").order("desc").take(200);

    const term = args.search?.trim().toLowerCase();
    const filtered: Doc<"staffInvitations">[] = [];
    for (const inv of rows) {
      if (args.role && inv.role !== args.role) continue;
      if (term && !inv.email.toLowerCase().includes(term)) continue;
      filtered.push(inv);
    }

    const clinicIds = Array.from(
      new Set(
        filtered
          .map((i) => i.clinicId)
          .filter((id): id is Id<"clinics"> => id !== undefined)
      )
    );
    const inviterIds = Array.from(new Set(filtered.map((i) => i.invitedByUserId)));

    const [clinics, inviters] = await Promise.all([
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
      Promise.all(inviterIds.map((id) => ctx.db.get(id))),
    ]);

    const clinicMap = new Map(
      clinics
        .filter((c): c is Doc<"clinics"> => c !== null)
        .map((c) => [c._id, c])
    );
    const inviterMap = new Map(
      inviters
        .filter((u): u is Doc<"users"> => u !== null)
        .map((u) => [u._id, u])
    );

    return filtered.map((inv) => {
      const clinic = inv.clinicId ? clinicMap.get(inv.clinicId) : null;
      const inviter = inviterMap.get(inv.invitedByUserId);
      return {
        _id: inv._id,
        email: inv.email,
        role: inv.role,
        token: inv.token ?? null,
        inviterNote: inv.inviterNote ?? null,
        status: inv.status,
        declineReason: inv.declineReason ?? null,
        emailStatus: inv.emailStatus ?? "skipped",
        emailError: inv.emailError ?? null,
        clinicId: inv.clinicId ?? null,
        clinicName: clinic?.name ?? null,
        clinicColorHex: clinic?.primaryColorHex ?? "#6C5CE7",
        inviterName: inviter
          ? `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email
          : "Smile Admin",
        expiresAt: inv.expiresAt,
        respondedAt: inv.respondedAt ?? null,
        createdAt: inv.createdAt,
      };
    });
  },
});

export const createRoleInvitation = mutation({
  args: {
    email: v.string(),
    role: assignableRoleValidator,
    clinicId: v.optional(v.id("clinics")),
    inviterNote: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const email = args.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Enter a valid email address.",
      });
    }

    if (args.role === "super_admin" && !isRootSuperAdmin(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Only the primary Platform Owner may send Super Admin invitations.",
      });
    }

    let clinic: Doc<"clinics"> | null = null;
    if (args.role !== "super_admin") {
      if (!args.clinicId) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Select a dental clinic for this staff role.",
        });
      }
      clinic = await ctx.db.get(args.clinicId);
      if (!clinic) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Selected dental clinic was not found.",
        });
      }
    }

    const now = Date.now();
    const expiresDays = Math.min(Math.max(Math.round(args.expiresInDays ?? 7), 1), 30);

    // Revoke any older pending invitations for the same email to keep one active invite link
    const existingPending = await ctx.db
      .query("staffInvitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending")
      )
      .take(20);
    for (const old of existingPending) {
      await ctx.db.patch(old._id, { status: "revoked" });
    }

    const token = generateInviteToken();
    const invitationId = await ctx.db.insert("staffInvitations", {
      clinicId: clinic?._id,
      email,
      role: args.role,
      token,
      inviterNote: args.inviterNote?.trim() || undefined,
      invitedByUserId: actor._id,
      status: "pending",
      emailStatus: "queued",
      expiresAt: now + expiresDays * DAY_MS,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendRoleInvitationEmail,
      { invitationId }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: clinic?._id,
      actionType: "ROLE_INVITATION_SENT",
      targetEntity: "staffInvitations",
      targetId: invitationId,
      metadata: {
        email,
        role: args.role,
        clinicName: clinic?.name ?? "Platform-wide",
        expiresInDays: expiresDays,
      },
    });

    return { invitationId, token };
  },
});

export const resendInvitation = mutation({
  args: {
    invitationId: v.id("staffInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    }

    if (invitation.role === "super_admin" && !isRootSuperAdmin(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the primary Platform Owner may resend Super Admin invitations.",
      });
    }

    if (invitation.status === "accepted") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "This invitation has already been accepted.",
      });
    }

    const now = Date.now();
    const token = invitation.token ?? generateInviteToken();

    await ctx.db.patch(args.invitationId, {
      token,
      status: "pending",
      declineReason: undefined,
      respondedAt: undefined,
      emailStatus: "queued",
      emailError: undefined,
      expiresAt: now + 7 * DAY_MS,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendRoleInvitationEmail,
      { invitationId: args.invitationId }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: invitation.clinicId,
      actionType: "ROLE_INVITATION_RESENT",
      targetEntity: "staffInvitations",
      targetId: args.invitationId,
      metadata: { email: invitation.email, role: invitation.role },
    });

    return { invitationId: args.invitationId, token };
  },
});

export const updateUserRoleOrStatus = mutation({
  args: {
    userId: v.id("users"),
    role: v.optional(allRoleValidator),
    clinicId: v.optional(v.union(v.id("clinics"), v.null())),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
    }

    const rootEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const targetIsRoot = Boolean(
      rootEmail && target.email.trim().toLowerCase() === rootEmail
    );

    if (targetIsRoot && (args.isActive === false || (args.role && args.role !== "super_admin"))) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "The primary Platform Owner account cannot be demoted or deactivated.",
      });
    }

    const nextRole = args.role ?? target.role;
    const touchesSuperAdmin =
      target.role === "super_admin" || nextRole === "super_admin";
    if (touchesSuperAdmin && !isRootSuperAdmin(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Only the primary Platform Owner may grant, modify, or revoke Super Admin privileges.",
      });
    }

    let nextClinicId: Id<"clinics"> | undefined =
      args.clinicId === undefined
        ? target.clinicId
        : args.clinicId === null
          ? undefined
          : args.clinicId;

    if (nextRole === "super_admin" || nextRole === "patient") {
      nextClinicId = undefined;
    } else if (!nextClinicId) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Staff roles require an assigned dental clinic.",
      });
    }

    const nextActive = args.isActive ?? target.isActive;

    await ctx.db.patch(args.userId, {
      role: nextRole,
      clinicId: nextClinicId,
      isActive: nextActive,
    });

    await ctx.scheduler.runAfter(0, internal.invitations.syncClerkRoleMetadata, {
      clerkId: target.clerkId,
      role: nextRole,
      clinicId: nextClinicId ?? null,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: nextClinicId,
      actionType: "USER_ROLE_UPDATED",
      targetEntity: "users",
      targetId: args.userId,
      metadata: {
        email: target.email,
        previousRole: target.role,
        newRole: nextRole,
        previousActive: target.isActive,
        newActive: nextActive,
        clinicId: nextClinicId ?? null,
      },
    });

    return { userId: args.userId, role: nextRole, isActive: nextActive };
  },
});
