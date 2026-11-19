import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { DAY_MS, recordAuditLog, toManilaDateKey } from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  type ClinicResourceType,
  requireClinicAccess,
} from "./lib/permissions";
import { DEFAULT_SERVICE_CATALOG } from "./lib/serviceCatalog";

const weeklyScheduleDayValidator = v.object({
  dayOfWeek: v.number(),
  isWorking: v.boolean(),
  startMinute: v.number(),
  endMinute: v.number(),
  breakStartMinute: v.optional(v.number()),
  breakEndMinute: v.optional(v.number()),
});

const operatingHoursDayValidator = v.object({
  dayOfWeek: v.number(),
  isOpen: v.boolean(),
  openMinute: v.number(),
  closeMinute: v.number(),
});

const serviceCategoryValidator = v.union(
  v.literal("Preventive"),
  v.literal("Restorative"),
  v.literal("Cosmetic"),
  v.literal("Orthodontics"),
  v.literal("Endodontics"),
  v.literal("Oral Surgery"),
  v.literal("Emergency")
);

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Guard for all Clinic Admin write mutations: blocks Super Admin read-only impersonation and enforces Law #4/quotas. */
async function requireClinicAdminWrite(
  ctx: MutationCtx,
  resourceType: ClinicResourceType
) {
  const access = await requireClinicAccess(ctx, ["clinic_admin"]);
  if (access.isSuperAdminOverride || access.user.role === "super_admin") {
    throw new ConvexError({
      code: "READ_ONLY_IMPERSONATION",
      message: "Super Admin View-As-Clinic mode is strictly read-only.",
    });
  }
  const clinic = await assertClinicCanWrite(ctx, access.clinicId, resourceType);
  return { ...access, clinic };
}

function validateWeeklySchedule(
  schedule: {
    dayOfWeek: number;
    isWorking: boolean;
    startMinute: number;
    endMinute: number;
    breakStartMinute?: number;
    breakEndMinute?: number;
  }[]
) {
  if (schedule.length !== 7) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Weekly schedule must include all 7 days (Sunday through Saturday).",
    });
  }
  for (const day of schedule) {
    if (day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Day of week must be between 0 (Sun) and 6 (Sat).",
      });
    }
    if (!day.isWorking) continue;
    if (
      day.startMinute < 0 ||
      day.endMinute > 1439 ||
      day.endMinute <= day.startMinute
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Shift end time must be after start time (00:00–23:59).",
      });
    }
    if (
      day.breakStartMinute !== undefined &&
      day.breakEndMinute !== undefined
    ) {
      if (
        day.breakEndMinute <= day.breakStartMinute ||
        day.breakStartMinute < day.startMinute ||
        day.breakEndMinute > day.endMinute
      ) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Lunch break must fall inside the dentist's working shift.",
        });
      }
    }
  }
}

// ============================================================================
// 1. WORKSPACE OVERVIEW & LOCAL REPORTS
// ============================================================================

export const getClinicWorkspace = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { user, clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, ["clinic_admin"], args.overrideClinicId);

    const now = Date.now();
    const [
      plan,
      activeDentists,
      inactiveDentists,
      activeChairs,
      inactiveChairs,
      services,
      staffUsers,
      pendingInvitations,
      activeAnnouncements,
      logoUrl,
    ] = await Promise.all([
      ctx.db.get(clinic.planId),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
      ctx.db
        .query("services")
        .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
        .collect(),
      ctx.db
        .query("staffInvitations")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("status", "pending")
        )
        .collect(),
      ctx.db
        .query("systemAnnouncements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .order("desc")
        .collect(),
      clinic.logoStorageId ? ctx.storage.getUrl(clinic.logoStorageId) : null,
    ]);

    const visibleAnnouncements = activeAnnouncements.filter(
      (a) =>
        (!a.expiresAt || a.expiresAt >= now) &&
        (a.targetAudience === "all_users" ||
          a.targetAudience === "all_clinic_staff" ||
          a.targetAudience === "clinic_admins_only")
    );

    const isReadOnly =
      isSuperAdminOverride ||
      clinic.status === "suspended" ||
      clinic.status === "archived" ||
      (clinic.status === "trial" && now > clinic.subscriptionEndsAt);

    return {
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      clinic,
      plan,
      logoUrl,
      isSuperAdminOverride,
      isReadOnly,
      announcements: visibleAnnouncements,
      counts: {
        activeDentists: activeDentists.length,
        totalDentists: activeDentists.length + inactiveDentists.length,
        activeChairs: activeChairs.length,
        totalChairs: activeChairs.length + inactiveChairs.length,
        activeServices: services.filter((s) => s.isActive).length,
        totalServices: services.length,
        staffCount: staffUsers.filter((u) => !u.clerkId.startsWith("pending:")).length,
        pendingInvites: pendingInvitations.filter((i) => i.expiresAt >= now).length,
      },
    };
  },
});

export const getClinicDailyMetrics = query({
  args: {
    overrideClinicId: v.optional(v.id("clinics")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const days = Math.min(Math.max(args.days ?? 30, 7), 90);
    const startKey = toManilaDateKey(Date.now() - (days - 1) * DAY_MS);

    const rows = await ctx.db
      .query("clinicMetricsDaily")
      .withIndex("by_clinic_and_date", (q) =>
        q.eq("clinicId", clinicId).gte("dateKey", startKey)
      )
      .order("asc")
      .collect();

    const totals = rows.reduce(
      (acc, r) => ({
        totalBooked: acc.totalBooked + r.totalBooked,
        completedCount: acc.completedCount + r.completedCount,
        cancelledCount: acc.cancelledCount + r.cancelledCount,
        noShowCount: acc.noShowCount + r.noShowCount,
        estimatedRevenuePhp: acc.estimatedRevenuePhp + r.estimatedRevenuePhp,
        newPatientsCount: acc.newPatientsCount + r.newPatientsCount,
      }),
      {
        totalBooked: 0,
        completedCount: 0,
        cancelledCount: 0,
        noShowCount: 0,
        estimatedRevenuePhp: 0,
        newPatientsCount: 0,
      }
    );

    return { rows, totals };
  },
});

// ============================================================================
// 2. DENTISTS, WEEKLY SHIFT SCHEDULES & TIME OFF
// ============================================================================

export const listDentists = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [activeDentists, inactiveDentists, chairs, timeOffRows, clinicUsers] =
      await Promise.all([
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", false)
          )
          .collect(),
        ctx.db
          .query("chairs")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("dentistTimeOff")
          .withIndex("by_clinic_and_time", (q) => q.eq("clinicId", clinicId))
          .order("desc")
          .take(100),
        ctx.db
          .query("users")
          .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
          .collect(),
      ]);

    const dentists = [...activeDentists, ...inactiveDentists];
    const chairMap = new Map<Id<"chairs">, Doc<"chairs">>(
      chairs.map((c) => [c._id, c])
    );
    const userMap = new Map<Id<"users">, Doc<"users">>(
      clinicUsers.map((u) => [u._id, u])
    );
    const linkedUserIds = new Set(dentists.map((d) => d.userId));

    const now = Date.now();
    const upcomingTimeOffByDentist = new Map<
      Id<"dentists">,
      Doc<"dentistTimeOff">[]
    >();
    for (const row of timeOffRows) {
      if (row.endTimeUtc < now - DAY_MS) continue;
      const list = upcomingTimeOffByDentist.get(row.dentistId) ?? [];
      list.push(row);
      upcomingTimeOffByDentist.set(row.dentistId, list);
    }

    return {
      dentists: dentists.map((d) => {
        const linkedUser = userMap.get(d.userId);
        const defaultChair = d.defaultChairId
          ? chairMap.get(d.defaultChairId)
          : null;
        return {
          ...d,
          userEmail: linkedUser?.email ?? "",
          isPendingAccount: linkedUser?.clerkId.startsWith("pending:") ?? false,
          defaultChairName: defaultChair?.name ?? null,
          timeOff: upcomingTimeOffByDentist.get(d._id) ?? [],
        };
      }),
      availableUsers: clinicUsers
        .filter(
          (u) =>
            !linkedUserIds.has(u._id) &&
            !u.clerkId.startsWith("pending:") &&
            (u.role === "dentist" || u.role === "clinic_admin")
        )
        .map((u) => ({
          _id: u._id,
          email: u.email,
          name: `${u.firstName} ${u.lastName}`.trim() || u.email,
          role: u.role,
        })),
      chairs: chairs.map((c) => ({
        _id: c._id,
        name: c.name,
        roomCode: c.roomCode,
      })),
    };
  },
});

export const createDentist = mutation({
  args: {
    displayName: v.string(),
    userId: v.optional(v.id("users")),
    inviteEmail: v.optional(v.string()),
    licenseNumber: v.string(),
    specialties: v.array(v.string()),
    bio: v.optional(v.string()),
    calendarColorHex: v.string(),
    defaultChairId: v.optional(v.id("chairs")),
    weeklySchedule: v.array(weeklyScheduleDayValidator),
  },
  handler: async (ctx, args) => {
    // Enforces clinic status AND maxDentists plan quota (throws QUOTA_EXCEEDED)
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "dentist"
    );

    const displayName = args.displayName.trim();
    const licenseNumber = args.licenseNumber.trim();
    if (displayName.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Dentist display name must be at least 2 characters.",
      });
    }
    if (!licenseNumber) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "PRC / dental license number is required.",
      });
    }
    validateWeeklySchedule(args.weeklySchedule);

    if (args.defaultChairId) {
      const chair = await ctx.db.get(args.defaultChairId);
      if (!chair || chair.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Selected default operatory chair does not belong to this clinic.",
        });
      }
    }

    const now = Date.now();
    let targetUserId: Id<"users">;

    if (args.userId) {
      const targetUser = await ctx.db.get(args.userId);
      if (!targetUser || targetUser.clinicId !== clinicId) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Selected staff user does not belong to this clinic.",
        });
      }
      const existingProfile = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .unique();
      if (existingProfile) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This staff user already has a dentist profile.",
        });
      }
      targetUserId = targetUser._id;
    } else {
      const email = args.inviteEmail?.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Select an existing clinic user or provide a dentist email to invite.",
        });
      }
      const existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();

      if (existingByEmail) {
        if (existingByEmail.clinicId && existingByEmail.clinicId !== clinicId) {
          throw new ConvexError({
            code: "CONFLICT",
            message: "This email is already assigned to another clinic.",
          });
        }
        const existingProfile = await ctx.db
          .query("dentists")
          .withIndex("by_user", (q) => q.eq("userId", existingByEmail._id))
          .unique();
        if (existingProfile) {
          throw new ConvexError({
            code: "CONFLICT",
            message: "A dentist profile already exists for this email.",
          });
        }
        targetUserId = existingByEmail._id;
      } else {
        const nameParts = displayName.replace(/^Dr\.?\s*/i, "").split(/\s+/);
        const firstName = nameParts[0] || "Dr.";
        const lastName = nameParts.slice(1).join(" ") || "Dentist";
        targetUserId = await ctx.db.insert("users", {
          clerkId: `pending:${clinicId}:${email}`,
          email,
          firstName,
          lastName,
          role: "dentist",
          clinicId,
          isActive: false, // Inactive until real Clerk webhook activates on sign-up
          createdAt: now,
        });
      }

      const existingInvites = await ctx.db
        .query("staffInvitations")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", "pending")
        )
        .collect();
      if (!existingInvites.some((i) => i.clinicId === clinicId)) {
        await ctx.db.insert("staffInvitations", {
          clinicId,
          email,
          role: "dentist",
          invitedByUserId: actor._id,
          status: "pending",
          expiresAt: now + 7 * DAY_MS,
          createdAt: now,
        });
      }
    }

    const color = HEX_COLOR_REGEX.test(args.calendarColorHex.trim())
      ? args.calendarColorHex.trim()
      : "#0284c7";

    const dentistId = await ctx.db.insert("dentists", {
      clinicId,
      userId: targetUserId,
      displayName,
      licenseNumber,
      specialties: args.specialties
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      bio: args.bio?.trim() || undefined,
      calendarColorHex: color,
      defaultChairId: args.defaultChairId,
      weeklySchedule: args.weeklySchedule,
      isActive: true,
    });

    await ctx.db.patch(clinicId, {
      activeDentistCount: clinic.activeDentistCount + 1,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "DENTIST_CREATED",
      targetEntity: "dentists",
      targetId: dentistId,
      metadata: { displayName, licenseNumber },
    });

    return { dentistId };
  },
});

export const updateDentist = mutation({
  args: {
    dentistId: v.id("dentists"),
    displayName: v.string(),
    licenseNumber: v.string(),
    specialties: v.array(v.string()),
    bio: v.optional(v.string()),
    calendarColorHex: v.string(),
    defaultChairId: v.optional(v.id("chairs")),
    weeklySchedule: v.array(weeklyScheduleDayValidator),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }
    validateWeeklySchedule(args.weeklySchedule);

    if (args.defaultChairId) {
      const chair = await ctx.db.get(args.defaultChairId);
      if (!chair || chair.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Selected default chair does not belong to this clinic.",
        });
      }
    }

    const color = HEX_COLOR_REGEX.test(args.calendarColorHex.trim())
      ? args.calendarColorHex.trim()
      : dentist.calendarColorHex;

    await ctx.db.patch(args.dentistId, {
      displayName: args.displayName.trim(),
      licenseNumber: args.licenseNumber.trim(),
      specialties: args.specialties
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      bio: args.bio?.trim() || undefined,
      calendarColorHex: color,
      defaultChairId: args.defaultChairId,
      weeklySchedule: args.weeklySchedule,
    });

    return { dentistId: args.dentistId };
  },
});

export const toggleDentistActive = mutation({
  args: {
    dentistId: v.id("dentists"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      args.isActive ? "dentist" : "staff"
    );

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }
    if (dentist.isActive === args.isActive) {
      return { dentistId: args.dentistId, isActive: args.isActive };
    }

    await ctx.db.patch(args.dentistId, { isActive: args.isActive });
    await ctx.db.patch(clinicId, {
      activeDentistCount: Math.max(
        0,
        clinic.activeDentistCount + (args.isActive ? 1 : -1)
      ),
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "DENTIST_REACTIVATED" : "DENTIST_DEACTIVATED",
      targetEntity: "dentists",
      targetId: args.dentistId,
      metadata: { displayName: dentist.displayName },
    });

    return { dentistId: args.dentistId, isActive: args.isActive };
  },
});

export const addDentistTimeOff = mutation({
  args: {
    dentistId: v.id("dentists"),
    startTimeUtc: v.number(),
    endTimeUtc: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }
    if (args.endTimeUtc <= args.startTimeUtc) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Time-off end must be after start.",
      });
    }

    const timeOffId = await ctx.db.insert("dentistTimeOff", {
      clinicId,
      dentistId: args.dentistId,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      reason: args.reason.trim() || "Scheduled leave",
      createdByUserId: actor._id,
    });

    return { timeOffId };
  },
});

export const deleteDentistTimeOff = mutation({
  args: { timeOffId: v.id("dentistTimeOff") },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const row = await ctx.db.get(args.timeOffId);
    if (!row || row.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Time-off block not found.",
      });
    }
    await ctx.db.delete(args.timeOffId);
    return { deleted: true };
  },
});

// ============================================================================
// 3. OPERATORY CHAIRS
// ============================================================================

export const listChairs = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [activeChairs, inactiveChairs] = await Promise.all([
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
    ]);

    return [...activeChairs, ...inactiveChairs];
  },
});

export const createChair = mutation({
  args: {
    name: v.string(),
    roomCode: v.string(),
    supportedCategoryTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Enforces maxChairs plan quota (throws QUOTA_EXCEEDED)
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "chair"
    );

    const name = args.name.trim();
    const roomCode = args.roomCode.trim().toUpperCase();
    if (name.length < 2 || !roomCode) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Chair name and room code are required.",
      });
    }

    const chairId = await ctx.db.insert("chairs", {
      clinicId,
      name,
      roomCode,
      supportedCategoryTags: args.supportedCategoryTags
        .map((t) => t.trim())
        .filter(Boolean),
      isActive: true,
    });

    await ctx.db.patch(clinicId, {
      activeChairCount: clinic.activeChairCount + 1,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CHAIR_CREATED",
      targetEntity: "chairs",
      targetId: chairId,
      metadata: { name, roomCode },
    });

    return { chairId };
  },
});

export const updateChair = mutation({
  args: {
    chairId: v.id("chairs"),
    name: v.string(),
    roomCode: v.string(),
    supportedCategoryTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const chair = await ctx.db.get(args.chairId);
    if (!chair || chair.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chair not found." });
    }

    await ctx.db.patch(args.chairId, {
      name: args.name.trim(),
      roomCode: args.roomCode.trim().toUpperCase(),
      supportedCategoryTags: args.supportedCategoryTags
        .map((t) => t.trim())
        .filter(Boolean),
    });

    return { chairId: args.chairId };
  },
});

export const toggleChairActive = mutation({
  args: {
    chairId: v.id("chairs"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      args.isActive ? "chair" : "staff"
    );

    const chair = await ctx.db.get(args.chairId);
    if (!chair || chair.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chair not found." });
    }
    if (chair.isActive === args.isActive) {
      return { chairId: args.chairId, isActive: args.isActive };
    }

    await ctx.db.patch(args.chairId, { isActive: args.isActive });
    await ctx.db.patch(clinicId, {
      activeChairCount: Math.max(
        0,
        clinic.activeChairCount + (args.isActive ? 1 : -1)
      ),
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "CHAIR_REACTIVATED" : "CHAIR_DEACTIVATED",
      targetEntity: "chairs",
      targetId: args.chairId,
      metadata: { name: chair.name, roomCode: chair.roomCode },
    });

    return { chairId: args.chairId, isActive: args.isActive };
  },
});

// ============================================================================
// 4. DENTAL SERVICES CATALOG
// ============================================================================

export const listServices = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    return await ctx.db
      .query("services")
      .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
      .collect();
  },
});

export const createService = mutation({
  args: {
    name: v.string(),
    category: serviceCategoryValidator,
    description: v.string(),
    durationMinutes: v.number(),
    bufferMinutes: v.number(),
    pricePhp: v.number(),
    requiresXray: v.boolean(),
    requiredChairTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");

    if (args.durationMinutes < 5 || args.bufferMinutes < 0 || args.pricePhp < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Duration must be at least 5 minutes and buffer/price cannot be negative.",
      });
    }

    const serviceId = await ctx.db.insert("services", {
      clinicId,
      name: args.name.trim(),
      category: args.category,
      description: args.description.trim(),
      durationMinutes: args.durationMinutes,
      bufferMinutes: args.bufferMinutes,
      pricePhp: args.pricePhp,
      requiresXray: args.requiresXray,
      requiredChairTag: args.requiredChairTag?.trim() || undefined,
      isActive: true,
    });

    return { serviceId };
  },
});

export const updateService = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.string(),
    category: serviceCategoryValidator,
    description: v.string(),
    durationMinutes: v.number(),
    bufferMinutes: v.number(),
    pricePhp: v.number(),
    requiresXray: v.boolean(),
    requiredChairTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }

    await ctx.db.patch(args.serviceId, {
      name: args.name.trim(),
      category: args.category,
      description: args.description.trim(),
      durationMinutes: args.durationMinutes,
      bufferMinutes: args.bufferMinutes,
      pricePhp: args.pricePhp,
      requiresXray: args.requiresXray,
      requiredChairTag: args.requiredChairTag?.trim() || undefined,
    });

    return { serviceId: args.serviceId };
  },
});

export const toggleServiceActive = mutation({
  args: {
    serviceId: v.id("services"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }
    await ctx.db.patch(args.serviceId, { isActive: args.isActive });
    return { serviceId: args.serviceId, isActive: args.isActive };
  },
});

export const seedDefaultServices = mutation({
  args: {},
  handler: async (ctx) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const existing = await ctx.db
      .query("services")
      .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
      .collect();
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));

    let created = 0;
    for (const svc of DEFAULT_SERVICE_CATALOG) {
      if (existingNames.has(svc.name.toLowerCase())) continue;
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
      created++;
    }
    return { created };
  },
});

// ============================================================================
// 5. STAFF & INVITATIONS
// ============================================================================

export const listStaff = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [users, pendingInvitations, acceptedInvitations] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
        .collect(),
      ctx.db
        .query("staffInvitations")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("status", "pending")
        )
        .collect(),
      ctx.db
        .query("staffInvitations")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("status", "accepted")
        )
        .collect(),
    ]);

    return {
      staff: users
        .filter((u) => !u.clerkId.startsWith("pending:"))
        .map((u) => ({
          _id: u._id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt ?? null,
          createdAt: u.createdAt,
        })),
      pendingInvitations: pendingInvitations.sort(
        (a, b) => b.createdAt - a.createdAt
      ),
      acceptedCount: acceptedInvitations.length,
    };
  },
});

export const inviteStaff = mutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("clinic_admin"),
      v.literal("dentist"),
      v.literal("receptionist")
    ),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide a valid staff email address.",
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
      if (inv.clinicId === clinicId) {
        await ctx.db.patch(inv._id, { status: "revoked" });
      }
    }

    const invitationId = await ctx.db.insert("staffInvitations", {
      clinicId,
      email,
      role: args.role,
      invitedByUserId: actor._id,
      status: "pending",
      expiresAt: now + 7 * DAY_MS,
      createdAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "STAFF_INVITED",
      targetEntity: "staffInvitations",
      targetId: invitationId,
      metadata: { email, role: args.role },
    });

    return { invitationId };
  },
});

export const revokeStaffInvitation = mutation({
  args: { invitationId: v.id("staffInvitations") },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    }

    await ctx.db.patch(args.invitationId, { status: "revoked" });
    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "STAFF_INVITATION_REVOKED",
      targetEntity: "staffInvitations",
      targetId: args.invitationId,
      metadata: { email: inv.email, role: inv.role },
    });

    return { revoked: true };
  },
});

export const toggleStaffActive = mutation({
  args: {
    userId: v.id("users"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    if (args.userId === actor._id) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "You cannot deactivate your own account.",
      });
    }
    const target = await ctx.db.get(args.userId);
    if (!target || target.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Staff member not found.",
      });
    }

    await ctx.db.patch(args.userId, { isActive: args.isActive });
    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
      targetEntity: "users",
      targetId: args.userId,
      metadata: { email: target.email, role: target.role },
    });

    return { userId: args.userId, isActive: args.isActive };
  },
});

// ============================================================================
// 6. CLINIC SETTINGS, BRANDING & OPERATING HOURS
// ============================================================================

export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const { clinic } = await requireClinicAdminWrite(ctx, "storage");
    assertClinicFeatureEnabled(clinic, "customBrandingEnabled");
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateClinicSettings = mutation({
  args: {
    name: v.string(),
    tagline: v.optional(v.string()),
    primaryColorHex: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    logoSizeBytes: v.optional(v.number()),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    province: v.string(),
    timezone: v.string(),
    slotIntervalMinutes: v.number(),
    cancellationWindowHours: v.number(),
    emergencyBufferMinutesPerDay: v.number(),
    operatingHours: v.array(operatingHoursDayValidator),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "staff"
    );

    if (args.operatingHours.length !== 7) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Operating hours must specify all 7 days of the week.",
      });
    }
    for (const day of args.operatingHours) {
      if (day.isOpen && day.closeMinute <= day.openMinute) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Closing time must be after opening time for open days.",
        });
      }
    }

    const nextColor = HEX_COLOR_REGEX.test(args.primaryColorHex.trim())
      ? args.primaryColorHex.trim()
      : clinic.primaryColorHex;

    const changingBranding =
      nextColor.toLowerCase() !== clinic.primaryColorHex.toLowerCase() ||
      (args.logoStorageId !== undefined &&
        args.logoStorageId !== clinic.logoStorageId);

    if (changingBranding) {
      assertClinicFeatureEnabled(clinic, "customBrandingEnabled");
    }

    const addedBytes =
      args.logoStorageId && args.logoStorageId !== clinic.logoStorageId
        ? Math.max(0, args.logoSizeBytes ?? 0)
        : 0;

    await ctx.db.patch(clinicId, {
      name: args.name.trim(),
      tagline: args.tagline?.trim() || undefined,
      primaryColorHex: nextColor,
      logoStorageId: args.logoStorageId ?? clinic.logoStorageId,
      storageUsedBytes: clinic.storageUsedBytes + addedBytes,
      email: args.email.trim().toLowerCase(),
      phone: args.phone.trim(),
      address: args.address.trim(),
      city: args.city.trim(),
      province: args.province.trim(),
      timezone: args.timezone.trim() || "Asia/Manila",
      slotIntervalMinutes: args.slotIntervalMinutes === 15 ? 15 : 30,
      cancellationWindowHours: Math.max(0, args.cancellationWindowHours),
      emergencyBufferMinutesPerDay: Math.max(
        0,
        args.emergencyBufferMinutesPerDay
      ),
      operatingHours: args.operatingHours,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CLINIC_SETTINGS_UPDATED",
      targetEntity: "clinics",
      targetId: clinicId,
      metadata: {
        name: args.name.trim(),
        slotIntervalMinutes: args.slotIntervalMinutes === 15 ? 15 : 30,
      },
    });

    return { clinicId };
  },
});
