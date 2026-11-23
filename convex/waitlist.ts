import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { toManilaMonthKey } from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  getAuthenticatedUser,
} from "./lib/permissions";
import {
  classifyTimeWindow,
  getLocalDateKeyAndMinute,
  verifySpecificPairAvailable,
} from "./lib/scheduling";

async function patientBelongsToUser(
  ctx: QueryCtx | MutationCtx,
  patient: Doc<"patients">,
  userId: Id<"users">
): Promise<boolean> {
  if (patient.userId === userId) return true;
  if (patient.guardianPatientId) {
    const guardian = await ctx.db.get(patient.guardianPatientId);
    return guardian?.userId === userId;
  }
  return false;
}

/**
 * Allows an authenticated patient to join a clinic's standby waitlist for a full day
 * (for themselves or one of their linked family dependents).
 */
export const joinWaitlist = mutation({
  args: {
    clinicId: v.id("clinics"),
    serviceId: v.id("services"),
    patientId: v.optional(v.id("patients")),
    preferredDentistId: v.optional(v.id("dentists")),
    preferredDateKey: v.string(),
    preferredTimeWindow: v.union(
      v.literal("morning"),
      v.literal("afternoon"),
      v.literal("any")
    ),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const clinic = await assertClinicCanWrite(ctx, args.clinicId, "staff");
    assertClinicFeatureEnabled(clinic, "waitlistAutomationEnabled");

    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinic._id || !service.isActive) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Dental service not found.",
      });
    }

    const now = Date.now();
    let patient: Doc<"patients"> | null = null;

    if (args.patientId) {
      const requested = await ctx.db.get(args.patientId);
      if (
        !requested ||
        requested.clinicId !== clinic._id ||
        !(await patientBelongsToUser(ctx, requested, user._id))
      ) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only join the waitlist for yourself or your dependents.",
        });
      }
      patient = requested;
    } else {
      const existingPatients = await ctx.db
        .query("patients")
        .withIndex("by_clinic_and_user", (q) =>
          q.eq("clinicId", clinic._id).eq("userId", user._id)
        )
        .take(10);
      patient =
        existingPatients.find((p) => !p.guardianPatientId) ??
        existingPatients[0] ??
        null;

      if (!patient) {
        const patientId = await ctx.db.insert("patients", {
          clinicId: clinic._id,
          userId: user._id,
          firstName: user.firstName || "Patient",
          lastName: user.lastName || "",
          dateOfBirth: "1990-01-01",
          sex: "other",
          email: user.email,
          phone: args.phone?.trim() || user.phone || "",
          medicalHistory: {
            allergies: [],
            conditions: [],
            isTakingBloodThinners: false,
            isPregnant: false,
            dentalAnxietyLevel: "none",
          },
          noShowCount: 0,
          createdAt: now,
        });
        patient = (await ctx.db.get(patientId))!;
      }
    }

    // Prevent duplicate active waitlist entries for the same patient, service, and date
    const existingForPatient = await ctx.db
      .query("waitlist")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .take(50);

    const duplicate = existingForPatient.find(
      (entry) =>
        entry.clinicId === clinic._id &&
        entry.serviceId === service._id &&
        entry.preferredDateKey === args.preferredDateKey &&
        (entry.status === "waiting" || entry.status === "notified")
    );
    if (duplicate) {
      throw new ConvexError({
        code: "ALREADY_WAITLISTED",
        message: `You are already on the standby waitlist for ${service.name} on ${args.preferredDateKey}.`,
      });
    }

    const waitlistId = await ctx.db.insert("waitlist", {
      clinicId: clinic._id,
      patientId: patient._id,
      serviceId: service._id,
      preferredDentistId: args.preferredDentistId,
      preferredDateKey: args.preferredDateKey,
      preferredTimeWindow: args.preferredTimeWindow,
      status: "waiting",
      createdAt: now,
    });

    return { waitlistId };
  },
});

/**
 * Loads a specific waitlist entry for `/c/[clinicSlug]?waitlistId=...&date=...`
 * so an authenticated patient (or guardian) can one-click claim an opened slot.
 */
export const getWaitlistEntryForClaim = query({
  args: {
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user || !user.isActive) return null;

    const entry = await ctx.db.get(args.waitlistId);
    if (!entry) return null;

    const patient = await ctx.db.get(entry.patientId);
    if (!patient || !(await patientBelongsToUser(ctx, patient, user._id))) {
      return null;
    }

    const [clinic, service, preferredDentist] = await Promise.all([
      ctx.db.get(entry.clinicId),
      ctx.db.get(entry.serviceId),
      entry.preferredDentistId ? ctx.db.get(entry.preferredDentistId) : null,
    ]);

    if (!clinic || !service) return null;

    return {
      _id: entry._id,
      clinicId: entry.clinicId,
      clinicSlug: clinic.slug,
      clinicName: clinic.name,
      serviceId: entry.serviceId,
      serviceName: service.name,
      preferredDentistId: entry.preferredDentistId ?? null,
      preferredDentistName: preferredDentist?.displayName ?? null,
      preferredDateKey: entry.preferredDateKey,
      preferredTimeWindow: entry.preferredTimeWindow,
      status: entry.status,
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
      isDependent: Boolean(patient.guardianPatientId),
    };
  },
});

/** Lists the signed-in patient's (and dependents') waitlist requests across clinics via `by_patient`. */
export const listMyWaitlist = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    const ownPatients = await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);

    const depGroups = await Promise.all(
      ownPatients.map((p) =>
        ctx.db
          .query("patients")
          .withIndex("by_guardian", (q) => q.eq("guardianPatientId", p._id))
          .take(25)
      )
    );
    const allPatients = [...ownPatients, ...depGroups.flat()];
    const patientMap = new Map(allPatients.map((p) => [p._id, p]));

    const waitlistGroups = await Promise.all(
      allPatients.map((p) =>
        ctx.db
          .query("waitlist")
          .withIndex("by_patient", (q) => q.eq("patientId", p._id))
          .order("desc")
          .take(25)
      )
    );
    const entries = waitlistGroups.flat();

    const clinicIds = Array.from(new Set(entries.map((e) => e.clinicId)));
    const serviceIds = Array.from(new Set(entries.map((e) => e.serviceId)));
    const [clinics, services] = await Promise.all([
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
      Promise.all(serviceIds.map((id) => ctx.db.get(id))),
    ]);
    const clinicMap = new Map(
      clinics.filter((c): c is Doc<"clinics"> => c !== null).map((c) => [c._id, c])
    );
    const serviceMap = new Map(
      services.filter((s): s is Doc<"services"> => s !== null).map((s) => [s._id, s])
    );

    return entries
      .map((row) => {
        const clinic = clinicMap.get(row.clinicId);
        const service = serviceMap.get(row.serviceId);
        const patient = patientMap.get(row.patientId);
        return {
          ...row,
          clinicName: clinic?.name ?? "Dental Clinic",
          clinicSlug: clinic?.slug ?? "",
          serviceName: service?.name ?? "Dental Procedure",
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`.trim()
            : "Patient",
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * ACID one-click waitlist slot claim: verifies dentist + chair availability,
 * books with `bookingSource: "waitlist_claim"`, marks the waitlist row `"claimed"`,
 * cleans up any held session lock, and triggers a Resend confirmation email.
 */
export const claimWaitlistSlot = mutation({
  args: {
    waitlistId: v.id("waitlist"),
    startTimeUtc: v.number(),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
    lockId: v.optional(v.id("slotLocks")),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const entry = await ctx.db.get(args.waitlistId);
    if (!entry) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Waitlist entry not found.",
      });
    }
    if (entry.status !== "notified" && entry.status !== "waiting") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "This waitlist invitation has already been claimed or expired.",
      });
    }

    const patient = await ctx.db.get(entry.patientId);
    if (!patient || !(await patientBelongsToUser(ctx, patient, user._id))) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only claim your own or your dependent's waitlist notifications.",
      });
    }

    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);
    const rawClinic = await ctx.db.get(entry.clinicId);
    if (rawClinic && rawClinic.currentMonthKey !== currentMonthKey) {
      await ctx.db.patch(entry.clinicId, {
        currentMonthKey,
        currentMonthAppointmentCount: 0,
        currentMonthEmailCount: 0,
        updatedAt: now,
      });
    }

    const clinic = await assertClinicCanWrite(ctx, entry.clinicId, "appointment");
    const service = await ctx.db.get(entry.serviceId);
    if (!service || service.clinicId !== clinic._id || !service.isActive) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Requested service is no longer active.",
      });
    }

    const check = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: entry.preferredDateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
      ignoreSessionId: args.sessionId,
      enforceScheduleRules: true,
      minLeadMinutes: 0,
    });
    if (!check.ok) {
      throw new ConvexError({
        code: "SLOT_UNAVAILABLE",
        message:
          check.reason ?? "This opening was already claimed by another patient.",
      });
    }

    const appointmentId = await ctx.db.insert("appointments", {
      clinicId: clinic._id,
      patientId: patient._id,
      dentistId: args.dentistId,
      chairId: args.chairId,
      serviceId: service._id,
      dateKey: entry.preferredDateKey,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: check.endTimeUtc,
      bufferEndTimeUtc: check.bufferEndTimeUtc,
      status: "confirmed",
      bookingSource: "waitlist_claim",
      reminder24hSent: false,
      reminder2hSent: false,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(entry._id, { status: "claimed" });

    // Clean up any temporary slot locks held by this session
    if (args.lockId && args.sessionId) {
      const lock = await ctx.db.get(args.lockId);
      if (
        lock &&
        lock.clinicId === clinic._id &&
        lock.lockedBySessionId === args.sessionId
      ) {
        await ctx.db.delete(lock._id);
      }
    }
    if (args.sessionId) {
      const sessionLocks = await ctx.db
        .query("slotLocks")
        .withIndex("by_clinic_and_expires", (q) =>
          q.eq("clinicId", clinic._id).gt("expiresAtUtc", now)
        )
        .collect();
      for (const l of sessionLocks) {
        if (l.lockedBySessionId === args.sessionId) {
          await ctx.db.delete(l._id);
        }
      }
    }

    await ctx.db.patch(clinic._id, {
      currentMonthAppointmentCount: clinic.currentMonthAppointmentCount + 1,
      lifetimeAppointmentCount: clinic.lifetimeAppointmentCount + 1,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendBookingConfirmation,
      { appointmentId }
    );

    const [dentist, chair] = await Promise.all([
      ctx.db.get(args.dentistId),
      ctx.db.get(args.chairId),
    ]);

    return {
      appointmentId,
      referenceCode: `SML-${appointmentId.slice(-6).toUpperCase()}`,
      clinicName: clinic.name,
      clinicSlug: clinic.slug,
      clinicAddress: `${clinic.address}, ${clinic.city}, ${clinic.province}`,
      clinicPhone: clinic.phone,
      cancellationWindowHours: clinic.cancellationWindowHours,
      serviceName: service.name,
      pricePhp: service.pricePhp,
      dentistName: dentist?.displayName ?? "Assigned Dentist",
      chairName: chair?.name ?? "Operatory Chair",
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: check.endTimeUtc,
    };
  },
});

/**
 * Triggered asynchronously when an appointment is cancelled or rescheduled away;
 * matches waiting patients by date, optional preferred dentist, and preferred time window
 * (`morning` / `afternoon` / `any`) and notifies up to 5 via Resend.
 */
export const notifyWaitlistForCancellation = internalMutation({
  args: {
    clinicId: v.id("clinics"),
    dateKey: v.string(),
    dentistId: v.optional(v.id("dentists")),
    startTimeUtc: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic || !clinic.featureFlags.waitlistAutomationEnabled) {
      return { notified: 0 };
    }

    const slotWindow =
      args.startTimeUtc !== undefined
        ? classifyTimeWindow(
            getLocalDateKeyAndMinute(
              args.startTimeUtc,
              clinic.timezone || "Asia/Manila"
            ).minuteOfDay
          )
        : null;

    const waiting = await ctx.db
      .query("waitlist")
      .withIndex("by_clinic_and_date", (q) =>
        q
          .eq("clinicId", args.clinicId)
          .eq("preferredDateKey", args.dateKey)
          .eq("status", "waiting")
      )
      .take(100);

    const matching = waiting
      .sort((a, b) => a.createdAt - b.createdAt)
      .filter((w) => {
        const dentistMatches =
          !args.dentistId ||
          !w.preferredDentistId ||
          w.preferredDentistId === args.dentistId;
        const windowMatches =
          !slotWindow ||
          w.preferredTimeWindow === "any" ||
          w.preferredTimeWindow === slotWindow;
        return dentistMatches && windowMatches;
      });

    let notified = 0;
    for (const entry of matching) {
      if (notified >= 5) break;
      const [patient, service] = await Promise.all([
        ctx.db.get(entry.patientId),
        ctx.db.get(entry.serviceId),
      ]);
      const recipientEmail = patient?.email?.trim();
      if (!patient || !recipientEmail) {
        // Keep phone-only walk-in patients in "waiting" so staff can call them directly
        continue;
      }

      await ctx.db.patch(entry._id, { status: "notified" });
      notified++;

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendWaitlistOpeningBlast,
        {
          clinicId: clinic._id,
          clinicName: clinic.name,
          clinicSlug: clinic.slug,
          primaryColorHex: clinic.primaryColorHex,
          waitlistId: entry._id,
          patientName: `${patient.firstName} ${patient.lastName}`.trim(),
          patientEmail: recipientEmail,
          serviceName: service?.name ?? "Dental Procedure",
          dateKey: args.dateKey,
        }
      );
    }

    return { notified };
  },
});
