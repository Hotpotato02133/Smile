import { HttpStatus, Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";
import {
  API_ERROR_CODES,
  type ClinicFeatureFlags,
  MAX_CLINICAL_FILE_BYTES,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { TenantContext } from "../../common/types/request-context";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { StorageService } from "../storage/storage.service";
import type {
  ConfirmClinicalFileDto,
  RecordToothConditionDto,
  SetPatientRecallDto,
} from "./clinical.schemas";

@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly realtime: RealtimeGateway
  ) {}

  async getPatientChart(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId: tenant.clinicId },
    });
    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient chart not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    const [toothRecords, files, appointments] = await Promise.all([
      this.prisma.toothRecord.findMany({
        where: { clinicId: tenant.clinicId, patientId },
        include: {
          recordedByDentist: { select: { id: true, displayName: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.clinicalFile.findMany({
        where: { clinicId: tenant.clinicId, patientId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.appointment.findMany({
        where: { clinicId: tenant.clinicId, patientId },
        include: {
          service: { select: { name: true } },
          dentist: { select: { displayName: true } },
        },
        orderBy: { startTimeUtc: "desc" },
        take: 25,
      }),
    ]);

    const enrichedFiles = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await this.storageService.createPresignedGetUrl(f.storageKey, 300),
      }))
    );

    const flags = tenant.clinic.featureFlags as unknown as ClinicFeatureFlags;

    return {
      patient,
      odontogramEnabled: Boolean(flags?.odontogramEnabled),
      xrayStorageEnabled: Boolean(flags?.xrayStorageEnabled),
      isSuperAdminOverride: tenant.isSuperAdminOverride,
      toothRecords: toothRecords.map((r) => ({
        ...r,
        recordedByDentistName: r.recordedByDentist.displayName,
      })),
      files: enrichedFiles,
      recentAppointments: appointments.map((a) => ({
        id: a.id,
        dateKey: a.dateKey,
        startTimeUtc: a.startTimeUtc,
        status: a.status,
        chiefComplaint: a.chiefComplaint,
        clinicalNotes: a.clinicalNotes,
        postVisitInstructions: a.postVisitInstructions,
        serviceName: a.service.name,
        dentistName: a.dentist.displayName,
      })),
    };
  }

  async recordToothCondition(
    tenant: TenantContext,
    actor: User,
    patientId: string,
    dto: RecordToothConditionDto
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId: tenant.clinicId },
    });
    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: {
          id: dto.appointmentId,
          clinicId: tenant.clinicId,
          patientId,
        },
      });
      if (!appt) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Linked appointment does not belong to this patient in this clinic.",
          HttpStatus.NOT_FOUND
        );
      }
    }

    const callerDentist = await this.prisma.dentist.findFirst({
      where: { userId: actor.id, clinicId: tenant.clinicId },
    });

    let recordedByDentistId: string | null = null;
    if (actor.role === "dentist") {
      if (!callerDentist) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Your user account is not linked to an active dentist profile in this clinic.",
          HttpStatus.NOT_FOUND
        );
      }
      recordedByDentistId = callerDentist.id;
    } else {
      if (dto.dentistId) {
        const provided = await this.prisma.dentist.findFirst({
          where: { id: dto.dentistId, clinicId: tenant.clinicId },
        });
        if (provided) recordedByDentistId = provided.id;
      }
      if (!recordedByDentistId && callerDentist) {
        recordedByDentistId = callerDentist.id;
      }
      if (!recordedByDentistId) {
        const fallback = await this.prisma.dentist.findFirst({
          where: { clinicId: tenant.clinicId, isActive: true },
        });
        if (!fallback) {
          throw new DomainException(
            API_ERROR_CODES.NOT_FOUND,
            "No active dentist profile found in this clinic.",
            HttpStatus.NOT_FOUND
          );
        }
        recordedByDentistId = fallback.id;
      }
    }

    const record = await this.prisma.toothRecord.create({
      data: {
        clinicId: tenant.clinicId,
        patientId,
        toothNumber: dto.toothNumber,
        surface: dto.surface,
        condition: dto.condition,
        treatmentStatus: dto.treatmentStatus,
        notes: dto.notes ?? null,
        appointmentId: dto.appointmentId ?? null,
        recordedByDentistId,
      },
    });

    this.realtime.emitOdontogramUpdated({
      clinicId: tenant.clinicId,
      patientId,
      toothNumber: dto.toothNumber,
    });

    return record;
  }

  async setPatientRecallDate(
    tenant: TenantContext,
    patientId: string,
    dto: SetPatientRecallDto
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId: tenant.clinicId },
    });
    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    await this.prisma.patient.update({
      where: { id: patient.id },
      data: {
        lastCleaningDate: dto.lastCleaningDate,
        nextRecallDate: dto.nextRecallDate,
      },
    });
    return { updated: true };
  }

  async listPatientFiles(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId: tenant.clinicId },
    });
    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const files = await this.prisma.clinicalFile.findMany({
      where: { clinicId: tenant.clinicId, patientId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await this.storageService.createPresignedGetUrl(f.storageKey, 300),
      }))
    );
  }

  /**
   * Zero-trust upload confirmation: verifies real object size from R2 HeadObject
   * before committing clinical_files & incrementing clinics.storage_used_bytes.
   */
  async confirmClinicalFile(
    tenant: TenantContext,
    actor: User,
    dto: ConfirmClinicalFileDto
  ) {
    const expectedPrefix = `private/clinical/${tenant.clinicId}/${dto.patientId}/`;
    if (!dto.storageKey.startsWith(expectedPrefix)) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Storage key does not match this clinic and patient scope.",
        HttpStatus.FORBIDDEN
      );
    }

    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, clinicId: tenant.clinicId },
    });
    if (!patient) {
      await this.storageService.deleteObject(dto.storageKey, "private");
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient does not belong to this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: {
          id: dto.appointmentId,
          clinicId: tenant.clinicId,
          patientId: dto.patientId,
        },
      });
      if (!appt) {
        await this.storageService.deleteObject(dto.storageKey, "private");
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Linked appointment does not belong to this patient.",
          HttpStatus.NOT_FOUND
        );
      }
    }

    const head = await this.storageService.headObject(dto.storageKey, "private");
    if (!head.exists) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Uploaded file could not be verified in R2 storage. Please retry.",
        HttpStatus.NOT_FOUND
      );
    }

    if (head.sizeBytes <= 0 || head.sizeBytes > MAX_CLINICAL_FILE_BYTES) {
      await this.storageService.deleteObject(dto.storageKey, "private");
      throw new DomainException(
        API_ERROR_CODES.FILE_TOO_LARGE,
        "Uploaded file exceeded the 500 KB limit and was discarded.",
        HttpStatus.BAD_REQUEST
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: tenant.clinic.planId },
    });
    if (
      plan &&
      tenant.clinic.storageUsedBytes + BigInt(head.sizeBytes) >
        plan.maxStorageBytes
    ) {
      await this.storageService.deleteObject(dto.storageKey, "private");
      throw new DomainException(
        API_ERROR_CODES.QUOTA_EXCEEDED,
        "Uploading this file would exceed your clinic's storage quota.",
        HttpStatus.FORBIDDEN
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.clinicalFile.create({
        data: {
          clinicId: tenant.clinicId,
          patientId: dto.patientId,
          appointmentId: dto.appointmentId ?? null,
          storageKey: dto.storageKey,
          fileName: dto.fileName,
          fileType: dto.fileType,
          sizeBytes: head.sizeBytes,
          uploadedByUserId: actor.id,
        },
      });

      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: {
          storageUsedBytes: { increment: BigInt(head.sizeBytes) },
        },
      });

      return file;
    });
  }

  async deleteClinicalFile(
    tenant: TenantContext,
    actor: User,
    fileId: string
  ) {
    const file = await this.prisma.clinicalFile.findFirst({
      where: { id: fileId, clinicId: tenant.clinicId },
    });
    if (!file) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinical file not found.",
        HttpStatus.NOT_FOUND
      );
    }

    await this.storageService.deleteObject(file.storageKey, "private");

    const nextStorageBytes =
      tenant.clinic.storageUsedBytes > BigInt(file.sizeBytes)
        ? tenant.clinic.storageUsedBytes - BigInt(file.sizeBytes)
        : BigInt(0);

    await this.prisma.$transaction(async (tx) => {
      await tx.clinicalFile.delete({ where: { id: file.id } });
      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: { storageUsedBytes: nextStorageBytes },
      });
      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "CLINICAL_FILE_DELETED",
          targetEntity: "clinical_files",
          targetId: file.id,
          metadata: { fileName: file.fileName, fileType: file.fileType },
        },
        tx
      );
    });

    return { deleted: true };
  }
}
