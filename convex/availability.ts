import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import {
  computeAvailableSlots,
  getClinicBookingEligibility,
} from "./lib/scheduling";

/**
 * Public dual-resource slot calculation query (Dentist + Chair + Sterilization Buffer).
 * Law #6: Returns ONLY sanitized timestamp + dentist/chair display metadata; zero patient PII.
 */
export const getAvailableSlots = query({
  args: {
    clinicId: v.id("clinics"),
    serviceId: v.id("services"),
    dateKey: v.string(),
    preferredDentistId: v.optional(v.id("dentists")),
    sessionId: v.optional(v.string()),
    ignoreAppointmentId: v.optional(v.id("appointments")),
    includeEmergencyBuffer: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [clinic, service] = await Promise.all([
      ctx.db.get(args.clinicId),
      ctx.db.get(args.serviceId),
    ]);

    if (!clinic || !service || service.clinicId !== clinic._id || !service.isActive) {
      return {
        isBookable: false,
        blockedReason: "Clinic or service is unavailable.",
        slots: [],
      };
    }

    const eligibility = getClinicBookingEligibility(clinic, Date.now());
    if (!eligibility.isBookable) {
      return {
        isBookable: false,
        blockedReason: eligibility.reason,
        slots: [],
      };
    }

    // Resolve caller when requesting staff-only privileges (emergency buffer or ignoreAppointmentId)
    let verifiedIgnoreAppointmentId: Id<"appointments"> | undefined;
    let verifiedIncludeEmergencyBuffer = false;
    if (args.ignoreAppointmentId || args.includeEmergencyBuffer) {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
          .unique();
        if (user && user.isActive) {
          const isClinicStaff =
            (user.clinicId === clinic._id && user.role !== "patient") ||
            user.role === "super_admin";
          if (args.includeEmergencyBuffer && isClinicStaff) {
            verifiedIncludeEmergencyBuffer = true;
          }
          if (args.ignoreAppointmentId) {
            const appt = await ctx.db.get(args.ignoreAppointmentId);
            if (appt && appt.clinicId === clinic._id) {
              if (isClinicStaff) {
                verifiedIgnoreAppointmentId = appt._id;
              } else {
                const patient = await ctx.db.get(appt.patientId);
                if (patient) {
                  let owns = patient.userId === user._id;
                  if (!owns && patient.guardianPatientId) {
                    const guardian = await ctx.db.get(patient.guardianPatientId);
                    owns = guardian?.userId === user._id;
                  }
                  if (owns) {
                    verifiedIgnoreAppointmentId = appt._id;
                  }
                }
              }
            }
          }
        }
      }
    }

    const slots = await computeAvailableSlots(ctx, {
      clinic,
      service,
      dateKey: args.dateKey,
      preferredDentistId: args.preferredDentistId,
      ignoreSessionId: args.sessionId,
      ignoreAppointmentId: verifiedIgnoreAppointmentId,
      includeEmergencyBuffer: verifiedIncludeEmergencyBuffer,
    });

    return {
      isBookable: true,
      blockedReason: null,
      slots,
    };
  },
});
