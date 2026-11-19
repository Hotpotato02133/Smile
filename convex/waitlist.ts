import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { toManilaMonthKey } from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  getAuthenticatedUser,
} from "./lib/permissions";
import { verifySpecificPairAvailable } from "./lib/scheduling";

/**
 * Allows an authenticated patient to join a clinic's standby waitlist for a full day.
 */
export const joinWaitlist = mutation({
  args: {
    clinicId: v.id("clinics"),
    serviceId: v.id("services"),
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

    const existingPatients = await ctx.db
      .query("patients")
      .withIndex("by_clinic_and_user", (q) =>
        q.eq("clinicId", clinic._id).eq("userId", user._id)
      )
      .collect();
    let patient =
      existingPatients.find((p) => !p.guardianPatientId) ?? existingPatients[0];

    const now = Date.now();
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

/** Lists the signed-in patient's active waitlist requests across clinics. */
export const listMyWaitlist = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    const myPatients = await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const clinicIds = Array.from(new Set(myPatients.map((p) => p.clinicId)));
    const patientIds = new Set(myPatients.map((p) => p._id));

    const results = [];
    for (const clinicId of clinicIds) {
      const clinic = await ctx.db.get(clinicId);
      if (!clinic) continue;
      const rows = await ctx.db
        .query("waitlist")
        .withIndex("by_clinic_and_date", (q) => q.eq("clinicId", clinicId))
        .collect();
      for (const row of rows) {
        if (!patientIds.has(row.patientId)) continue;
        const service = await ctx.db.get(row.serviceId);
        results.push({
          ...row,
          clinicName: clinic.name,
          clinicSlug: clinic.slug,
          serviceName: service?.name ?? "Dental Procedure",
        });
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * ACID one-click waitlist slot claim: verifies dentist + chair availability,
 * books with `bookingSource: "waitlist_claim"`, marks the waitlist row `"claimed"`,
 * and triggers a Resend confirmation email.
 */
export const claimWaitlistSlot = mutation({
  args: {
    waitlistId: v.id("waitlist"),
    startTimeUtc: v.number(),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
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
    if (!patient || patient.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only claim your own waitlist notifications.",
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

    return {
      appointmentId,
      referenceCode: `SML-${appointmentId.slice(-6).toUpperCase()}`,
    };
  },
});

/**
 * Triggered asynchronously when an appointment is cancelled; notifies up to 5
 * matching waitlisted patients via Resend (`internal.notifications.sendWaitlistOpeningBlast`).
 */
export const notifyWaitlistForCancellation = internalMutation({
  args: {
    clinicId: v.id("clinics"),
    dateKey: v.string(),
    dentistId: v.optional(v.id("dentists")),
  },
  handler: async (ctx, args) => {
    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic || !clinic.featureFlags.waitlistAutomationEnabled) {
      return { notified: 0 };
    }

    const waiting = await ctx.db
      .query("waitlist")
      .withIndex("by_clinic_and_date", (q) =>
        q
          .eq("clinicId", args.clinicId)
          .eq("preferredDateKey", args.dateKey)
          .eq("status", "waiting")
      )
      .collect();

    const matching = waiting
      .filter(
        (w) =>
          !args.dentistId ||
          !w.preferredDentistId ||
          w.preferredDentistId === args.dentistId
      )
      .slice(0, 5);

    let notified = 0;
    for (const entry of matching) {
      const [patient, service] = await Promise.all([
        ctx.db.get(entry.patientId),
        ctx.db.get(entry.serviceId),
      ]);
      await ctx.db.patch(entry._id, { status: "notified" });
      notified++;

      if (patient?.email) {
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.sendWaitlistOpeningBlast,
          {
            clinicId: clinic._id,
            clinicName: clinic.name,
            clinicSlug: clinic.slug,
            primaryColorHex: clinic.primaryColorHex,
            waitlistId: entry._id,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientEmail: patient.email,
            serviceName: service?.name ?? "Dental Procedure",
            dateKey: args.dateKey,
          }
        );
      }
    }

    return { notified };
  },
});
