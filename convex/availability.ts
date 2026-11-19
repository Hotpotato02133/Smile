import { v } from "convex/values";
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

    const slots = await computeAvailableSlots(ctx, {
      clinic,
      service,
      dateKey: args.dateKey,
      preferredDentistId: args.preferredDentistId,
      ignoreSessionId: args.sessionId,
    });

    return {
      isBookable: true,
      blockedReason: null,
      slots,
    };
  },
});
