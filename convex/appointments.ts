import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { recordAuditLog, toManilaMonthKey } from "./lib/audit";
import {
  assertClinicCanWrite,
  type ClinicResourceType,
  requireClinicAccess,
} from "./lib/permissions";
import {
  parseDateKey,
  verifySpecificPairAvailable,
} from "./lib/scheduling";

const appointmentStatusValidator = v.union(
  v.literal("pending_approval"),
  v.literal("confirmed"),
  v.literal("checked_in"),
  v.literal("in_chair"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("no_show")
);

const staffRoles = ["receptionist", "dentist", "clinic_admin"] as const;

async function requireStaffWrite(
  ctx: MutationCtx,
  resourceType: ClinicResourceType
) {
  const access = await requireClinicAccess(ctx, [...staffRoles]);
  if (access.isSuperAdminOverride || access.user.role === "super_admin") {
    throw new ConvexError({
      code: "READ_ONLY_IMPERSONATION",
      message: "Super Admin View-As-Clinic mode is strictly read-only.",
    });
  }
  const clinic = await assertClinicCanWrite(ctx, access.clinicId, resourceType);
  return { ...access, clinic };
}

/** Computes `"YYYY-MM-DD"` + 6 months for automatic hygiene recall scheduling. */
function addSixMonthsDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const dt = new Date(Date.UTC(parsed.year, parsed.month - 1 + 6, parsed.day));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hasCriticalMedicalAlert(patient: Doc<"patients">): boolean {
  const mh = patient.medicalHistory;
  return (
    mh.allergies.length > 0 ||
    mh.isTakingBloodThinners ||
    mh.isPregnant ||
    mh.dentalAnxietyLevel === "severe"
  );
}

// ============================================================================
// 1. FRONT-DESK COMMAND CENTER & MASTER CALENDAR QUERIES
// ============================================================================

export const getFrontDeskWorkspace = query({
  args: {
    dateKey: v.string(),
    rangeStartKey: v.optional(v.string()),
    rangeEndKey: v.optional(v.string()),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { user, clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, [...staffRoles], args.overrideClinicId);

    const startKey = args.rangeStartKey ?? args.dateKey;
    const endKey = args.rangeEndKey ?? args.dateKey;
    const now = Date.now();

    const [plan, dentists, chairs, services, appointments, waitlistRows] =
      await Promise.all([
        ctx.db.get(clinic.planId),
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("chairs")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("services")
          .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
          .collect(),
        ctx.db
          .query("appointments")
          .withIndex("by_clinic_and_date", (q) =>
            q
              .eq("clinicId", clinicId)
              .gte("dateKey", startKey)
              .lte("dateKey", endKey)
          )
          .collect(),
        ctx.db
          .query("waitlist")
          .withIndex("by_clinic_and_date", (q) =>
            q.eq("clinicId", clinicId).eq("preferredDateKey", args.dateKey)
          )
          .collect(),
      ]);

    const patientIds = Array.from(
      new Set([
        ...appointments.map((a) => a.patientId),
        ...waitlistRows.map((w) => w.patientId),
      ])
    );
    const patients = await Promise.all(patientIds.map((id) => ctx.db.get(id)));

    const patientMap = new Map<Id<"patients">, Doc<"patients">>(
      patients
        .filter((p): p is Doc<"patients"> => p !== null && p.clinicId === clinicId)
        .map((p) => [p._id, p])
    );
    const dentistMap = new Map<Id<"dentists">, Doc<"dentists">>(
      dentists.map((d) => [d._id, d])
    );
    const chairMap = new Map<Id<"chairs">, Doc<"chairs">>(
      chairs.map((c) => [c._id, c])
    );
    const serviceMap = new Map<Id<"services">, Doc<"services">>(
      services.map((s) => [s._id, s])
    );

    const enrichedAppointments = appointments
      .sort((a, b) => a.startTimeUtc - b.startTimeUtc)
      .map((appt) => {
        const patient = patientMap.get(appt.patientId);
        const dentist = dentistMap.get(appt.dentistId);
        const chair = chairMap.get(appt.chairId);
        const service = serviceMap.get(appt.serviceId);
        return {
          ...appt,
          referenceCode: `SML-${appt._id.slice(-6).toUpperCase()}`,
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`
            : "Unknown Patient",
          patientPhone: patient?.phone ?? "",
          hasMedicalAlert: patient ? hasCriticalMedicalAlert(patient) : false,
          medicalSummary: patient
            ? {
                allergies: patient.medicalHistory.allergies,
                isTakingBloodThinners:
                  patient.medicalHistory.isTakingBloodThinners,
                isPregnant: patient.medicalHistory.isPregnant,
                dentalAnxietyLevel: patient.medicalHistory.dentalAnxietyLevel,
              }
            : null,
          dentistName: dentist?.displayName ?? "Assigned Dentist",
          dentistColorHex: dentist?.calendarColorHex ?? "#0284c7",
          chairName: chair?.name ?? "Operatory Chair",
          chairRoomCode: chair?.roomCode ?? "",
          serviceName: service?.name ?? "Dental Procedure",
          serviceCategory: service?.category ?? "Preventive",
          servicePricePhp: service?.pricePhp ?? 0,
          durationMinutes: service?.durationMinutes ?? 30,
          bufferMinutes: service?.bufferMinutes ?? 15,
        };
      });

    const enrichedWaitlist = waitlistRows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((w) => {
        const patient = patientMap.get(w.patientId);
        const service = serviceMap.get(w.serviceId);
        const preferredDentist = w.preferredDentistId
          ? dentistMap.get(w.preferredDentistId)
          : null;
        return {
          ...w,
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`
            : "Patient",
          patientPhone: patient?.phone ?? "",
          serviceName: service?.name ?? "Dental Procedure",
          preferredDentistName: preferredDentist?.displayName ?? "Any Dentist",
        };
      });

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
      isSuperAdminOverride,
      isReadOnly,
      dentists: dentists.map((d) => ({
        _id: d._id,
        displayName: d.displayName,
        calendarColorHex: d.calendarColorHex,
        defaultChairId: d.defaultChairId ?? null,
      })),
      chairs: chairs.map((c) => ({
        _id: c._id,
        name: c.name,
        roomCode: c.roomCode,
        supportedCategoryTags: c.supportedCategoryTags,
      })),
      services: services
        .filter((s) => s.isActive)
        .map((s) => ({
          _id: s._id,
          name: s.name,
          category: s.category,
          durationMinutes: s.durationMinutes,
          bufferMinutes: s.bufferMinutes,
          pricePhp: s.pricePhp,
          requiredChairTag: s.requiredChairTag ?? null,
        })),
      appointments: enrichedAppointments,
      waitlist: enrichedWaitlist,
    };
  },
});

export const searchClinicPatients = query({
  args: {
    search: v.optional(v.string()),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      [...staffRoles],
      args.overrideClinicId
    );

    const patients = await ctx.db
      .query("patients")
      .withIndex("by_clinic_and_phone", (q) => q.eq("clinicId", clinicId))
      .take(200);

    const term = args.search?.trim().toLowerCase();
    const filtered = term
      ? patients.filter(
          (p) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(term) ||
            p.phone.toLowerCase().includes(term) ||
            (p.email ?? "").toLowerCase().includes(term)
        )
      : patients;

    return filtered.slice(0, 30).map((p) => ({
      _id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email ?? null,
      dateOfBirth: p.dateOfBirth,
      noShowCount: p.noShowCount,
      hasMedicalAlert: hasCriticalMedicalAlert(p),
    }));
  },
});

// ============================================================================
// 2. DENTIST CHAIR QUEUE QUERY (/staff)
// ============================================================================

export const getDentistQueue = query({
  args: {
    dateKey: v.string(),
    dentistId: v.optional(v.id("dentists")),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { user, clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, ["dentist", "clinic_admin"], args.overrideClinicId);

    const now = Date.now();
    const [plan, activeDentists, myDentistProfile, dayAppointments, chairs, services] =
      await Promise.all([
        ctx.db.get(clinic.planId),
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("dentists")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique(),
        ctx.db
          .query("appointments")
          .withIndex("by_clinic_and_date", (q) =>
            q.eq("clinicId", clinicId).eq("dateKey", args.dateKey)
          )
          .collect(),
        ctx.db
          .query("chairs")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("services")
          .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
          .collect(),
      ]);

    const resolvedDentistId =
      args.dentistId ??
      (myDentistProfile && myDentistProfile.clinicId === clinicId
        ? myDentistProfile._id
        : activeDentists[0]?._id ?? null);

    const queueAppointments = dayAppointments
      .filter(
        (a) =>
          a.status !== "cancelled" &&
          (!resolvedDentistId || a.dentistId === resolvedDentistId)
      )
      .sort((a, b) => a.startTimeUtc - b.startTimeUtc);

    const patientIds = Array.from(
      new Set(queueAppointments.map((a) => a.patientId))
    );
    const patients = await Promise.all(patientIds.map((id) => ctx.db.get(id)));

    const patientMap = new Map<Id<"patients">, Doc<"patients">>(
      patients
        .filter((p): p is Doc<"patients"> => p !== null && p.clinicId === clinicId)
        .map((p) => [p._id, p])
    );
    const chairMap = new Map(chairs.map((c) => [c._id, c]));
    const serviceMap = new Map(services.map((s) => [s._id, s]));

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
      isSuperAdminOverride,
      isReadOnly,
      selectedDentistId: resolvedDentistId,
      dentists: activeDentists.map((d) => ({
        _id: d._id,
        displayName: d.displayName,
        calendarColorHex: d.calendarColorHex,
      })),
      queue: queueAppointments.map((appt) => {
        const patient = patientMap.get(appt.patientId);
        const chair = chairMap.get(appt.chairId);
        const service = serviceMap.get(appt.serviceId);
        return {
          ...appt,
          referenceCode: `SML-${appt._id.slice(-6).toUpperCase()}`,
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`
            : "Unknown Patient",
          patientPhone: patient?.phone ?? "",
          patientDob: patient?.dateOfBirth ?? "",
          hasMedicalAlert: patient ? hasCriticalMedicalAlert(patient) : false,
          medicalHistory: patient?.medicalHistory ?? null,
          chairName: chair?.name ?? "Operatory Chair",
          chairRoomCode: chair?.roomCode ?? "",
          serviceName: service?.name ?? "Dental Procedure",
          serviceCategory: service?.category ?? "Preventive",
        };
      }),
    };
  },
});

// ============================================================================
// 3. WALK-IN / PHONE BOOKING, KANBAN TRANSITIONS & RESCHEDULE MUTATIONS
// ============================================================================

export const createWalkInBooking = mutation({
  args: {
    dateKey: v.string(),
    startTimeUtc: v.number(),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
    serviceId: v.id("services"),
    bookingSource: v.union(
      v.literal("front_desk_walk_in"),
      v.literal("front_desk_phone"),
      v.literal("dentist_followup")
    ),
    initialStatus: v.optional(
      v.union(v.literal("confirmed"), v.literal("checked_in"))
    ),
    existingPatientId: v.optional(v.id("patients")),
    newPatient: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        dateOfBirth: v.string(),
        sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
        allergies: v.optional(v.array(v.string())),
        conditions: v.optional(v.array(v.string())),
        isTakingBloodThinners: v.optional(v.boolean()),
        isPregnant: v.optional(v.boolean()),
        dentalAnxietyLevel: v.optional(
          v.union(
            v.literal("none"),
            v.literal("mild"),
            v.literal("moderate"),
            v.literal("severe")
          )
        ),
      })
    ),
    chiefComplaint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, [...staffRoles]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }

    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);
    if (access.clinic.currentMonthKey !== currentMonthKey) {
      await ctx.db.patch(access.clinicId, {
        currentMonthKey,
        currentMonthAppointmentCount: 0,
        currentMonthEmailCount: 0,
        updatedAt: now,
      });
    }

    // Law #4 + Monthly Appointments Quota Gate
    const clinic = await assertClinicCanWrite(ctx, access.clinicId, "appointment");
    const clinicId = clinic._id;

    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinicId || !service.isActive) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Selected dental service is not active in this clinic.",
      });
    }

    // Law #5: ACID dual-resource conflict verification (Dentist + Chair + Buffer)
    const check = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: args.dateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
    });
    if (!check.ok) {
      throw new ConvexError({
        code: "SLOT_UNAVAILABLE",
        message:
          check.reason ??
          "Either the dentist or the operatory chair is already booked for this time.",
      });
    }

    let patientId: Id<"patients">;
    if (args.existingPatientId) {
      const existing = await ctx.db.get(args.existingPatientId);
      if (!existing || existing.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Patient record does not belong to this clinic.",
        });
      }
      patientId = existing._id;
    } else if (args.newPatient) {
      // Guest/walk-in patient profile without requiring a Clerk account (`userId` omitted)
      patientId = await ctx.db.insert("patients", {
        clinicId,
        firstName: args.newPatient.firstName.trim(),
        lastName: args.newPatient.lastName.trim(),
        phone: args.newPatient.phone.trim(),
        email: args.newPatient.email?.trim().toLowerCase() || undefined,
        dateOfBirth: args.newPatient.dateOfBirth.trim() || "1990-01-01",
        sex: args.newPatient.sex,
        medicalHistory: {
          allergies: args.newPatient.allergies ?? [],
          conditions: args.newPatient.conditions ?? [],
          isTakingBloodThinners: args.newPatient.isTakingBloodThinners ?? false,
          isPregnant: args.newPatient.isPregnant ?? false,
          dentalAnxietyLevel: args.newPatient.dentalAnxietyLevel ?? "none",
        },
        noShowCount: 0,
        createdAt: now,
      });
    } else {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Select an existing patient or enter new walk-in patient details.",
      });
    }

    const status =
      args.initialStatus ??
      (args.bookingSource === "front_desk_walk_in" ? "checked_in" : "confirmed");

    const appointmentId = await ctx.db.insert("appointments", {
      clinicId,
      patientId,
      dentistId: args.dentistId,
      chairId: args.chairId,
      serviceId: args.serviceId,
      dateKey: args.dateKey,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: check.endTimeUtc,
      bufferEndTimeUtc: check.bufferEndTimeUtc,
      status,
      bookingSource: args.bookingSource,
      chiefComplaint: args.chiefComplaint?.trim() || undefined,
      reminder24hSent: false,
      reminder2hSent: false,
      createdByUserId: access.user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(clinicId, {
      currentMonthAppointmentCount: clinic.currentMonthAppointmentCount + 1,
      lifetimeAppointmentCount: clinic.lifetimeAppointmentCount + 1,
      updatedAt: now,
    });

    return {
      appointmentId,
      referenceCode: `SML-${appointmentId.slice(-6).toUpperCase()}`,
    };
  },
});

export const transitionStatus = mutation({
  args: {
    appointmentId: v.id("appointments"),
    status: appointmentStatusValidator,
    clinicalNotes: v.optional(v.string()),
    postVisitInstructions: v.optional(v.string()),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { clinic, clinicId } = await requireStaffWrite(ctx, "staff");

    const appt = await ctx.db.get(args.appointmentId);
    if (!appt || appt.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found in this clinic.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(appt._id, {
      status: args.status,
      clinicalNotes:
        args.clinicalNotes !== undefined
          ? args.clinicalNotes.trim() || undefined
          : appt.clinicalNotes,
      postVisitInstructions:
        args.postVisitInstructions !== undefined
          ? args.postVisitInstructions.trim() || undefined
          : appt.postVisitInstructions,
      cancellationReason:
        args.cancellationReason !== undefined
          ? args.cancellationReason.trim() || undefined
          : appt.cancellationReason,
      updatedAt: now,
    });

    let hygieneRecallScheduledFor: string | null = null;
    let waitlistMatchedCount = 0;

    if (args.status === "no_show" && appt.status !== "no_show") {
      const patient = await ctx.db.get(appt.patientId);
      if (patient && patient.clinicId === clinicId) {
        await ctx.db.patch(patient._id, {
          noShowCount: patient.noShowCount + 1,
        });
      }
    }

    // Automatic 6-Month Hygiene Recall on Oral Prophylaxis / Preventive completion
    if (args.status === "completed") {
      const [service, patient] = await Promise.all([
        ctx.db.get(appt.serviceId),
        ctx.db.get(appt.patientId),
      ]);
      const isCleaning =
        service &&
        (service.category === "Preventive" ||
          service.name.toLowerCase().includes("prophylaxis") ||
          service.name.toLowerCase().includes("cleaning"));

      if (isCleaning && patient && patient.clinicId === clinicId) {
        const nextRecallDate = addSixMonthsDateKey(appt.dateKey);
        await ctx.db.patch(patient._id, {
          lastCleaningDate: appt.dateKey,
          nextRecallDate,
        });
        hygieneRecallScheduledFor = nextRecallDate;
      }
    }

    // Check standby waitlist & schedule Resend opening blast on cancellation
    if (args.status === "cancelled" && clinic.featureFlags.waitlistAutomationEnabled) {
      const waitingEntries = await ctx.db
        .query("waitlist")
        .withIndex("by_clinic_and_date", (q) =>
          q
            .eq("clinicId", clinicId)
            .eq("preferredDateKey", appt.dateKey)
            .eq("status", "waiting")
        )
        .collect();
      const matching = waitingEntries.filter(
        (w) =>
          !w.preferredDentistId || w.preferredDentistId === appt.dentistId
      );
      waitlistMatchedCount = Math.min(matching.length, 5);
      if (waitlistMatchedCount > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.waitlist.notifyWaitlistForCancellation,
          {
            clinicId,
            dateKey: appt.dateKey,
            dentistId: appt.dentistId,
          }
        );
      }
    }

    return {
      appointmentId: appt._id,
      status: args.status,
      hygieneRecallScheduledFor,
      waitlistMatchedCount,
    };
  },
});

export const rescheduleAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
    dateKey: v.string(),
    startTimeUtc: v.number(),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireStaffWrite(
      ctx,
      "staff"
    );

    const appt = await ctx.db.get(args.appointmentId);
    if (!appt || appt.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found.",
      });
    }

    const service = await ctx.db.get(appt.serviceId);
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Linked service not found.",
      });
    }

    const check = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: args.dateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
      ignoreAppointmentId: appt._id,
    });
    if (!check.ok) {
      throw new ConvexError({
        code: "SLOT_UNAVAILABLE",
        message:
          check.reason ??
          "Target dentist or chair has a conflicting booking at that time.",
      });
    }

    await ctx.db.patch(appt._id, {
      dateKey: args.dateKey,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: check.endTimeUtc,
      bufferEndTimeUtc: check.bufferEndTimeUtc,
      dentistId: args.dentistId,
      chairId: args.chairId,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "APPOINTMENT_RESCHEDULED",
      targetEntity: "appointments",
      targetId: appt._id,
      metadata: {
        previousStartTimeUtc: appt.startTimeUtc,
        newStartTimeUtc: args.startTimeUtc,
        dateKey: args.dateKey,
      },
    });

    return { appointmentId: appt._id };
  },
});

export const updateClinicalNotes = mutation({
  args: {
    appointmentId: v.id("appointments"),
    clinicalNotes: v.string(),
    postVisitInstructions: v.string(),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireStaffWrite(ctx, "staff");
    const appt = await ctx.db.get(args.appointmentId);
    if (!appt || appt.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found.",
      });
    }

    await ctx.db.patch(appt._id, {
      clinicalNotes: args.clinicalNotes.trim() || undefined,
      postVisitInstructions: args.postVisitInstructions.trim() || undefined,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const addWaitlistEntry = mutation({
  args: {
    patientId: v.id("patients"),
    serviceId: v.id("services"),
    preferredDentistId: v.optional(v.id("dentists")),
    preferredDateKey: v.string(),
    preferredTimeWindow: v.union(
      v.literal("morning"),
      v.literal("afternoon"),
      v.literal("any")
    ),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireStaffWrite(ctx, "staff");
    const [patient, service] = await Promise.all([
      ctx.db.get(args.patientId),
      ctx.db.get(args.serviceId),
    ]);
    if (!patient || patient.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Patient not found." });
    }
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }

    const waitlistId = await ctx.db.insert("waitlist", {
      clinicId,
      patientId: args.patientId,
      serviceId: args.serviceId,
      preferredDentistId: args.preferredDentistId,
      preferredDateKey: args.preferredDateKey,
      preferredTimeWindow: args.preferredTimeWindow,
      status: "waiting",
      createdAt: Date.now(),
    });
    return { waitlistId };
  },
});
