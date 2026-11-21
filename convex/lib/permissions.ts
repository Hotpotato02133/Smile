import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type UserRole =
  | "super_admin"
  | "clinic_admin"
  | "dentist"
  | "receptionist"
  | "patient";

export type ClinicResourceType =
  | "appointment"
  | "dentist"
  | "chair"
  | "storage"
  | "email"
  | "staff";

export type ClinicFeatureFlag = keyof Doc<"clinics">["featureFlags"];

const FEATURE_LABELS: Record<ClinicFeatureFlag, string> = {
  odontogramEnabled: "Interactive 32-Tooth Odontogram",
  xrayStorageEnabled: "X-Ray & Intraoral Photo Vault",
  waitlistAutomationEnabled: "Waitlist Cancellation Blast",
  recallAutomationEnabled: "6-Month Hygiene Recall Automation",
  customBrandingEnabled: "Custom Clinic Branding",
};

type Ctx = QueryCtx | MutationCtx;

/** Resolves the authenticated caller's `users` document (Law #2). */
export async function getAuthenticatedUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign-in required." });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user || !user.isActive) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "User account is inactive or missing.",
    });
  }
  return user;
}

/** Returns true if the user is the root owner configured in SUPER_ADMIN_EMAIL. */
export function isRootSuperAdmin(user: Doc<"users">): boolean {
  const ownerEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(
    user.role === "super_admin" &&
      ownerEmail &&
      user.email.trim().toLowerCase() === ownerEmail
  );
}

/** Law #3: requires active super_admin (root owner or audited invited co-owner). */
export async function requireSuperAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getAuthenticatedUser(ctx);
  if (user.role !== "super_admin") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Super Admin privileges required.",
    });
  }
  return user;
}

/** Root Platform Owner guard for granting or revoking Super Admin privileges. */
export async function requireRootSuperAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireSuperAdmin(ctx);
  if (!isRootSuperAdmin(user)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message:
        "Only the primary Platform Owner (SUPER_ADMIN_EMAIL) may invite or revoke Super Admin accounts.",
    });
  }
  return user;
}

export async function requireClinicAccess(
  ctx: Ctx,
  allowedRoles: UserRole[],
  overrideClinicId?: Id<"clinics">
) {
  const user = await getAuthenticatedUser(ctx);

  // Super Admin may inspect any clinic ("View As Clinic" mode, read-only in the UI).
  if (user.role === "super_admin" && overrideClinicId) {
    await requireSuperAdmin(ctx);
    const clinic = await ctx.db.get(overrideClinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Target clinic not found." });
    }
    return { user, clinic, clinicId: clinic._id, isSuperAdminOverride: true as const };
  }

  if (!allowedRoles.includes(user.role) || !user.clinicId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Insufficient role permissions for this clinic operation.",
    });
  }

  const clinic = await ctx.db.get(user.clinicId);
  if (!clinic) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Assigned clinic does not exist." });
  }

  return { user, clinic, clinicId: clinic._id, isSuperAdminOverride: false as const };
}

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Law #4 + quota gates. Call before creating appointments, dentists, chairs,
 * uploads, emails or staff. Throws a structured ConvexError when blocked.
 */
export async function assertClinicCanWrite(
  ctx: Ctx,
  clinicId: Id<"clinics">,
  resourceType: ClinicResourceType
): Promise<Doc<"clinics">> {
  const clinic = await ctx.db.get(clinicId);
  if (!clinic) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
  }

  const now = Date.now();

  if (clinic.status === "suspended" || clinic.status === "archived") {
    throw new ConvexError({
      code: "CLINIC_READ_ONLY",
      message: "This clinic is in read-only mode. Please renew the subscription.",
    });
  }
  if (clinic.status === "trial" && now > clinic.subscriptionEndsAt) {
    throw new ConvexError({
      code: "SUBSCRIPTION_EXPIRED",
      message: "The free trial has ended. Please upgrade to continue.",
    });
  }
  if (clinic.status === "active" && now > clinic.subscriptionEndsAt) {
    throw new ConvexError({
      code: "SUBSCRIPTION_EXPIRED",
      message: "The subscription has expired. Please renew.",
    });
  }
  // past_due: staff may manage existing records inside the grace window,
  // but creating new billable resources is blocked after it ends.
  if (clinic.status === "past_due") {
    const graceEnd = clinic.gracePeriodEndsAt ?? clinic.subscriptionEndsAt + GRACE_PERIOD_MS;
    if (now > graceEnd) {
      throw new ConvexError({
        code: "CLINIC_READ_ONLY",
        message: "The grace period has ended. The clinic is read-only.",
      });
    }
  }

  const plan = await ctx.db.get(clinic.planId);
  if (!plan) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Subscription plan not found." });
  }

  const quotaError = (message: string) =>
    new ConvexError({ code: "QUOTA_EXCEEDED", message });

  switch (resourceType) {
    case "dentist":
      if (clinic.activeDentistCount >= plan.maxDentists) {
        throw quotaError(`${plan.name} plan allows up to ${plan.maxDentists} dentists.`);
      }
      break;
    case "chair":
      if (clinic.activeChairCount >= plan.maxChairs) {
        throw quotaError(`${plan.name} plan allows up to ${plan.maxChairs} chairs.`);
      }
      break;
    case "appointment":
      if (clinic.currentMonthAppointmentCount >= plan.maxAppointmentsPerMonth) {
        throw quotaError(
          `${plan.name} plan allows up to ${plan.maxAppointmentsPerMonth} appointments per month.`
        );
      }
      break;
    case "storage":
      if (clinic.storageUsedBytes >= plan.maxStorageBytes) {
        throw quotaError("Storage quota reached. Please upgrade your plan.");
      }
      break;
    case "email":
      if (clinic.currentMonthEmailCount >= plan.maxEmailsPerMonth) {
        throw quotaError("Monthly email quota reached.");
      }
      break;
    case "staff":
      break;
  }

  return clinic;
}

/** Gates plan- or tenant-level features stored on `clinics.featureFlags`. */
export function assertClinicFeatureEnabled(
  clinic: Doc<"clinics">,
  feature: ClinicFeatureFlag
): void {
  if (!clinic.featureFlags[feature]) {
    throw new ConvexError({
      code: "FEATURE_DISABLED",
      message: `${FEATURE_LABELS[feature]} is not enabled on this clinic's current plan.`,
    });
  }
}
