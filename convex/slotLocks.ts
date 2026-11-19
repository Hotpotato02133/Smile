import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import {
  computeAvailableSlots,
  getClinicBookingEligibility,
  SLOT_LOCK_DURATION_MS,
  verifySpecificPairAvailable,
} from "./lib/scheduling";

/**
 * Acquires a real-time 5-minute temporary slot hold for a `(dentistId, chairId)` pair.
 * Releases any prior lock held by `sessionId` in the same clinic and schedules automatic cleanup.
 */
export const acquireLock = mutation({
  args: {
    clinicId: v.id("clinics"),
    serviceId: v.id("services"),
    dateKey: v.string(),
    startTimeUtc: v.number(),
    dentistId: v.optional(v.id("dentists")),
    chairId: v.optional(v.id("chairs")),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionId = args.sessionId.trim();
    if (!sessionId) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Booking session ID is required.",
      });
    }

    const [clinic, service] = await Promise.all([
      ctx.db.get(args.clinicId),
      ctx.db.get(args.serviceId),
    ]);
    if (!clinic || !service || service.clinicId !== clinic._id || !service.isActive) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Clinic or dental service not found.",
      });
    }

    const now = Date.now();
    const eligibility = getClinicBookingEligibility(clinic, now);
    if (!eligibility.isBookable) {
      throw new ConvexError({
        code: "CLINIC_READ_ONLY",
        message: eligibility.reason ?? "Online booking is currently unavailable.",
      });
    }

    // Release any existing active locks held by this same session in this clinic
    const existingActiveLocks = await ctx.db
      .query("slotLocks")
      .withIndex("by_clinic_and_expires", (q) =>
        q.eq("clinicId", args.clinicId).gt("expiresAtUtc", now)
      )
      .collect();
    for (const lock of existingActiveLocks) {
      if (lock.lockedBySessionId === sessionId) {
        await ctx.db.delete(lock._id);
      }
    }

    let chosenDentistId = args.dentistId;
    let chosenChairId = args.chairId;
    let endTimeUtc = args.startTimeUtc + service.durationMinutes * 60_000;
    let bufferEndTimeUtc =
      args.startTimeUtc +
      (service.durationMinutes + service.bufferMinutes) * 60_000;

    if (chosenDentistId && chosenChairId) {
      const check = await verifySpecificPairAvailable(ctx, {
        clinic,
        service,
        dateKey: args.dateKey,
        dentistId: chosenDentistId,
        chairId: chosenChairId,
        startTimeUtc: args.startTimeUtc,
        ignoreSessionId: sessionId,
      });
      if (!check.ok) {
        // Fallback: see if another eligible dentist/chair pair is free at this exact time
        const fallbackSlots = await computeAvailableSlots(ctx, {
          clinic,
          service,
          dateKey: args.dateKey,
          preferredDentistId: args.dentistId,
          ignoreSessionId: sessionId,
        });
        const match = fallbackSlots.find(
          (s) => s.startTimeUtc === args.startTimeUtc
        );
        if (!match) {
          throw new ConvexError({
            code: "SLOT_UNAVAILABLE",
            message:
              check.reason ??
              "This time slot is no longer available. Please select another slot.",
          });
        }
        chosenDentistId = match.dentistId;
        chosenChairId = match.chairId;
        endTimeUtc = match.endTimeUtc;
        bufferEndTimeUtc = match.bufferEndTimeUtc;
      } else {
        endTimeUtc = check.endTimeUtc;
        bufferEndTimeUtc = check.bufferEndTimeUtc;
      }
    } else {
      const availableSlots = await computeAvailableSlots(ctx, {
        clinic,
        service,
        dateKey: args.dateKey,
        preferredDentistId: args.dentistId,
        ignoreSessionId: sessionId,
      });
      const match = availableSlots.find(
        (s) => s.startTimeUtc === args.startTimeUtc
      );
      if (!match) {
        throw new ConvexError({
          code: "SLOT_UNAVAILABLE",
          message:
            "This time slot is no longer available. Please select another slot.",
        });
      }
      chosenDentistId = match.dentistId;
      chosenChairId = match.chairId;
      endTimeUtc = match.endTimeUtc;
      bufferEndTimeUtc = match.bufferEndTimeUtc;
    }

    const expiresAtUtc = now + SLOT_LOCK_DURATION_MS;
    const lockId = await ctx.db.insert("slotLocks", {
      clinicId: clinic._id,
      dentistId: chosenDentistId,
      chairId: chosenChairId,
      startTimeUtc: args.startTimeUtc,
      bufferEndTimeUtc,
      lockedBySessionId: sessionId,
      expiresAtUtc,
    });

    // Automatic cleanup after 5 minutes (Convex Scheduled Function)
    await ctx.scheduler.runAfter(
      SLOT_LOCK_DURATION_MS,
      internal.slotLocks.releaseLock,
      { lockId }
    );

    const [dentist, chair] = await Promise.all([
      ctx.db.get(chosenDentistId),
      ctx.db.get(chosenChairId),
    ]);

    return {
      lockId,
      dentistId: chosenDentistId,
      dentistName: dentist?.displayName ?? "Assigned Dentist",
      chairId: chosenChairId,
      chairName: chair?.name ?? "Operatory Chair",
      startTimeUtc: args.startTimeUtc,
      endTimeUtc,
      bufferEndTimeUtc,
      expiresAtUtc,
    };
  },
});

/** Releases any active lock held by the caller's booking session when backing out of a slot. */
export const releaseSessionLock = mutation({
  args: {
    clinicId: v.id("clinics"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const activeLocks = await ctx.db
      .query("slotLocks")
      .withIndex("by_clinic_and_expires", (q) =>
        q.eq("clinicId", args.clinicId).gt("expiresAtUtc", Date.now())
      )
      .collect();
    let released = 0;
    for (const lock of activeLocks) {
      if (lock.lockedBySessionId === args.sessionId) {
        await ctx.db.delete(lock._id);
        released++;
      }
    }
    return { released };
  },
});

/** Scheduled cleanup triggered 5 minutes after `acquireLock`. */
export const releaseLock = internalMutation({
  args: { lockId: v.id("slotLocks") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.lockId);
    if (existing) {
      await ctx.db.delete(args.lockId);
    }
  },
});
