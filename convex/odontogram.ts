import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  requireClinicAccess,
} from "./lib/permissions";

const surfaceValidator = v.union(
  v.literal("Mesial"),
  v.literal("Distal"),
  v.literal("Occlusal"),
  v.literal("Buccal"),
  v.literal("Lingual"),
  v.literal("WholeTooth")
);

const conditionValidator = v.union(
  v.literal("sound"),
  v.literal("caries"),
  v.literal("composite_filling"),
  v.literal("amalgam_filling"),
  v.literal("crown"),
  v.literal("root_canal"),
  v.literal("extraction_needed"),
  v.literal("missing"),
  v.literal("implant")
);

const treatmentStatusValidator = v.union(
  v.literal("existing"),
  v.literal("planned"),
  v.literal("completed")
);

/**
 * Clinic-isolated clinical chart for a patient: demographics, medical alerts,
 * full 32-tooth `toothRecords` history, recent appointments, and X-rays/photos.
 */
export const getPatientChart = query({
  args: {
    patientId: v.id("patients"),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { clinic, clinicId, isSuperAdminOverride } = await requireClinicAccess(
      ctx,
      ["dentist", "clinic_admin", "receptionist"],
      args.overrideClinicId
    );

    const patient = await ctx.db.get(args.patientId);
    if (!patient || patient.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Patient chart not found in this clinic.",
      });
    }

    const [toothRecords, files, appointments, activeDentists, inactiveDentists] =
      await Promise.all([
        ctx.db
          .query("toothRecords")
          .withIndex("by_clinic_and_patient_tooth", (q) =>
            q.eq("clinicId", clinicId).eq("patientId", args.patientId)
          )
          .collect(),
        ctx.db
          .query("clinicalFiles")
          .withIndex("by_clinic_and_patient", (q) =>
            q.eq("clinicId", clinicId).eq("patientId", args.patientId)
          )
          .order("desc")
          .take(50),
        ctx.db
          .query("appointments")
          .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
          .order("desc")
          .take(25),
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
      ]);

    const dentistMap = new Map<Id<"dentists">, Doc<"dentists">>(
      [...activeDentists, ...inactiveDentists].map((d) => [d._id, d])
    );

    const serviceIds = Array.from(new Set(appointments.map((a) => a.serviceId)));
    const services = await Promise.all(serviceIds.map((id) => ctx.db.get(id)));
    const serviceMap = new Map(
      services
        .filter((s): s is Doc<"services"> => s !== null)
        .map((s) => [s._id, s])
    );

    const enrichedFiles = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await ctx.storage.getUrl(f.storageId),
      }))
    );

    const sortedRecords = [...toothRecords].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );

    return {
      patient,
      odontogramEnabled: clinic.featureFlags.odontogramEnabled,
      xrayStorageEnabled: clinic.featureFlags.xrayStorageEnabled,
      isSuperAdminOverride,
      toothRecords: sortedRecords.map((r) => ({
        ...r,
        recordedByDentistName:
          dentistMap.get(r.recordedByDentistId)?.displayName ?? "Dentist",
      })),
      files: enrichedFiles,
      recentAppointments: appointments
        .filter((a) => a.clinicId === clinicId)
        .map((a) => ({
          _id: a._id,
          dateKey: a.dateKey,
          startTimeUtc: a.startTimeUtc,
          status: a.status,
          chiefComplaint: a.chiefComplaint ?? null,
          clinicalNotes: a.clinicalNotes ?? null,
          postVisitInstructions: a.postVisitInstructions ?? null,
          serviceName: serviceMap.get(a.serviceId)?.name ?? "Dental Visit",
          dentistName:
            dentistMap.get(a.dentistId)?.displayName ?? "Assigned Dentist",
        })),
    };
  },
});

/**
 * Appends a timestamped 32-tooth odontogram condition entry for a tooth/surface.
 */
export const recordToothCondition = mutation({
  args: {
    patientId: v.id("patients"),
    toothNumber: v.number(),
    surface: v.optional(surfaceValidator),
    condition: conditionValidator,
    treatmentStatus: treatmentStatusValidator,
    notes: v.optional(v.string()),
    appointmentId: v.optional(v.id("appointments")),
    dentistId: v.optional(v.id("dentists")),
  },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, ["dentist", "clinic_admin"]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }

    const clinic = await assertClinicCanWrite(ctx, access.clinicId, "staff");
    assertClinicFeatureEnabled(clinic, "odontogramEnabled");

    const patient = await ctx.db.get(args.patientId);
    if (!patient || patient.clinicId !== clinic._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Patient not found in this clinic.",
      });
    }

    const validAdult = args.toothNumber >= 1 && args.toothNumber <= 32;
    const validPediatric = args.toothNumber >= 51 && args.toothNumber <= 85;
    if (!Number.isInteger(args.toothNumber) || (!validAdult && !validPediatric)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Tooth number must be 1–32 (adult) or 51–85 (pediatric).",
      });
    }

    if (args.appointmentId) {
      const appt = await ctx.db.get(args.appointmentId);
      if (
        !appt ||
        appt.clinicId !== clinic._id ||
        appt.patientId !== args.patientId
      ) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Linked appointment does not belong to this patient in this clinic.",
        });
      }
    }

    const callerDentist = await ctx.db
      .query("dentists")
      .withIndex("by_user", (q) => q.eq("userId", access.user._id))
      .unique();

    let recordedByDentistId: Id<"dentists"> | null = null;
    if (access.user.role === "dentist") {
      // Dentists always attribute clinical chart entries to their own verified profile.
      if (!callerDentist || callerDentist.clinicId !== clinic._id) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Your user account is not linked to an active dentist profile in this clinic.",
        });
      }
      recordedByDentistId = callerDentist._id;
    } else {
      if (args.dentistId) {
        const provided = await ctx.db.get(args.dentistId);
        if (provided && provided.clinicId === clinic._id) {
          recordedByDentistId = provided._id;
        }
      }
      if (!recordedByDentistId && callerDentist && callerDentist.clinicId === clinic._id) {
        recordedByDentistId = callerDentist._id;
      }
      if (!recordedByDentistId) {
        const fallbackDentist = await ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinic._id).eq("isActive", true)
          )
          .first();
        if (!fallbackDentist) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "No active dentist profile found in this clinic.",
          });
        }
        recordedByDentistId = fallbackDentist._id;
      }
    }

    const recordId = await ctx.db.insert("toothRecords", {
      clinicId: clinic._id,
      patientId: args.patientId,
      toothNumber: args.toothNumber,
      surface: args.surface ?? "WholeTooth",
      condition: args.condition,
      treatmentStatus: args.treatmentStatus,
      notes: args.notes?.trim() || undefined,
      appointmentId: args.appointmentId,
      recordedByDentistId,
      updatedAt: Date.now(),
    });

    return { recordId };
  },
});

/** One-click 6-month hygiene recall date setter. */
export const setPatientRecallDate = mutation({
  args: {
    patientId: v.id("patients"),
    lastCleaningDate: v.string(),
    nextRecallDate: v.string(),
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

    const patient = await ctx.db.get(args.patientId);
    if (!patient || patient.clinicId !== access.clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Patient not found." });
    }

    await ctx.db.patch(patient._id, {
      lastCleaningDate: args.lastCleaningDate,
      nextRecallDate: args.nextRecallDate,
    });
    return { updated: true };
  },
});
