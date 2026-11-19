import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  DAY_MS,
  GRACE_PERIOD_MS,
  recordAuditLog,
  toManilaMonthKey,
} from "./lib/audit";
import { requireSuperAdmin } from "./lib/permissions";
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
          .collect()
      : await ctx.db.query("clinics").collect();

    const plans = await ctx.db.query("subscriptionPlans").collect();
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
      activeChairCount: 0,
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
    if (inviteEmail) {
      await ctx.db.insert("staffInvitations", {
        clinicId,
        email: inviteEmail,
        role: "clinic_admin",
        invitedByUserId: actor._id,
        status: "pending",
        expiresAt: now + 7 * DAY_MS,
        createdAt: now,
      });
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
      },
    });

    return { clinicId, slug };
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

    return { clinicId: args.clinicId, status: args.status };
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

    const invitationId = await ctx.db.insert("staffInvitations", {
      clinicId: args.clinicId,
      email,
      role: "clinic_admin",
      invitedByUserId: actor._id,
      status: "pending",
      expiresAt: now + 7 * DAY_MS,
      createdAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType: "CLINIC_ADMIN_INVITED",
      targetEntity: "staffInvitations",
      targetId: invitationId,
      metadata: { clinicName: clinic.name, email },
    });

    return { invitationId };
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
