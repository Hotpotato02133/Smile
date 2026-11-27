import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/permissions";
import { getClinicBookingEligibility } from "./lib/scheduling";

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

function formatReferenceCode(appointmentId: string): string {
  return `SML-${appointmentId.slice(-6).toUpperCase()}`;
}

async function loadOwnedPatients(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const ownPatients = await ctx.db
    .query("patients")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(50);

  const dependentGroups = await Promise.all(
    ownPatients.map((p) =>
      ctx.db
        .query("patients")
        .withIndex("by_guardian", (q) => q.eq("guardianPatientId", p._id))
        .take(25)
    )
  );

  const dependents = dependentGroups.flat();
  const seen = new Set<Id<"patients">>();
  const allPatients: Doc<"patients">[] = [];
  for (const p of [...ownPatients, ...dependents]) {
    if (!seen.has(p._id)) {
      seen.add(p._id);
      allPatients.push(p);
    }
  }

  return { ownPatients, dependents, allPatients };
}

async function assertPatientOwnership(
  ctx: QueryCtx | MutationCtx,
  patientId: Id<"patients">,
  userId: Id<"users">
): Promise<Doc<"patients">> {
  const patient = await ctx.db.get(patientId);
  if (!patient) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Patient profile not found.",
    });
  }

  let isOwner = patient.userId === userId;
  if (!isOwner && patient.guardianPatientId) {
    const guardian = await ctx.db.get(patient.guardianPatientId);
    isOwner = guardian?.userId === userId;
  }

  if (!isOwner) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You can only access your own or your family dependents' records.",
    });
  }

  return patient;
}

/**
 * Primary real-time payload for the Patient Portal (`/patient`).
 * Enforces Law #2 (server-verified identity via `getAuthenticatedUser`) and
 * Law #6 (returns only records strictly owned by the signed-in patient or their dependents).
 */
export const getDashboardData = query({
  args: {
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign-in required." });
    }
    const referenceNow = args.nowMs ?? 0;

    // Fetch active announcements targeted to all_users + bookable public clinics for quick booking
    const [rawAnnouncements, activeClinics, trialClinics] = await Promise.all([
      ctx.db
        .query("systemAnnouncements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .order("desc")
        .take(10),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(50),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "trial"))
        .take(50),
    ]);

    const announcements = rawAnnouncements
      .filter(
        (a) =>
          a.targetAudience === "all_users" &&
          (!a.expiresAt || referenceNow === 0 || a.expiresAt >= referenceNow)
      )
      .slice(0, 3)
      .map((a) => ({
        _id: a._id,
        title: a.title,
        message: a.message,
        severity: a.severity,
        createdAt: a.createdAt,
      }));

    const bookableClinics = [...activeClinics, ...trialClinics]
      .filter((c) =>
        referenceNow > 0
          ? getClinicBookingEligibility(c, referenceNow).isBookable
          : c.status === "active" || c.status === "trial"
      )
      .slice(0, 50)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        tagline: c.tagline ?? null,
        primaryColorHex: c.primaryColorHex,
        city: c.city,
        province: c.province,
        address: c.address,
        phone: c.phone,
        activeDentistCount: c.activeDentistCount,
        activeChairCount: c.activeChairCount,
      }));

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user || !user.isActive) {
      const nameParts = (identity.name ?? "").trim().split(/\s+/);
      const firstName = identity.givenName ?? nameParts[0] ?? "Patient";
      const lastName =
        identity.familyName ?? (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

      return {
        user: {
          _id: "pending" as unknown as Id<"users">,
          firstName,
          lastName,
          email: identity.email ?? "",
          phone: identity.phoneNumber ?? "",
          role: "patient" as const,
        },
        announcements,
        profiles: [],
        appointments: [],
        waitlist: [],
        featuredClinics: bookableClinics,
      };
    }

    const { allPatients } = await loadOwnedPatients(ctx, user._id);
    const patientMap = new Map<Id<"patients">, Doc<"patients">>(
      allPatients.map((p) => [p._id, p])
    );

    // Fetch appointments for all owned profiles (self + dependents) in parallel
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

    // Collect referenced IDs for hydration
    const clinicIds = Array.from(
      new Set([
        ...allPatients.map((p) => p.clinicId),
        ...appointments.map((a) => a.clinicId),
      ])
    );
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

    // Fetch waitlist entries directly per owned patient via `by_patient` index
    const waitlistGroups = await Promise.all(
      allPatients.map((p) =>
        ctx.db
          .query("waitlist")
          .withIndex("by_patient", (q) => q.eq("patientId", p._id))
          .order("desc")
          .take(25)
      )
    );
    const rawWaitlistRows = waitlistGroups.flat();

    const extraServiceIds = Array.from(
      new Set(
        rawWaitlistRows
          .map((w) => w.serviceId)
          .filter((id) => !serviceMap.has(id))
      )
    );
    const extraServices = await Promise.all(
      extraServiceIds.map((id) => ctx.db.get(id))
    );
    for (const svc of extraServices) {
      if (svc) serviceMap.set(svc._id, svc);
    }

    const waitlistResults = rawWaitlistRows
      .map((row) => {
        const clinic = clinicMap.get(row.clinicId);
        const service = serviceMap.get(row.serviceId);
        const patient = patientMap.get(row.patientId);
        return {
          _id: row._id,
          clinicId: row.clinicId,
          clinicName: clinic?.name ?? "Dental Clinic",
          clinicSlug: clinic?.slug ?? "",
          patientId: row.patientId,
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`
            : "Patient",
          serviceId: row.serviceId,
          serviceName: service?.name ?? "Dental Procedure",
          preferredDentistId: row.preferredDentistId ?? null,
          preferredDateKey: row.preferredDateKey,
          preferredTimeWindow: row.preferredTimeWindow,
          status: row.status,
          createdAt: row.createdAt,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone ?? "",
        role: user.role,
      },
      announcements,
      profiles: allPatients.map((p) => {
        const clinic = clinicMap.get(p.clinicId);
        return {
          _id: p._id,
          clinicId: p.clinicId,
          clinicName: clinic?.name ?? "Dental Clinic",
          clinicSlug: clinic?.slug ?? "",
          clinicColorHex: clinic?.primaryColorHex ?? "#6C5CE7",
          isDependent: Boolean(p.guardianPatientId),
          guardianPatientId: p.guardianPatientId ?? null,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth,
          sex: p.sex,
          email: p.email ?? "",
          phone: p.phone,
          address: p.address ?? "",
          emergencyContactName: p.emergencyContactName ?? "",
          emergencyContactPhone: p.emergencyContactPhone ?? "",
          medicalHistory: {
            allergies: p.medicalHistory.allergies,
            conditions: p.medicalHistory.conditions,
            isTakingBloodThinners: p.medicalHistory.isTakingBloodThinners,
            isPregnant: p.medicalHistory.isPregnant,
            dentalAnxietyLevel: p.medicalHistory.dentalAnxietyLevel,
            notes: p.medicalHistory.notes ?? "",
          },
          lastCleaningDate: p.lastCleaningDate ?? null,
          nextRecallDate: p.nextRecallDate ?? null,
          createdAt: p.createdAt,
        };
      }),
      appointments: appointments.map((appt) => {
        const clinic = clinicMap.get(appt.clinicId);
        const service = serviceMap.get(appt.serviceId);
        const dentist = dentistMap.get(appt.dentistId);
        const chair = chairMap.get(appt.chairId);
        const patient = patientMap.get(appt.patientId);

        return {
          _id: appt._id,
          patientId: appt.patientId,
          referenceCode: formatReferenceCode(appt._id),
          status: appt.status,
          bookingSource: appt.bookingSource,
          dateKey: appt.dateKey,
          startTimeUtc: appt.startTimeUtc,
          endTimeUtc: appt.endTimeUtc,
          chiefComplaint: appt.chiefComplaint ?? null,
          postVisitInstructions: appt.postVisitInstructions ?? null,
          cancellationReason: appt.cancellationReason ?? null,
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`
            : "Patient",
          isDependent: Boolean(patient?.guardianPatientId),
          clinicId: appt.clinicId,
          clinicName: clinic?.name ?? "Dental Clinic",
          clinicSlug: clinic?.slug ?? "",
          clinicColorHex: clinic?.primaryColorHex ?? "#6C5CE7",
          clinicTimezone: clinic?.timezone ?? "Asia/Manila",
          clinicAddress: clinic
            ? `${clinic.address}, ${clinic.city}, ${clinic.province}`
            : "",
          clinicPhone: clinic?.phone ?? "",
          cancellationWindowHours: clinic?.cancellationWindowHours ?? 24,
          serviceId: appt.serviceId,
          serviceName: service?.name ?? "Dental Procedure",
          serviceCategory: service?.category ?? "Preventive",
          durationMinutes: service?.durationMinutes ?? 30,
          pricePhp: service?.pricePhp ?? 0,
          dentistId: appt.dentistId,
          dentistName: dentist?.displayName ?? "Assigned Dentist",
          chairId: appt.chairId,
          chairName: chair?.name ?? "Operatory Chair",
        };
      }),
      waitlist: waitlistResults,
      featuredClinics: bookableClinics,
    };
  },
});

/**
 * Authenticated read-only dental records (32-tooth summary & X-rays/photos)
 * strictly for a patient profile owned by the signed-in user or their dependent.
 */
export const getMyClinicalSummary = query({
  args: {
    patientId: v.id("patients"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign-in required." });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user || !user.isActive) {
      return null;
    }

    const patient = await assertPatientOwnership(ctx, args.patientId, user._id);

    const clinic = await ctx.db.get(patient.clinicId);

    const [toothRecords, files] = await Promise.all([
      ctx.db
        .query("toothRecords")
        .withIndex("by_clinic_and_patient_tooth", (q) =>
          q.eq("clinicId", patient.clinicId).eq("patientId", patient._id)
        )
        .take(200),
      ctx.db
        .query("clinicalFiles")
        .withIndex("by_clinic_and_patient", (q) =>
          q.eq("clinicId", patient.clinicId).eq("patientId", patient._id)
        )
        .order("desc")
        .take(30),
    ]);

    const dentistIds = Array.from(
      new Set(toothRecords.map((r) => r.recordedByDentistId))
    );
    const dentists = await Promise.all(dentistIds.map((id) => ctx.db.get(id)));
    const dentistMap = new Map(
      dentists
        .filter((d): d is Doc<"dentists"> => d !== null)
        .map((d) => [d._id, d.displayName])
    );

    const enrichedFiles = await Promise.all(
      files.map(async (f) => ({
        _id: f._id,
        fileName: f.fileName,
        fileType: f.fileType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
        url: await ctx.storage.getUrl(f.storageId),
      }))
    );

    return {
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      clinicName: clinic?.name ?? "Dental Clinic",
      clinicSlug: clinic?.slug ?? "",
      lastCleaningDate: patient.lastCleaningDate ?? null,
      nextRecallDate: patient.nextRecallDate ?? null,
      toothRecords: [...toothRecords]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => ({
          _id: r._id,
          toothNumber: r.toothNumber,
          surface: r.surface ?? "WholeTooth",
          condition: r.condition,
          treatmentStatus: r.treatmentStatus,
          notes: r.notes ?? null,
          recordedByDentistName:
            dentistMap.get(r.recordedByDentistId) ?? "Clinic Dentist",
          updatedAt: r.updatedAt,
        })),
      clinicalFiles: enrichedFiles,
    };
  },
});

/**
 * Updates an owned patient (or dependent) profile's demographics, emergency contact,
 * and structured dental/medical history flags.
 */
export const updateMyMedicalProfile = mutation({
  args: {
    patientId: v.id("patients"),
    firstName: v.string(),
    lastName: v.string(),
    dateOfBirth: v.string(),
    sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
    phone: v.string(),
    address: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    medicalHistory: medicalHistoryValidator,
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const patient = await assertPatientOwnership(ctx, args.patientId, user._id);

    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    const phone = args.phone.trim();
    if (!firstName || !lastName || !phone) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "First name, last name, and phone number are required.",
      });
    }

    await ctx.db.patch(patient._id, {
      firstName,
      lastName,
      dateOfBirth: args.dateOfBirth.trim() || patient.dateOfBirth,
      sex: args.sex,
      phone,
      address: args.address?.trim() || undefined,
      emergencyContactName: args.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: args.emergencyContactPhone?.trim() || undefined,
      medicalHistory: {
        allergies: args.medicalHistory.allergies
          .map((a) => a.trim())
          .filter(Boolean),
        conditions: args.medicalHistory.conditions
          .map((c) => c.trim())
          .filter(Boolean),
        isTakingBloodThinners: args.medicalHistory.isTakingBloodThinners,
        isPregnant: args.medicalHistory.isPregnant,
        dentalAnxietyLevel: args.medicalHistory.dentalAnxietyLevel,
        notes: args.medicalHistory.notes?.trim() || undefined,
      },
    });

    return { updated: true };
  },
});

/**
 * Creates a self profile or linked family dependent at a chosen bookable clinic
 * so patients can pre-complete health intake and add children/seniors before booking.
 */
export const createSelfOrDependentProfile = mutation({
  args: {
    clinicId: v.id("clinics"),
    profileKind: v.union(v.literal("self"), v.literal("dependent")),
    firstName: v.string(),
    lastName: v.string(),
    dateOfBirth: v.string(),
    sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
    phone: v.string(),
    address: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    medicalHistory: medicalHistoryValidator,
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic || !getClinicBookingEligibility(clinic, now).isBookable) {
      throw new ConvexError({
        code: "CLINIC_UNAVAILABLE",
        message: "Selected clinic is not currently accepting new profiles.",
      });
    }

    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    const phone = args.phone.trim();
    if (!firstName || !lastName || !phone) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "First name, last name, and phone number are required.",
      });
    }

    const cleanProfile = {
      firstName,
      lastName,
      dateOfBirth: args.dateOfBirth.trim() || "1995-01-01",
      sex: args.sex,
      email: user.email,
      phone,
      address: args.address?.trim() || undefined,
      emergencyContactName: args.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: args.emergencyContactPhone?.trim() || undefined,
      medicalHistory: {
        allergies: args.medicalHistory.allergies
          .map((a) => a.trim())
          .filter(Boolean),
        conditions: args.medicalHistory.conditions
          .map((c) => c.trim())
          .filter(Boolean),
        isTakingBloodThinners: args.medicalHistory.isTakingBloodThinners,
        isPregnant: args.medicalHistory.isPregnant,
        dentalAnxietyLevel: args.medicalHistory.dentalAnxietyLevel,
        notes: args.medicalHistory.notes?.trim() || undefined,
      },
    };

    const existingSelfList = await ctx.db
      .query("patients")
      .withIndex("by_clinic_and_user", (q) =>
        q.eq("clinicId", clinic._id).eq("userId", user._id)
      )
      .take(5);
    let selfProfile =
      existingSelfList.find((p) => !p.guardianPatientId) ??
      existingSelfList[0] ??
      null;

    if (args.profileKind === "self") {
      if (selfProfile) {
        await ctx.db.patch(selfProfile._id, cleanProfile);
        return { patientId: selfProfile._id };
      }
      const patientId = await ctx.db.insert("patients", {
        clinicId: clinic._id,
        userId: user._id,
        ...cleanProfile,
        noShowCount: 0,
        createdAt: now,
      });
      return { patientId };
    }

    // Dependent profile: ensure a guardian self-profile exists at this clinic
    if (!selfProfile) {
      const guardianId = await ctx.db.insert("patients", {
        clinicId: clinic._id,
        userId: user._id,
        firstName: user.firstName || "Account",
        lastName: user.lastName || "Holder",
        dateOfBirth: "1990-01-01",
        sex: "other",
        email: user.email,
        phone,
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

    const dependentId = await ctx.db.insert("patients", {
      clinicId: clinic._id,
      guardianPatientId: selfProfile._id,
      ...cleanProfile,
      noShowCount: 0,
      createdAt: now,
    });

    return { patientId: dependentId };
  },
});

/** Allows a patient to withdraw an active standby waitlist request. */
export const leaveWaitlist = mutation({
  args: {
    waitlistId: v.id("waitlist"),
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

    await assertPatientOwnership(ctx, entry.patientId, user._id);

    if (entry.status !== "waiting" && entry.status !== "notified") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Only active waitlist entries can be withdrawn.",
      });
    }

    await ctx.db.patch(entry._id, { status: "expired" });
    return { withdrawn: true };
  },
});

/**
 * Allows a guardian to delete a linked dependent sub-profile if it has no
 * appointments, odontogram entries, or clinical files recorded yet.
 */
export const deleteDependentProfile = mutation({
  args: {
    patientId: v.id("patients"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const patient = await assertPatientOwnership(ctx, args.patientId, user._id);

    if (!patient.guardianPatientId) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Only linked family dependent profiles can be removed here.",
      });
    }

    const [hasAppointment, hasToothRecord, hasFile] = await Promise.all([
      ctx.db
        .query("appointments")
        .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
        .first(),
      ctx.db
        .query("toothRecords")
        .withIndex("by_patient_and_tooth", (q) => q.eq("patientId", patient._id))
        .first(),
      ctx.db
        .query("clinicalFiles")
        .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
        .first(),
    ]);

    if (hasAppointment || hasToothRecord || hasFile) {
      throw new ConvexError({
        code: "HAS_CLINICAL_RECORDS",
        message:
          "This dependent has existing appointments or clinical records and cannot be deleted for medical record compliance.",
      });
    }

    const dependentWaitlist = await ctx.db
      .query("waitlist")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(50);
    for (const w of dependentWaitlist) {
      await ctx.db.delete(w._id);
    }

    await ctx.db.delete(patient._id);
    return { deleted: true };
  },
});
