import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { toManilaMonthKey } from "./lib/audit";
import { assertClinicCanWrite, getAuthenticatedUser } from "./lib/permissions";
import {
  getClinicBookingEligibility,
  verifySpecificPairAvailable,
} from "./lib/scheduling";

const medicalHistoryValidator = v.object({
  allergies: v.array(v.string()),
  conditions: v.array(v.string()),
  isTakingBloodThinners: v.boolean(),
  isPregnant: v.boolean(),
  dentalAnxietyLevel: v.union(
    v.literal("none"),
    v.literal("mild"),
    v.literal("moderate"),
    v.literal("severe")
  ),
  notes: v.optional(v.string()),
});

const patientProfileInputValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
  dateOfBirth: v.string(),
  sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
  email: v.optional(v.string()),
  phone: v.string(),
  address: v.optional(v.string()),
  emergencyContactName: v.optional(v.string()),
  emergencyContactPhone: v.optional(v.string()),
  medicalHistory: medicalHistoryValidator,
});

function formatReferenceCode(appointmentId: string): string {
  return `SML-${appointmentId.slice(-6).toUpperCase()}`;
}

/**
 * Public directory of bookable dental clinics on `/clinics`.
 * Law #6: Returns ONLY sanitized public clinic metadata.
 */
export const listPublicClinics = query({
  args: {
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [activeClinics, trialClinics, pastDueClinics] = await Promise.all([
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "trial"))
        .collect(),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "past_due"))
        .collect(),
    ]);

    const visible = [...activeClinics, ...trialClinics, ...pastDueClinics].filter(
      (c) => getClinicBookingEligibility(c, now).isBookable
    );

    const term = args.search?.trim().toLowerCase();
    const filtered = term
      ? visible.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.city.toLowerCase().includes(term) ||
            c.province.toLowerCase().includes(term) ||
            (c.tagline ?? "").toLowerCase().includes(term)
        )
      : visible;

    return Promise.all(
      filtered.map(async (c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        tagline: c.tagline ?? null,
        primaryColorHex: c.primaryColorHex,
        logoUrl: c.logoStorageId ? await ctx.storage.getUrl(c.logoStorageId) : null,
        city: c.city,
        province: c.province,
        address: c.address,
        phone: c.phone,
        activeDentistCount: c.activeDentistCount,
        activeChairCount: c.activeChairCount,
      }))
    );
  },
});

/**
 * Public branded clinic portal payload for `/c/[clinicSlug]`.
 * Law #6: Strictly sanitized clinic metadata, active services, and dentist display info.
 */
export const getPublicClinicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    const clinic = await ctx.db
      .query("clinics")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!clinic) return null;

    const eligibility = getClinicBookingEligibility(clinic, Date.now());

    const [services, dentists, logoUrl] = await Promise.all([
      ctx.db
        .query("services")
        .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinic._id))
        .collect(),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinic._id).eq("isActive", true)
        )
        .collect(),
      clinic.logoStorageId ? ctx.storage.getUrl(clinic.logoStorageId) : null,
    ]);

    return {
      clinic: {
        _id: clinic._id,
        name: clinic.name,
        slug: clinic.slug,
        tagline: clinic.tagline ?? null,
        primaryColorHex: clinic.primaryColorHex,
        logoUrl,
        phone: clinic.phone,
        address: clinic.address,
        city: clinic.city,
        province: clinic.province,
        timezone: clinic.timezone,
        slotIntervalMinutes: clinic.slotIntervalMinutes,
        cancellationWindowHours: clinic.cancellationWindowHours,
        operatingHours: clinic.operatingHours,
        isBookable: eligibility.isBookable,
        blockedReason: eligibility.reason,
      },
      services: services
        .filter((s) => s.isActive)
        .map((s) => ({
          _id: s._id,
          name: s.name,
          category: s.category,
          description: s.description,
          durationMinutes: s.durationMinutes,
          bufferMinutes: s.bufferMinutes,
          pricePhp: s.pricePhp,
          requiresXray: s.requiresXray,
          requiredChairTag: s.requiredChairTag ?? null,
        })),
      dentists: dentists.map((d) => ({
        _id: d._id,
        displayName: d.displayName,
        specialties: d.specialties,
        bio: d.bio ?? null,
        calendarColorHex: d.calendarColorHex,
        workingDays: d.weeklySchedule
          .filter((w) => w.isWorking)
          .map((w) => w.dayOfWeek),
      })),
    };
  },
});

/**
 * Authenticated query returning the signed-in user's own patient profile + family dependents at a clinic.
 */
export const getMyPatientProfilesForClinic = query({
  args: { clinicId: v.id("clinics") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user || !user.isActive) return null;

    const selfProfiles = await ctx.db
      .query("patients")
      .withIndex("by_clinic_and_user", (q) =>
        q.eq("clinicId", args.clinicId).eq("userId", user._id)
      )
      .collect();

    const selfProfile =
      selfProfiles.find((p) => !p.guardianPatientId) ?? selfProfiles[0] ?? null;

    const dependents = selfProfile
      ? await ctx.db
          .query("patients")
          .withIndex("by_guardian", (q) =>
            q.eq("guardianPatientId", selfProfile._id)
          )
          .collect()
      : [];

    return {
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone ?? "",
      },
      selfProfile,
      dependents: dependents.filter((d) => d.clinicId === args.clinicId),
    };
  },
});

/**
 * Step 4 ACID transaction: validates subscription status & monthly appointment quota,
 * verifies zero dual-resource conflicts, upserts patient/dependent intake profile,
 * creates the appointment, and deletes the temporary slot lock atomically.
 */
export const createOnlineBooking = mutation({
  args: {
    clinicId: v.id("clinics"),
    serviceId: v.id("services"),
    dateKey: v.string(),
    startTimeUtc: v.number(),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
    lockId: v.optional(v.id("slotLocks")),
    sessionId: v.string(),
    bookingFor: v.union(v.literal("self"), v.literal("dependent")),
    existingPatientId: v.optional(v.id("patients")),
    patientProfile: patientProfileInputValidator,
    chiefComplaint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);

    // Handle monthly counter rollover if entering a new calendar month
    const rawClinic = await ctx.db.get(args.clinicId);
    if (!rawClinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Clinic not found." });
    }
    if (rawClinic.currentMonthKey !== currentMonthKey) {
      await ctx.db.patch(args.clinicId, {
        currentMonthKey,
        currentMonthAppointmentCount: 0,
        currentMonthEmailCount: 0,
        updatedAt: now,
      });
    }

    // Law #4 + Monthly Appointments Quota Gate
    const clinic = await assertClinicCanWrite(ctx, args.clinicId, "appointment");

    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== args.clinicId || !service.isActive) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Selected dental service is no longer available.",
      });
    }

    // Law #5: ACID Dual-Resource Conflict Verification (Dentist + Chair + Buffer)
    const availabilityCheck = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: args.dateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
      ignoreSessionId: args.sessionId,
    });
    if (!availabilityCheck.ok) {
      throw new ConvexError({
        code: "SLOT_UNAVAILABLE",
        message:
          availabilityCheck.reason ??
          "This slot is no longer available. Please choose another time.",
      });
    }

    // Resolve or create patient / dependent chart inside this clinic
    const selfProfiles = await ctx.db
      .query("patients")
      .withIndex("by_clinic_and_user", (q) =>
        q.eq("clinicId", args.clinicId).eq("userId", user._id)
      )
      .collect();
    let selfProfile =
      selfProfiles.find((p) => !p.guardianPatientId) ?? selfProfiles[0] ?? null;

    const cleanProfile = {
      firstName: args.patientProfile.firstName.trim(),
      lastName: args.patientProfile.lastName.trim(),
      dateOfBirth: args.patientProfile.dateOfBirth.trim(),
      sex: args.patientProfile.sex,
      email: args.patientProfile.email?.trim().toLowerCase() || user.email,
      phone: args.patientProfile.phone.trim(),
      address: args.patientProfile.address?.trim() || undefined,
      emergencyContactName:
        args.patientProfile.emergencyContactName?.trim() || undefined,
      emergencyContactPhone:
        args.patientProfile.emergencyContactPhone?.trim() || undefined,
      medicalHistory: {
        allergies: args.patientProfile.medicalHistory.allergies
          .map((a) => a.trim())
          .filter(Boolean),
        conditions: args.patientProfile.medicalHistory.conditions
          .map((c) => c.trim())
          .filter(Boolean),
        isTakingBloodThinners:
          args.patientProfile.medicalHistory.isTakingBloodThinners,
        isPregnant: args.patientProfile.medicalHistory.isPregnant,
        dentalAnxietyLevel:
          args.patientProfile.medicalHistory.dentalAnxietyLevel,
        notes: args.patientProfile.medicalHistory.notes?.trim() || undefined,
      },
    };

    let targetPatientId: Id<"patients">;

    if (args.bookingFor === "self") {
      if (selfProfile) {
        await ctx.db.patch(selfProfile._id, cleanProfile);
        targetPatientId = selfProfile._id;
      } else {
        targetPatientId = await ctx.db.insert("patients", {
          clinicId: args.clinicId,
          userId: user._id,
          ...cleanProfile,
          noShowCount: 0,
          createdAt: now,
        });
      }
    } else {
      // Ensure the signed-in guardian has a parent patient record at this clinic first
      if (!selfProfile) {
        const guardianId = await ctx.db.insert("patients", {
          clinicId: args.clinicId,
          userId: user._id,
          firstName: user.firstName || "Account",
          lastName: user.lastName || "Holder",
          dateOfBirth: "1990-01-01",
          sex: "other",
          email: user.email,
          phone: cleanProfile.phone,
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
        selfProfile = (await ctx.db.get(guardianId))!;
      }

      if (args.existingPatientId) {
        const existingDep = await ctx.db.get(args.existingPatientId);
        if (
          !existingDep ||
          existingDep.clinicId !== args.clinicId ||
          existingDep.guardianPatientId !== selfProfile._id
        ) {
          throw new ConvexError({
            code: "FORBIDDEN",
            message: "Selected dependent does not belong to your account.",
          });
        }
        await ctx.db.patch(existingDep._id, cleanProfile);
        targetPatientId = existingDep._id;
      } else {
        targetPatientId = await ctx.db.insert("patients", {
          clinicId: args.clinicId,
          guardianPatientId: selfProfile._id,
          ...cleanProfile,
          noShowCount: 0,
          createdAt: now,
        });
      }
    }

    // Insert appointment
    const appointmentId = await ctx.db.insert("appointments", {
      clinicId: args.clinicId,
      patientId: targetPatientId,
      dentistId: args.dentistId,
      chairId: args.chairId,
      serviceId: args.serviceId,
      dateKey: args.dateKey,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: availabilityCheck.endTimeUtc,
      bufferEndTimeUtc: availabilityCheck.bufferEndTimeUtc,
      status: "confirmed",
      bookingSource: "patient_online",
      chiefComplaint: args.chiefComplaint?.trim() || undefined,
      reminder24hSent: false,
      reminder2hSent: false,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    // Release temporary lock(s) atomically inside the same transaction
    if (args.lockId) {
      const lock = await ctx.db.get(args.lockId);
      if (lock && lock.clinicId === args.clinicId) {
        await ctx.db.delete(lock._id);
      }
    }
    const sessionLocks = await ctx.db
      .query("slotLocks")
      .withIndex("by_clinic_and_expires", (q) =>
        q.eq("clinicId", args.clinicId).gt("expiresAtUtc", now)
      )
      .collect();
    for (const l of sessionLocks) {
      if (l.lockedBySessionId === args.sessionId) {
        await ctx.db.delete(l._id);
      }
    }

    // Increment clinic counters
    await ctx.db.patch(args.clinicId, {
      currentMonthAppointmentCount: clinic.currentMonthAppointmentCount + 1,
      lifetimeAppointmentCount: clinic.lifetimeAppointmentCount + 1,
      updatedAt: now,
    });

    // Fire Resend booking confirmation asynchronously (internalAction)
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
      referenceCode: formatReferenceCode(appointmentId),
      clinicName: clinic.name,
      clinicSlug: clinic.slug,
      clinicAddress: `${clinic.address}, ${clinic.city}, ${clinic.province}`,
      clinicPhone: clinic.phone,
      cancellationWindowHours: clinic.cancellationWindowHours,
      serviceName: service.name,
      pricePhp: service.pricePhp,
      dentistName: dentist?.displayName ?? "Assigned Dentist",
      chairName: chair?.name ?? "Operatory Chair",
      patientName: `${cleanProfile.firstName} ${cleanProfile.lastName}`,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: availabilityCheck.endTimeUtc,
    };
  },
});

/**
 * Authenticated query for `/patient` listing all appointments across every clinic
 * for the signed-in patient and their family dependents.
 */
export const getMyAppointments = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    const ownPatients = await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const dependentGroups = await Promise.all(
      ownPatients.map((p) =>
        ctx.db
          .query("patients")
          .withIndex("by_guardian", (q) => q.eq("guardianPatientId", p._id))
          .collect()
      )
    );
    const allPatients: Doc<"patients">[] = [
      ...ownPatients,
      ...dependentGroups.flat(),
    ];
    const patientMap = new Map<Id<"patients">, Doc<"patients">>(
      allPatients.map((p) => [p._id, p])
    );

    const appointmentGroups = await Promise.all(
      allPatients.map((p) =>
        ctx.db
          .query("appointments")
          .withIndex("by_patient", (q) => q.eq("patientId", p._id))
          .order("desc")
          .take(50)
      )
    );
    const appointments = appointmentGroups
      .flat()
      .sort((a, b) => b.startTimeUtc - a.startTimeUtc);

    const clinicIds = Array.from(new Set(appointments.map((a) => a.clinicId)));
    const serviceIds = Array.from(new Set(appointments.map((a) => a.serviceId)));
    const dentistIds = Array.from(new Set(appointments.map((a) => a.dentistId)));
    const chairIds = Array.from(new Set(appointments.map((a) => a.chairId)));

    const [clinics, services, dentists, chairs] = await Promise.all([
      Promise.all(clinicIds.map((id) => ctx.db.get(id))),
      Promise.all(serviceIds.map((id) => ctx.db.get(id))),
      Promise.all(dentistIds.map((id) => ctx.db.get(id))),
      Promise.all(chairIds.map((id) => ctx.db.get(id))),
    ]);

    const clinicMap = new Map(
      clinics.filter((c): c is Doc<"clinics"> => c !== null).map((c) => [c._id, c])
    );
    const serviceMap = new Map(
      services
        .filter((s): s is Doc<"services"> => s !== null)
        .map((s) => [s._id, s])
    );
    const dentistMap = new Map(
      dentists
        .filter((d): d is Doc<"dentists"> => d !== null)
        .map((d) => [d._id, d])
    );
    const chairMap = new Map(
      chairs.filter((c): c is Doc<"chairs"> => c !== null).map((c) => [c._id, c])
    );

    return appointments.map((appt) => {
      const clinic = clinicMap.get(appt.clinicId);
      const service = serviceMap.get(appt.serviceId);
      const dentist = dentistMap.get(appt.dentistId);
      const chair = chairMap.get(appt.chairId);
      const patient = patientMap.get(appt.patientId);

      return {
        _id: appt._id,
        referenceCode: formatReferenceCode(appt._id),
        status: appt.status,
        dateKey: appt.dateKey,
        startTimeUtc: appt.startTimeUtc,
        endTimeUtc: appt.endTimeUtc,
        chiefComplaint: appt.chiefComplaint ?? null,
        postVisitInstructions: appt.postVisitInstructions ?? null,
        patientName: patient
          ? `${patient.firstName} ${patient.lastName}`
          : "Patient",
        isDependent: Boolean(patient?.guardianPatientId),
        clinicName: clinic?.name ?? "Dental Clinic",
        clinicSlug: clinic?.slug ?? "",
        clinicAddress: clinic
          ? `${clinic.address}, ${clinic.city}, ${clinic.province}`
          : "",
        clinicPhone: clinic?.phone ?? "",
        cancellationWindowHours: clinic?.cancellationWindowHours ?? 24,
        serviceName: service?.name ?? "Dental Procedure",
        pricePhp: service?.pricePhp ?? 0,
        dentistName: dentist?.displayName ?? "Assigned Dentist",
        chairName: chair?.name ?? "Operatory Chair",
      };
    });
  },
});

/** Allows a patient to cancel their own (or dependent's) upcoming appointment respecting clinic policy. */
export const cancelMyAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const appt = await ctx.db.get(args.appointmentId);
    if (!appt) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found.",
      });
    }

    const patient = await ctx.db.get(appt.patientId);
    if (!patient) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Patient not found." });
    }

    let isOwner = patient.userId === user._id;
    if (!isOwner && patient.guardianPatientId) {
      const guardian = await ctx.db.get(patient.guardianPatientId);
      isOwner = guardian?.userId === user._id;
    }
    if (!isOwner) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only cancel your own or your dependent's appointments.",
      });
    }

    if (
      appt.status === "cancelled" ||
      appt.status === "completed" ||
      appt.status === "in_chair"
    ) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "This appointment can no longer be cancelled online.",
      });
    }

    const clinic = await ctx.db.get(appt.clinicId);
    const windowMs = (clinic?.cancellationWindowHours ?? 24) * 60 * 60 * 1000;
    if (appt.startTimeUtc - Date.now() < windowMs) {
      throw new ConvexError({
        code: "CANCELLATION_WINDOW_PASSED",
        message: `Online cancellation requires at least ${clinic?.cancellationWindowHours ?? 24} hours notice. Please call the clinic directly.`,
      });
    }

    await ctx.db.patch(appt._id, {
      status: "cancelled",
      cancellationReason: args.reason?.trim() || "Cancelled by patient online",
      updatedAt: Date.now(),
    });

    // Notify waitlisted patients asynchronously if waitlist automation is enabled
    await ctx.scheduler.runAfter(
      0,
      internal.waitlist.notifyWaitlistForCancellation,
      {
        clinicId: appt.clinicId,
        dateKey: appt.dateKey,
        dentistId: appt.dentistId,
      }
    );

    return { cancelled: true };
  },
});
