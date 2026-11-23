import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { recordAuditLog, toManilaMonthKey } from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  type ClinicResourceType,
  getClinicReadOnlyState,
  requireClinicAccess,
} from "./lib/permissions";
import {
  classifyTimeWindow,
  getDayOfWeekFromDateKey,
  getEmergencyBufferWindow,
  getLocalDateKeyAndMinute,
  intervalsOverlap,
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

/** Computes `"YYYY-MM-DD"` + 6 months with safe month-end clamping (e.g. Aug 31 -> Feb 28/29). */
function addSixMonthsDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const targetMonthIndex = parsed.month - 1 + 6;
  const targetYear = parsed.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(parsed.day, maxDayInTargetMonth);
  const m = String(normalizedMonth + 1).padStart(2, "0");
  const d = String(clampedDay).padStart(2, "0");
  return `${targetYear}-${m}-${d}`;
}

/** Matches oral prophylaxis / routine cleaning / hygiene procedures without false positives on exams. */
function isHygieneCleaningService(service: Doc<"services"> | null): boolean {
  if (!service) return false;
  const lower = service.name.toLowerCase();
  return (
    lower.includes("prophylaxis") ||
    lower.includes("cleaning") ||
    lower.includes("scaling") ||
    lower.includes("hygiene") ||
    lower.includes("polish")
  );
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

    const [
      plan,
      activeDentists,
      inactiveDentists,
      activeChairs,
      inactiveChairs,
      services,
      appointments,
      waitlistRows,
      pendingApprovalRows,
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
      ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_status", (q) =>
          q.eq("clinicId", clinicId).eq("status", "pending_approval")
        )
        .take(50),
    ]);

    const allDentists = [...activeDentists, ...inactiveDentists];
    const allChairs = [...activeChairs, ...inactiveChairs];

    const patientIds = Array.from(
      new Set([
        ...appointments.map((a) => a.patientId),
        ...pendingApprovalRows.map((a) => a.patientId),
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
      allDentists.map((d) => [d._id, d])
    );
    const chairMap = new Map<Id<"chairs">, Doc<"chairs">>(
      allChairs.map((c) => [c._id, c])
    );
    const serviceMap = new Map<Id<"services">, Doc<"services">>(
      services.map((s) => [s._id, s])
    );

    const enrichAppointment = (appt: Doc<"appointments">) => {
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
        patientEmail: patient?.email ?? null,
        noShowCount: patient?.noShowCount ?? 0,
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
    };

    const enrichedAppointments = appointments
      .sort((a, b) => a.startTimeUtc - b.startTimeUtc)
      .map(enrichAppointment);

    const enrichedPendingRequests = pendingApprovalRows
      .sort((a, b) => a.startTimeUtc - b.startTimeUtc)
      .map(enrichAppointment);

    // Include any inactive dentist/chair referenced by appointments in range so Day view doesn't drop them
    const referencedDentistIds = new Set(appointments.map((a) => a.dentistId));
    const referencedChairIds = new Set(appointments.map((a) => a.chairId));
    const calendarDentists = [
      ...activeDentists,
      ...inactiveDentists.filter((d) => referencedDentistIds.has(d._id)),
    ];
    const calendarChairs = [
      ...activeChairs,
      ...inactiveChairs.filter((c) => referencedChairIds.has(c._id)),
    ];

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
          patientEmail: patient?.email ?? null,
          noShowCount: patient?.noShowCount ?? 0,
          serviceName: service?.name ?? "Dental Procedure",
          preferredDentistName: preferredDentist?.displayName ?? "Any Dentist",
        };
      });

    const readOnlyState = getClinicReadOnlyState(
      clinic,
      now,
      isSuperAdminOverride
    );

    const dayOfWeek = getDayOfWeekFromDateKey(args.dateKey);
    const clinicDay = clinic.operatingHours.find(
      (h) => h.dayOfWeek === dayOfWeek
    );
    const emergencyWindow = getEmergencyBufferWindow(
      clinicDay,
      clinic.emergencyBufferMinutesPerDay
    );

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
      isReadOnly: readOnlyState.isReadOnly,
      readOnlyReason: readOnlyState.readOnlyReason,
      emergencyWindow,
      dentists: activeDentists.map((d) => ({
        _id: d._id,
        displayName: d.displayName,
        calendarColorHex: d.calendarColorHex,
        defaultChairId: d.defaultChairId ?? null,
      })),
      calendarDentists: calendarDentists.map((d) => ({
        _id: d._id,
        displayName: d.isActive ? d.displayName : `${d.displayName} (Inactive)`,
        calendarColorHex: d.calendarColorHex,
      })),
      chairs: activeChairs.map((c) => ({
        _id: c._id,
        name: c.name,
        roomCode: c.roomCode,
        supportedCategoryTags: c.supportedCategoryTags,
      })),
      calendarChairs: calendarChairs.map((c) => ({
        _id: c._id,
        name: c.isActive ? c.name : `${c.name} (Inactive)`,
        roomCode: c.roomCode,
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
      pendingRequests: enrichedPendingRequests,
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

    const term = args.search?.trim().toLowerCase() ?? "";
    const normalizedPhoneTerm = term.replace(/[\s()-]/g, "");
    const matches: Doc<"patients">[] = [];
    let inspected = 0;

    // Bounded indexed scan with early exit at 30 matches so clinics with >200 patients stay searchable
    for await (const p of ctx.db
      .query("patients")
      .withIndex("by_clinic_and_phone", (q) => q.eq("clinicId", clinicId))) {
      inspected++;
      if (!term) {
        matches.push(p);
      } else {
        const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
        const phoneNormalized = p.phone.toLowerCase().replace(/[\s()-]/g, "");
        if (
          fullName.includes(term) ||
          p.phone.toLowerCase().includes(term) ||
          (normalizedPhoneTerm.length >= 3 &&
            phoneNormalized.includes(normalizedPhoneTerm)) ||
          (p.email ?? "").toLowerCase().includes(term)
        ) {
          matches.push(p);
        }
      }
      if (matches.length >= 30 || inspected >= 2000) {
        break;
      }
    }

    return matches.map((p) => ({
      _id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email ?? null,
      dateOfBirth: p.dateOfBirth,
      noShowCount: p.noShowCount,
      hasMedicalAlert: hasCriticalMedicalAlert(p),
      allergies: p.medicalHistory.allergies,
    }));
  },
});

// ============================================================================
// 2. DENTIST CHAIR QUEUE QUERY (/staff)
// ============================================================================

export const getDentistQueue = query({
  args: {
    dateKey: v.string(),
    rangeStartKey: v.optional(v.string()),
    rangeEndKey: v.optional(v.string()),
    dentistId: v.optional(v.id("dentists")),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { user, clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, ["dentist", "clinic_admin"], args.overrideClinicId);

    const startKey = args.rangeStartKey ?? args.dateKey;
    const endKey = args.rangeEndKey ?? args.dateKey;
    const now = Date.now();
    const canSwitchDentist = user.role === "clinic_admin" || isSuperAdminOverride;

    const [
      plan,
      activeDentists,
      myDentistProfile,
      rangeAppointments,
      activeChairs,
      inactiveChairs,
      services,
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
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique(),
      ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_date", (q) =>
          q
            .eq("clinicId", clinicId)
            .gte("dateKey", startKey)
            .lte("dateKey", endKey)
        )
        .take(500),
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
    ]);

    const ownClinicDentist =
      myDentistProfile && myDentistProfile.clinicId === clinicId
        ? myDentistProfile
        : null;

    let resolvedDentistId: Id<"dentists"> | null = null;
    if (canSwitchDentist) {
      if (args.dentistId) {
        const requested = await ctx.db.get(args.dentistId);
        if (requested && requested.clinicId === clinicId) {
          resolvedDentistId = requested._id;
        }
      }
      if (!resolvedDentistId) {
        resolvedDentistId = ownClinicDentist?._id ?? activeDentists[0]?._id ?? null;
      }
    } else {
      // Dentists are strictly scoped to their own personal chair queue (never another doctor's).
      resolvedDentistId = ownClinicDentist?._id ?? null;
    }

    const queueAppointments = resolvedDentistId
      ? rangeAppointments
          .filter(
            (a) =>
              a.status !== "cancelled" && a.dentistId === resolvedDentistId
          )
          .sort((a, b) => a.startTimeUtc - b.startTimeUtc)
      : [];

    const patientIds = Array.from(
      new Set(queueAppointments.map((a) => a.patientId))
    );
    const patients = await Promise.all(patientIds.map((id) => ctx.db.get(id)));

    const patientMap = new Map<Id<"patients">, Doc<"patients">>(
      patients
        .filter((p): p is Doc<"patients"> => p !== null && p.clinicId === clinicId)
        .map((p) => [p._id, p])
    );
    const chairMap = new Map(
      [...activeChairs, ...inactiveChairs].map((c) => [c._id, c])
    );
    const serviceMap = new Map(services.map((s) => [s._id, s]));

    const readOnlyState = getClinicReadOnlyState(
      clinic,
      now,
      isSuperAdminOverride
    );

    const visibleDentists = canSwitchDentist
      ? activeDentists
      : ownClinicDentist
        ? [ownClinicDentist]
        : [];

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
      canSwitchDentist,
      hasLinkedDentistProfile: Boolean(ownClinicDentist),
      isReadOnly: readOnlyState.isReadOnly,
      readOnlyReason: readOnlyState.readOnlyReason,
      selectedDentistId: resolvedDentistId,
      dentists: visibleDentists.map((d) => ({
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
      v.literal("dentist_followup"),
      v.literal("waitlist_claim")
    ),
    initialStatus: v.optional(
      v.union(v.literal("confirmed"), v.literal("checked_in"))
    ),
    waitlistId: v.optional(v.id("waitlist")),
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

    const timeZone = clinic.timezone || "Asia/Manila";
    const resolvedDateKey = getLocalDateKeyAndMinute(
      args.startTimeUtc,
      timeZone
    ).dateKey;

    // Law #5: ACID dual-resource conflict verification (Dentist + Chair + Buffer)
    const check = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: resolvedDateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
      allowEmergencyBuffer: true,
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
    let patientEmail: string | undefined;
    if (args.existingPatientId) {
      const existing = await ctx.db.get(args.existingPatientId);
      if (!existing || existing.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Patient record does not belong to this clinic.",
        });
      }
      patientId = existing._id;
      patientEmail = existing.email?.trim() || undefined;
    } else if (args.newPatient) {
      patientEmail = args.newPatient.email?.trim().toLowerCase() || undefined;
      // Guest/walk-in patient profile without requiring a Clerk account (`userId` omitted)
      patientId = await ctx.db.insert("patients", {
        clinicId,
        firstName: args.newPatient.firstName.trim(),
        lastName: args.newPatient.lastName.trim(),
        phone: args.newPatient.phone.trim(),
        email: patientEmail,
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
      dateKey: resolvedDateKey,
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

    // If booked from a standby waitlist row, mark it claimed atomically
    if (args.waitlistId) {
      const waitlistEntry = await ctx.db.get(args.waitlistId);
      if (waitlistEntry && waitlistEntry.clinicId === clinicId) {
        await ctx.db.patch(waitlistEntry._id, { status: "claimed" });
      }
    }

    await ctx.db.patch(clinicId, {
      currentMonthAppointmentCount: clinic.currentMonthAppointmentCount + 1,
      lifetimeAppointmentCount: clinic.lifetimeAppointmentCount + 1,
      updatedAt: now,
    });

    if (patientEmail && args.bookingSource !== "front_desk_walk_in") {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendBookingConfirmation,
        { appointmentId }
      );
    }

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
    const { user: actor, clinic, clinicId } = await requireStaffWrite(
      ctx,
      "staff"
    );

    const appt = await ctx.db.get(args.appointmentId);
    if (!appt || appt.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found in this clinic.",
      });
    }

    // Only clinical staff (dentist / clinic_admin) may write private clinicalNotes
    if (args.clinicalNotes !== undefined && actor.role === "receptionist") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only dentists and clinic administrators may update private clinical notes.",
      });
    }

    // Dentists may only transition status or record notes for their own assigned appointments
    if (actor.role === "dentist") {
      const callerDentist = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", actor._id))
        .unique();
      if (!callerDentist || callerDentist.clinicId !== clinicId || appt.dentistId !== callerDentist._id) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only update appointments assigned to your own chair queue.",
        });
      }
    }

    // Guard invalid transitions out of terminal cancelled state into active/completed clinical flow
    if (
      appt.status === "cancelled" &&
      (args.status === "checked_in" ||
        args.status === "in_chair" ||
        args.status === "completed")
    ) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Cancelled appointments cannot be marked checked in, in chair, or completed.",
      });
    }

    const now = Date.now();
    const cleanReason = args.cancellationReason?.trim() || undefined;
    const windowHours = clinic.cancellationWindowHours ?? 24;
    const isCancelling = args.status === "cancelled" && appt.status !== "cancelled";
    const isRejectingPending =
      isCancelling && appt.status === "pending_approval";
    const isApprovingPending =
      appt.status === "pending_approval" && args.status === "confirmed";
    const isPolicyOverride =
      isCancelling &&
      !isRejectingPending &&
      appt.startTimeUtc - now < windowHours * 60 * 60 * 1000;

    if (isPolicyOverride && !cleanReason) {
      throw new ConvexError({
        code: "CANCELLATION_REASON_REQUIRED",
        message: `Cancelling within the ${windowHours}-hour policy window requires a cancellation reason.`,
      });
    }

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
          ? cleanReason
          : appt.cancellationReason,
      updatedAt: now,
    });

    let hygieneRecallScheduledFor: string | null = null;
    let waitlistMatchedCount = 0;

    // Pending approval audit & confirmation dispatch
    if (isApprovingPending) {
      await recordAuditLog(ctx, {
        actorUserId: actor._id,
        actorRole: actor.role,
        clinicId,
        actionType: "APPOINTMENT_APPROVED",
        targetEntity: "appointments",
        targetId: appt._id,
        metadata: { dateKey: appt.dateKey, startTimeUtc: appt.startTimeUtc },
      });
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendBookingConfirmation,
        { appointmentId: appt._id }
      );
    }

    // Law #7: Audit cancellations, rejections, and 24-hour policy overrides
    if (isCancelling) {
      await recordAuditLog(ctx, {
        actorUserId: actor._id,
        actorRole: actor.role,
        clinicId,
        actionType: isRejectingPending
          ? "APPOINTMENT_REJECTED"
          : isPolicyOverride
            ? "APPOINTMENT_CANCELLED_POLICY_OVERRIDE"
            : "APPOINTMENT_CANCELLED",
        targetEntity: "appointments",
        targetId: appt._id,
        metadata: {
          previousStatus: appt.status,
          cancellationReason: cleanReason ?? null,
          isPolicyOverride,
          cancellationWindowHours: windowHours,
        },
      });
    }

    // Track noShowCount accurately, including decrement on accidental no-show reversal
    if (args.status === "no_show" && appt.status !== "no_show") {
      const patient = await ctx.db.get(appt.patientId);
      if (patient && patient.clinicId === clinicId) {
        await ctx.db.patch(patient._id, {
          noShowCount: patient.noShowCount + 1,
        });
      }
    } else if (appt.status === "no_show" && args.status !== "no_show") {
      const patient = await ctx.db.get(appt.patientId);
      if (patient && patient.clinicId === clinicId && patient.noShowCount > 0) {
        await ctx.db.patch(patient._id, {
          noShowCount: Math.max(0, patient.noShowCount - 1),
        });
      }
    }

    // Automatic 6-Month Hygiene Recall on Oral Prophylaxis / Cleaning completion (idempotent on first completion)
    if (args.status === "completed" && appt.status !== "completed") {
      const [service, patient] = await Promise.all([
        ctx.db.get(appt.serviceId),
        ctx.db.get(appt.patientId),
      ]);
      const isCleaning = isHygieneCleaningService(service);

      if (isCleaning && patient && patient.clinicId === clinicId) {
        const nextRecallDate = addSixMonthsDateKey(appt.dateKey);
        await ctx.db.patch(patient._id, {
          lastCleaningDate: appt.dateKey,
          nextRecallDate,
        });
        hygieneRecallScheduledFor = nextRecallDate;
      }

      await recordAuditLog(ctx, {
        actorUserId: actor._id,
        actorRole: actor.role,
        clinicId,
        actionType: "APPOINTMENT_COMPLETED",
        targetEntity: "appointments",
        targetId: appt._id,
        metadata: {
          serviceName: service?.name ?? null,
          hygieneRecallScheduledFor,
          hasClinicalNotes: Boolean(
            (args.clinicalNotes ?? appt.clinicalNotes)?.trim()
          ),
          hasPostVisitInstructions: Boolean(
            (args.postVisitInstructions ?? appt.postVisitInstructions)?.trim()
          ),
        },
      });
    }

    // Check standby waitlist & schedule Resend opening blast on cancellation
    if (isCancelling && clinic.featureFlags.waitlistAutomationEnabled) {
      const waitingEntries = await ctx.db
        .query("waitlist")
        .withIndex("by_clinic_and_date", (q) =>
          q
            .eq("clinicId", clinicId)
            .eq("preferredDateKey", appt.dateKey)
            .eq("status", "waiting")
        )
        .collect();
      const slotWindow = classifyTimeWindow(
        getLocalDateKeyAndMinute(appt.startTimeUtc, clinic.timezone || "Asia/Manila")
          .minuteOfDay
      );
      const matching = waitingEntries.filter(
        (w) =>
          (!w.preferredDentistId || w.preferredDentistId === appt.dentistId) &&
          (w.preferredTimeWindow === "any" || w.preferredTimeWindow === slotWindow)
      );
      const matchingPatients = await Promise.all(
        matching.map((w) => ctx.db.get(w.patientId))
      );
      const emailableCount = matchingPatients.filter((p) =>
        Boolean(p?.email?.trim())
      ).length;
      waitlistMatchedCount = Math.min(emailableCount, 5);
      if (waitlistMatchedCount > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.waitlist.notifyWaitlistForCancellation,
          {
            clinicId,
            dateKey: appt.dateKey,
            dentistId: appt.dentistId,
            startTimeUtc: appt.startTimeUtc,
          }
        );
      }
    }

    return {
      appointmentId: appt._id,
      status: args.status,
      hygieneRecallScheduledFor,
      waitlistMatchedCount,
      isPolicyOverride,
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
    reason: v.optional(v.string()),
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

    const timeZone = clinic.timezone || "Asia/Manila";
    const resolvedDateKey = getLocalDateKeyAndMinute(
      args.startTimeUtc,
      timeZone
    ).dateKey;

    const check = await verifySpecificPairAvailable(ctx, {
      clinic,
      service,
      dateKey: resolvedDateKey,
      dentistId: args.dentistId,
      chairId: args.chairId,
      startTimeUtc: args.startTimeUtc,
      ignoreAppointmentId: appt._id,
      allowEmergencyBuffer: true,
    });
    if (!check.ok) {
      throw new ConvexError({
        code: "SLOT_UNAVAILABLE",
        message:
          check.reason ??
          "Target dentist or chair has a conflicting booking at that time.",
      });
    }

    const timeChanged =
      appt.dateKey !== resolvedDateKey ||
      appt.startTimeUtc !== args.startTimeUtc;
    const resourceChanged =
      appt.dentistId !== args.dentistId || appt.chairId !== args.chairId;

    await ctx.db.patch(appt._id, {
      dateKey: resolvedDateKey,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: check.endTimeUtc,
      bufferEndTimeUtc: check.bufferEndTimeUtc,
      dentistId: args.dentistId,
      chairId: args.chairId,
      reminder24hSent: timeChanged ? false : appt.reminder24hSent,
      reminder2hSent: timeChanged ? false : appt.reminder2hSent,
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
        previousDateKey: appt.dateKey,
        newDateKey: resolvedDateKey,
        previousStartTimeUtc: appt.startTimeUtc,
        newStartTimeUtc: args.startTimeUtc,
        previousDentistId: appt.dentistId,
        newDentistId: args.dentistId,
        previousChairId: appt.chairId,
        newChairId: args.chairId,
        reason: args.reason?.trim() || null,
      },
    });

    // Notify standby waitlist if an original slot was vacated
    if (
      (timeChanged || resourceChanged) &&
      clinic.featureFlags.waitlistAutomationEnabled
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.waitlist.notifyWaitlistForCancellation,
        {
          clinicId,
          dateKey: appt.dateKey,
          dentistId: appt.dentistId,
          startTimeUtc: appt.startTimeUtc,
        }
      );
    }

    return { appointmentId: appt._id, dateKey: resolvedDateKey };
  },
});

export const updateClinicalNotes = mutation({
  args: {
    appointmentId: v.id("appointments"),
    clinicalNotes: v.string(),
    postVisitInstructions: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, ["dentist", "clinic_admin"]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }
    await assertClinicCanWrite(ctx, access.clinicId, "staff");
    const clinicId = access.clinicId;

    const appt = await ctx.db.get(args.appointmentId);
    if (!appt || appt.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Appointment not found.",
      });
    }

    if (access.user.role === "dentist") {
      const callerDentist = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", access.user._id))
        .unique();
      if (
        !callerDentist ||
        callerDentist.clinicId !== clinicId ||
        appt.dentistId !== callerDentist._id
      ) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only edit clinical notes for your own assigned appointments.",
        });
      }
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
    if (!service || service.clinicId !== clinicId || !service.isActive) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }

    const existingForPatient = await ctx.db
      .query("waitlist")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .order("desc")
      .take(50);

    const duplicate = existingForPatient.find(
      (entry) =>
        entry.clinicId === clinicId &&
        entry.serviceId === args.serviceId &&
        entry.preferredDateKey === args.preferredDateKey &&
        (entry.status === "waiting" || entry.status === "notified")
    );
    if (duplicate) {
      throw new ConvexError({
        code: "ALREADY_WAITLISTED",
        message: `${patient.firstName} ${patient.lastName} is already on the standby waitlist for ${service.name} on ${args.preferredDateKey}.`,
      });
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

/** Allows receptionists / clinic admins to manually trigger a Resend slot-opening offer to a waitlisted patient. */
export const sendManualWaitlistOffer = mutation({
  args: {
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireStaffWrite(
      ctx,
      "email"
    );
    assertClinicFeatureEnabled(clinic, "waitlistAutomationEnabled");

    const entry = await ctx.db.get(args.waitlistId);
    if (!entry || entry.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Waitlist entry not found in this clinic.",
      });
    }
    if (entry.status === "claimed" || entry.status === "expired") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: `Cannot offer a slot to a ${entry.status} waitlist entry.`,
      });
    }

    const [patient, service] = await Promise.all([
      ctx.db.get(entry.patientId),
      ctx.db.get(entry.serviceId),
    ]);
    if (!patient || patient.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Patient not found." });
    }
    const recipientEmail = patient.email?.trim();
    if (!recipientEmail) {
      throw new ConvexError({
        code: "NO_PATIENT_EMAIL",
        message: `${patient.firstName} ${patient.lastName} has no email on file. Call them at ${patient.phone} instead.`,
      });
    }

    await ctx.db.patch(entry._id, { status: "notified" });

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
        dateKey: entry.preferredDateKey,
      }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "WAITLIST_MANUAL_OFFER_SENT",
      targetEntity: "waitlist",
      targetId: entry._id,
      metadata: {
        patientId: patient._id,
        recipientEmail,
        preferredDateKey: entry.preferredDateKey,
      },
    });

    return {
      sentTo: recipientEmail,
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    };
  },
});

/** Allows receptionists to dismiss/expire or reset a waitlist entry's status. */
export const updateWaitlistStatus = mutation({
  args: {
    waitlistId: v.id("waitlist"),
    status: v.union(
      v.literal("waiting"),
      v.literal("claimed"),
      v.literal("expired")
    ),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireStaffWrite(ctx, "staff");
    const entry = await ctx.db.get(args.waitlistId);
    if (!entry || entry.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Waitlist entry not found.",
      });
    }
    await ctx.db.patch(entry._id, { status: args.status });
    return { waitlistId: entry._id, status: args.status };
  },
});

// ============================================================================
// 4. DENTIST PERSONAL TIME-OFF & BREAK BLOCKER (WITH OVERLAP DETECTION)
// ============================================================================

const MAX_TIME_OFF_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const APPOINTMENT_LOOKBACK_MS = 12 * 60 * 60 * 1000;

async function findOverlappingAppointmentsForTimeOff(
  ctx: { db: MutationCtx["db"] } | { db: import("./_generated/server").QueryCtx["db"] },
  params: {
    clinicId: Id<"clinics">;
    dentistId: Id<"dentists">;
    startTimeUtc: number;
    endTimeUtc: number;
  }
) {
  const candidates = await ctx.db
    .query("appointments")
    .withIndex("by_dentist_and_start", (q) =>
      q
        .eq("dentistId", params.dentistId)
        .gte("startTimeUtc", params.startTimeUtc - APPOINTMENT_LOOKBACK_MS)
        .lt("startTimeUtc", params.endTimeUtc)
    )
    .take(200);

  return candidates.filter(
    (a) =>
      a.clinicId === params.clinicId &&
      a.status !== "cancelled" &&
      a.status !== "no_show" &&
      a.status !== "completed" &&
      intervalsOverlap(
        a.startTimeUtc,
        a.endTimeUtc,
        params.startTimeUtc,
        params.endTimeUtc
      )
  );
}

/** Lists a dentist's scheduled time-off & break blocks (dentists strictly see their own). */
export const getDentistTimeOff = query({
  args: {
    dentistId: v.optional(v.id("dentists")),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { user, clinicId, isSuperAdminOverride } = await requireClinicAccess(
      ctx,
      ["dentist", "clinic_admin"],
      args.overrideClinicId
    );

    const canSwitchDentist = user.role === "clinic_admin" || isSuperAdminOverride;
    const myDentistProfile = await ctx.db
      .query("dentists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    let targetDentist: Doc<"dentists"> | null = null;
    if (canSwitchDentist && args.dentistId) {
      const requested = await ctx.db.get(args.dentistId);
      if (requested && requested.clinicId === clinicId) {
        targetDentist = requested;
      }
    }
    if (!targetDentist && myDentistProfile && myDentistProfile.clinicId === clinicId) {
      targetDentist = myDentistProfile;
    }
    if (!targetDentist && canSwitchDentist) {
      targetDentist = await ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .first();
    }

    if (!targetDentist) {
      return { dentistId: null, dentistName: null, blocks: [] };
    }

    const rows = await ctx.db
      .query("dentistTimeOff")
      .withIndex("by_dentist_and_time", (q) =>
        q.eq("dentistId", targetDentist._id)
      )
      .order("desc")
      .take(100);

    return {
      dentistId: targetDentist._id,
      dentistName: targetDentist.displayName,
      blocks: rows
        .filter((r) => r.clinicId === clinicId)
        .sort((a, b) => a.startTimeUtc - b.startTimeUtc),
    };
  },
});

/** Live overlap preview: checks whether a proposed leave/break conflicts with existing appointments. */
export const checkTimeOffConflicts = query({
  args: {
    dentistId: v.optional(v.id("dentists")),
    startTimeUtc: v.number(),
    endTimeUtc: v.number(),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { user, clinicId, isSuperAdminOverride } = await requireClinicAccess(
      ctx,
      ["dentist", "clinic_admin"],
      args.overrideClinicId
    );

    if (args.endTimeUtc <= args.startTimeUtc) {
      return { conflicts: [] };
    }

    const canSwitchDentist = user.role === "clinic_admin" || isSuperAdminOverride;
    const myDentistProfile = await ctx.db
      .query("dentists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    let targetDentistId: Id<"dentists"> | null = null;
    if (canSwitchDentist && args.dentistId) {
      const requested = await ctx.db.get(args.dentistId);
      if (requested && requested.clinicId === clinicId) {
        targetDentistId = requested._id;
      }
    } else if (myDentistProfile && myDentistProfile.clinicId === clinicId) {
      targetDentistId = myDentistProfile._id;
    }

    if (!targetDentistId) {
      return { conflicts: [] };
    }

    const overlapping = await findOverlappingAppointmentsForTimeOff(ctx, {
      clinicId,
      dentistId: targetDentistId,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
    });

    const patientIds = Array.from(new Set(overlapping.map((a) => a.patientId)));
    const serviceIds = Array.from(new Set(overlapping.map((a) => a.serviceId)));
    const [patients, services] = await Promise.all([
      Promise.all(patientIds.map((id) => ctx.db.get(id))),
      Promise.all(serviceIds.map((id) => ctx.db.get(id))),
    ]);

    const patientMap = new Map(
      patients
        .filter((p): p is Doc<"patients"> => p !== null && p.clinicId === clinicId)
        .map((p) => [p._id, p])
    );
    const serviceMap = new Map(
      services
        .filter((s): s is Doc<"services"> => s !== null && s.clinicId === clinicId)
        .map((s) => [s._id, s])
    );

    return {
      conflicts: overlapping
        .sort((a, b) => a.startTimeUtc - b.startTimeUtc)
        .map((appt) => {
          const patient = patientMap.get(appt.patientId);
          const service = serviceMap.get(appt.serviceId);
          return {
            _id: appt._id,
            referenceCode: `SML-${appt._id.slice(-6).toUpperCase()}`,
            patientName: patient
              ? `${patient.firstName} ${patient.lastName}`
              : "Patient",
            serviceName: service?.name ?? "Dental Procedure",
            dateKey: appt.dateKey,
            startTimeUtc: appt.startTimeUtc,
            endTimeUtc: appt.endTimeUtc,
            status: appt.status,
          };
        }),
    };
  },
});

/** Allows dentists (for themselves) or clinic admins to block leave, conferences, or ad-hoc breaks. */
export const createMyTimeOff = mutation({
  args: {
    dentistId: v.optional(v.id("dentists")),
    startTimeUtc: v.number(),
    endTimeUtc: v.number(),
    reason: v.string(),
    allowOverlap: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, ["dentist", "clinic_admin"]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }
    await assertClinicCanWrite(ctx, access.clinicId, "staff");
    const clinicId = access.clinicId;

    if (
      !Number.isFinite(args.startTimeUtc) ||
      !Number.isFinite(args.endTimeUtc) ||
      args.endTimeUtc <= args.startTimeUtc
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Time-off end time must be after the start time.",
      });
    }
    if (args.endTimeUtc - args.startTimeUtc > MAX_TIME_OFF_WINDOW_MS) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Time-off block cannot exceed 365 days.",
      });
    }

    const myDentistProfile = await ctx.db
      .query("dentists")
      .withIndex("by_user", (q) => q.eq("userId", access.user._id))
      .unique();

    let targetDentist: Doc<"dentists"> | null = null;
    if (access.user.role === "dentist") {
      if (!myDentistProfile || myDentistProfile.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message:
            "Your account is not linked to a dentist profile in this clinic.",
        });
      }
      targetDentist = myDentistProfile;
    } else if (args.dentistId) {
      const requested = await ctx.db.get(args.dentistId);
      if (!requested || requested.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Dentist profile not found in this clinic.",
        });
      }
      targetDentist = requested;
    } else if (myDentistProfile && myDentistProfile.clinicId === clinicId) {
      targetDentist = myDentistProfile;
    }

    if (!targetDentist) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Select a dentist profile before blocking time off.",
      });
    }

    const overlapping = await findOverlappingAppointmentsForTimeOff(ctx, {
      clinicId,
      dentistId: targetDentist._id,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
    });

    if (overlapping.length > 0 && !args.allowOverlap) {
      throw new ConvexError({
        code: "TIME_OFF_APPOINTMENT_CONFLICT",
        message: `This time-off block overlaps ${overlapping.length} existing appointment${overlapping.length === 1 ? "" : "s"}. Confirm the overlap warning to block this window and notify front desk to reschedule.`,
      });
    }

    const reason = args.reason.trim() || "Personal time off";
    const timeOffId = await ctx.db.insert("dentistTimeOff", {
      clinicId,
      dentistId: targetDentist._id,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      reason,
      createdByUserId: access.user._id,
    });

    await recordAuditLog(ctx, {
      actorUserId: access.user._id,
      actorRole: access.user.role,
      clinicId,
      actionType: "DENTIST_TIME_OFF_CREATED",
      targetEntity: "dentistTimeOff",
      targetId: timeOffId,
      metadata: {
        dentistId: targetDentist._id,
        startTimeUtc: args.startTimeUtc,
        endTimeUtc: args.endTimeUtc,
        reason,
        overlappingAppointmentCount: overlapping.length,
      },
    });

    return {
      timeOffId,
      overlappingCount: overlapping.length,
    };
  },
});

/** Allows a dentist (for their own blocks) or clinic admin to remove a time-off block. */
export const removeMyTimeOff = mutation({
  args: { timeOffId: v.id("dentistTimeOff") },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, ["dentist", "clinic_admin"]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }
    await assertClinicCanWrite(ctx, access.clinicId, "staff");
    const clinicId = access.clinicId;

    const row = await ctx.db.get(args.timeOffId);
    if (!row || row.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Time-off block not found.",
      });
    }

    if (access.user.role === "dentist") {
      const myDentistProfile = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", access.user._id))
        .unique();
      if (
        !myDentistProfile ||
        myDentistProfile.clinicId !== clinicId ||
        row.dentistId !== myDentistProfile._id
      ) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only remove your own time-off blocks.",
        });
      }
    }

    await ctx.db.delete(row._id);

    await recordAuditLog(ctx, {
      actorUserId: access.user._id,
      actorRole: access.user.role,
      clinicId,
      actionType: "DENTIST_TIME_OFF_DELETED",
      targetEntity: "dentistTimeOff",
      targetId: row._id,
      metadata: {
        dentistId: row.dentistId,
        startTimeUtc: row.startTimeUtc,
        endTimeUtc: row.endTimeUtc,
        reason: row.reason,
      },
    });

    return { deleted: true };
  },
});
