import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { recordAuditLog } from "./lib/audit";
import { requireSuperAdmin } from "./lib/permissions";

const MAX_RECEIPT_BYTES = 1024 * 1024; // 1 MB server-side cap for receipts (PDFs/images)

const planCodeValidator = v.union(
  v.literal("trial"),
  v.literal("starter"),
  v.literal("pro"),
  v.literal("enterprise")
);

const paymentMethodValidator = v.union(
  v.literal("gcash"),
  v.literal("maya"),
  v.literal("bank_transfer"),
  v.literal("card"),
  v.literal("cash"),
  v.literal("manual_waiver")
);

const paymentStatusValidator = v.union(
  v.literal("paid"),
  v.literal("pending"),
  v.literal("overdue"),
  v.literal("refunded")
);

const featureFlagsValidator = v.object({
  odontogramEnabled: v.boolean(),
  xrayStorageEnabled: v.boolean(),
  waitlistAutomationEnabled: v.boolean(),
  recallAutomationEnabled: v.boolean(),
  customBrandingEnabled: v.boolean(),
});

export const listPlans = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const plans = await ctx.db.query("subscriptionPlans").collect();
    plans.sort((a, b) => a.monthlyPricePhp - b.monthlyPricePhp);
    return plans;
  },
});

export const upsertPlan = mutation({
  args: {
    planId: v.optional(v.id("subscriptionPlans")),
    code: planCodeValidator,
    name: v.string(),
    description: v.string(),
    monthlyPricePhp: v.number(),
    annualPricePhp: v.number(),
    trialDays: v.number(),
    maxDentists: v.number(),
    maxChairs: v.number(),
    maxAppointmentsPerMonth: v.number(),
    maxStorageBytes: v.number(),
    maxEmailsPerMonth: v.number(),
    defaultFeatures: featureFlagsValidator,
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    if (
      args.monthlyPricePhp < 0 ||
      args.annualPricePhp < 0 ||
      args.trialDays < 0 ||
      args.maxDentists < 1 ||
      args.maxChairs < 1 ||
      args.maxAppointmentsPerMonth < 1 ||
      args.maxStorageBytes <= 0 ||
      args.maxEmailsPerMonth <= 0
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Prices and trial days must be non-negative and all resource quotas must be positive.",
      });
    }

    const payload = {
      code: args.code,
      name: args.name.trim(),
      description: args.description.trim(),
      monthlyPricePhp: args.monthlyPricePhp,
      annualPricePhp: args.annualPricePhp,
      trialDays: args.trialDays,
      maxDentists: args.maxDentists,
      maxChairs: args.maxChairs,
      maxAppointmentsPerMonth: args.maxAppointmentsPerMonth,
      maxStorageBytes: args.maxStorageBytes,
      maxEmailsPerMonth: args.maxEmailsPerMonth,
      defaultFeatures: args.defaultFeatures,
      isActive: args.isActive,
    };

    if (args.planId) {
      const existing = await ctx.db.get(args.planId);
      if (!existing) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Subscription plan not found.",
        });
      }
      await ctx.db.patch(args.planId, payload);
      await recordAuditLog(ctx, {
        actorUserId: actor._id,
        actorRole: actor.role,
        actionType: "SUBSCRIPTION_PLAN_UPDATED",
        targetEntity: "subscriptionPlans",
        targetId: args.planId,
        metadata: { code: args.code, name: payload.name, monthlyPricePhp: payload.monthlyPricePhp },
      });
      return { planId: args.planId };
    }

    const duplicate = await ctx.db
      .query("subscriptionPlans")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (duplicate) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `A subscription plan with code "${args.code}" already exists.`,
      });
    }

    const planId = await ctx.db.insert("subscriptionPlans", payload);
    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      actionType: "SUBSCRIPTION_PLAN_CREATED",
      targetEntity: "subscriptionPlans",
      targetId: planId,
      metadata: { code: args.code, name: payload.name, monthlyPricePhp: payload.monthlyPricePhp },
    });

    return { planId };
  },
});

export const listPayments = query({
  args: {
    clinicId: v.optional(v.id("clinics")),
    status: v.optional(paymentStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const takeLimit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const payments = args.clinicId
      ? await ctx.db
          .query("subscriptionPayments")
          .withIndex("by_clinic", (q) => q.eq("clinicId", args.clinicId!))
          .order("desc")
          .take(takeLimit)
      : args.status
        ? await ctx.db
            .query("subscriptionPayments")
            .withIndex("by_status", (q) => q.eq("status", args.status!))
            .order("desc")
            .take(takeLimit)
        : await ctx.db
            .query("subscriptionPayments")
            .order("desc")
            .take(takeLimit);

    const filtered =
      args.clinicId && args.status
        ? payments.filter((p) => p.status === args.status)
        : payments;

    const clinicIds = Array.from(new Set(filtered.map((p) => p.clinicId)));
    const planIds = Array.from(new Set(filtered.map((p) => p.planId)));

    const [clinics, plans] = await Promise.all([
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
      Promise.all(planIds.map((id) => ctx.db.get(id))),
    ]);

    const clinicMap = new Map<Id<"clinics">, Doc<"clinics">>(
      clinics
        .filter((c): c is Doc<"clinics"> => c !== null)
        .map((c) => [c._id, c])
    );
    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      plans
        .filter((p): p is Doc<"subscriptionPlans"> => p !== null)
        .map((p) => [p._id, p])
    );

    return Promise.all(
      filtered.map(async (payment) => {
        const clinic = clinicMap.get(payment.clinicId);
        const plan = planMap.get(payment.planId);
        const receiptUrl = payment.receiptStorageId
          ? await ctx.storage.getUrl(payment.receiptStorageId)
          : null;
        return {
          ...payment,
          clinicName: clinic?.name ?? "Deleted Clinic",
          clinicSlug: clinic?.slug ?? "",
          planName: plan?.name ?? "Unknown Plan",
          planCode: plan?.code ?? "starter",
          receiptUrl,
        };
      })
    );
  },
});

export const recordPayment = mutation({
  args: {
    clinicId: v.id("clinics"),
    planId: v.id("subscriptionPlans"),
    amountPhp: v.number(),
    billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
    paymentMethod: paymentMethodValidator,
    referenceNumber: v.optional(v.string()),
    receiptStorageId: v.optional(v.id("_storage")),
    periodStart: v.number(),
    periodEnd: v.number(),
    status: paymentStatusValidator,
    notes: v.optional(v.string()),
    syncDefaultFeatures: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const [clinic, plan] = await Promise.all([
      ctx.db.get(args.clinicId),
      ctx.db.get(args.planId),
    ]);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }
    if (!plan) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Subscription plan not found.",
      });
    }
    if (args.amountPhp < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Payment amount cannot be negative.",
      });
    }
    if (args.periodEnd <= args.periodStart) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Billing period end must be after period start.",
      });
    }

    const receiptMeta = args.receiptStorageId
      ? await ctx.db.system.get("_storage", args.receiptStorageId)
      : null;
    if (args.receiptStorageId && !receiptMeta) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Uploaded receipt could not be verified in storage.",
      });
    }
    const receiptBytes = receiptMeta?.size ?? 0;
    if (args.receiptStorageId && receiptBytes > MAX_RECEIPT_BYTES) {
      try {
        await ctx.storage.delete(args.receiptStorageId);
      } catch {
        // Ignore cleanup failure
      }
      throw new ConvexError({
        code: "FILE_TOO_LARGE",
        message: "Uploaded receipt exceeded the 1 MB limit and was discarded.",
      });
    }

    const now = Date.now();
    const year = new Date(now).getUTCFullYear();
    const latestPayment = await ctx.db
      .query("subscriptionPayments")
      .order("desc")
      .first();
    const lastSeqMatch = latestPayment?.invoiceNumber.match(/^INV-(\d{4})-(\d+)$/);
    const nextSeq =
      lastSeqMatch && Number(lastSeqMatch[1]) === year
        ? Number(lastSeqMatch[2]) + 1
        : 1;
    const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(5, "0")}`;

    const paymentId = await ctx.db.insert("subscriptionPayments", {
      clinicId: args.clinicId,
      planId: args.planId,
      invoiceNumber,
      amountPhp: args.amountPhp,
      billingCycle: args.billingCycle,
      paymentMethod: args.paymentMethod,
      referenceNumber: args.referenceNumber?.trim() || undefined,
      receiptStorageId: args.receiptStorageId,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      status: args.status,
      notes: args.notes?.trim() || undefined,
      recordedByUserId: actor._id,
      paidAt: args.status === "paid" ? now : undefined,
      createdAt: now,
    });

    if (args.status === "paid") {
      // Preserve custom per-clinic feature overrides on same-plan renewals unless explicitly synced
      const shouldSyncFeatures =
        args.syncDefaultFeatures !== undefined
          ? args.syncDefaultFeatures
          : args.planId !== clinic.planId;
      await ctx.db.patch(args.clinicId, {
        planId: args.planId,
        billingCycle: args.billingCycle,
        status: "active",
        subscriptionStartsAt: Math.min(clinic.subscriptionStartsAt, args.periodStart),
        subscriptionEndsAt: Math.max(clinic.subscriptionEndsAt, args.periodEnd),
        gracePeriodEndsAt: undefined,
        featureFlags: shouldSyncFeatures
          ? { ...plan.defaultFeatures }
          : clinic.featureFlags,
        storageUsedBytes: clinic.storageUsedBytes + receiptBytes,
        updatedAt: now,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendSubscriptionReceiptEmail,
        { paymentId }
      );
    } else if (receiptBytes > 0) {
      await ctx.db.patch(args.clinicId, {
        storageUsedBytes: clinic.storageUsedBytes + receiptBytes,
        updatedAt: now,
      });
    }

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: args.clinicId,
      actionType:
        args.status === "paid"
          ? "SUBSCRIPTION_RENEWED"
          : "SUBSCRIPTION_PAYMENT_RECORDED",
      targetEntity: "subscriptionPayments",
      targetId: paymentId,
      metadata: {
        invoiceNumber,
        clinicName: clinic.name,
        planCode: plan.code,
        amountPhp: args.amountPhp,
        paymentMethod: args.paymentMethod,
        status: args.status,
      },
    });

    return { paymentId, invoiceNumber };
  },
});

export const updatePaymentStatus = mutation({
  args: {
    paymentId: v.id("subscriptionPayments"),
    status: paymentStatusValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Payment record not found.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.paymentId, {
      status: args.status,
      paidAt: args.status === "paid" ? payment.paidAt ?? now : payment.paidAt,
      notes: args.notes !== undefined ? args.notes.trim() || undefined : payment.notes,
    });

    if (args.status === "paid" && payment.status !== "paid") {
      const [clinic, plan] = await Promise.all([
        ctx.db.get(payment.clinicId),
        ctx.db.get(payment.planId),
      ]);
      if (clinic && plan) {
        await ctx.db.patch(clinic._id, {
          planId: plan._id,
          billingCycle: payment.billingCycle,
          status: "active",
          subscriptionEndsAt: Math.max(clinic.subscriptionEndsAt, payment.periodEnd),
          gracePeriodEndsAt: undefined,
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendSubscriptionReceiptEmail,
        { paymentId: args.paymentId }
      );
    }

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId: payment.clinicId,
      actionType: "SUBSCRIPTION_PAYMENT_STATUS_UPDATED",
      targetEntity: "subscriptionPayments",
      targetId: args.paymentId,
      metadata: {
        invoiceNumber: payment.invoiceNumber,
        previousStatus: payment.status,
        newStatus: args.status,
      },
    });

    return { paymentId: args.paymentId, status: args.status };
  },
});

export const generateReceiptUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getReceiptUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});
