import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordAuditLog } from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  requireClinicAccess,
} from "./lib/permissions";

/** Free-tier guardrail: max 500 KB per compressed X-ray/photo (AGENTS.md Section 3). */
const MAX_CLINICAL_FILE_BYTES = 500 * 1024;

const fileTypeValidator = v.union(
  v.literal("xray_periapical"),
  v.literal("xray_panoramic"),
  v.literal("intraoral_photo"),
  v.literal("consent_form")
);

export const generateUploadUrl = mutation({
  args: { fileSizeBytes: v.number() },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, [
      "dentist",
      "clinic_admin",
      "receptionist",
    ]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }

    const clinic = await assertClinicCanWrite(ctx, access.clinicId, "storage");
    assertClinicFeatureEnabled(clinic, "xrayStorageEnabled");

    if (args.fileSizeBytes <= 0 || args.fileSizeBytes > MAX_CLINICAL_FILE_BYTES) {
      throw new ConvexError({
        code: "FILE_TOO_LARGE",
        message:
          "Clinical images must be compressed to 500 KB or smaller before upload.",
      });
    }

    const plan = await ctx.db.get(clinic.planId);
    if (plan && clinic.storageUsedBytes + args.fileSizeBytes > plan.maxStorageBytes) {
      throw new ConvexError({
        code: "QUOTA_EXCEEDED",
        message: "Uploading this file would exceed your clinic's storage quota.",
      });
    }

    return await ctx.storage.generateUploadUrl();
  },
});

export const saveClinicalFile = mutation({
  args: {
    patientId: v.id("patients"),
    appointmentId: v.optional(v.id("appointments")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: fileTypeValidator,
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, [
      "dentist",
      "clinic_admin",
      "receptionist",
    ]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }

    const clinic = await assertClinicCanWrite(ctx, access.clinicId, "storage");
    assertClinicFeatureEnabled(clinic, "xrayStorageEnabled");

    const patient = await ctx.db.get(args.patientId);
    if (!patient || patient.clinicId !== clinic._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Patient does not belong to this clinic.",
      });
    }

    if (args.sizeBytes <= 0 || args.sizeBytes > MAX_CLINICAL_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError({
        code: "FILE_TOO_LARGE",
        message: "Uploaded file exceeded the 500 KB limit and was discarded.",
      });
    }

    const now = Date.now();
    const fileId = await ctx.db.insert("clinicalFiles", {
      clinicId: clinic._id,
      patientId: args.patientId,
      appointmentId: args.appointmentId,
      storageId: args.storageId,
      fileName: args.fileName.trim() || "clinical-image.webp",
      fileType: args.fileType,
      sizeBytes: args.sizeBytes,
      uploadedByUserId: access.user._id,
      createdAt: now,
    });

    await ctx.db.patch(clinic._id, {
      storageUsedBytes: clinic.storageUsedBytes + args.sizeBytes,
      updatedAt: now,
    });

    return { fileId };
  },
});

export const deleteClinicalFile = mutation({
  args: { fileId: v.id("clinicalFiles") },
  handler: async (ctx, args) => {
    const access = await requireClinicAccess(ctx, ["dentist", "clinic_admin"]);
    if (access.isSuperAdminOverride || access.user.role === "super_admin") {
      throw new ConvexError({
        code: "READ_ONLY_IMPERSONATION",
        message: "Super Admin View-As-Clinic mode is strictly read-only.",
      });
    }
    const clinic = await assertClinicCanWrite(ctx, access.clinicId, "staff");

    const file = await ctx.db.get(args.fileId);
    if (!file || file.clinicId !== clinic._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "File not found." });
    }

    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
    await ctx.db.patch(clinic._id, {
      storageUsedBytes: Math.max(0, clinic.storageUsedBytes - file.sizeBytes),
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: access.user._id,
      actorRole: access.user.role,
      clinicId: clinic._id,
      actionType: "CLINICAL_FILE_DELETED",
      targetEntity: "clinicalFiles",
      targetId: file._id,
      metadata: { fileName: file.fileName, fileType: file.fileType },
    });

    return { deleted: true };
  },
});

export const listPatientFiles = query({
  args: {
    patientId: v.id("patients"),
    overrideClinicId: v.optional(v.id("clinics")),
  },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["dentist", "clinic_admin", "receptionist"],
      args.overrideClinicId
    );
    const patient = await ctx.db.get(args.patientId);
    if (!patient || patient.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Patient not found." });
    }

    const files = await ctx.db
      .query("clinicalFiles")
      .withIndex("by_clinic_and_patient", (q) =>
        q.eq("clinicId", clinicId).eq("patientId", args.patientId)
      )
      .order("desc")
      .take(50);

    return Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await ctx.storage.getUrl(f.storageId),
      }))
    );
  },
});
