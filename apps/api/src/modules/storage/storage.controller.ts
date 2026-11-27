import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { API_ERROR_CODES, MAX_CLINICAL_FILE_BYTES } from "@smile/shared";
import { z } from "zod";
import {
  CurrentTenant,
  RequireClinicAccess,
  Roles,
} from "../../common/decorators/auth.decorators";
import { DomainException } from "../../common/exceptions/domain.exception";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { TenantContext } from "../../common/types/request-context";
import { PrismaService } from "../../infra/prisma.service";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import {
  ClinicQuotaGuard,
  RequireClinicFeature,
  RequireClinicWrite,
} from "../auth/guards/clinic-quota.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantAccessGuard } from "../auth/guards/tenant-access.guard";
import { StorageService } from "./storage.service";

const MAX_RECEIPT_BYTES = 1024 * 1024; // 1 MB cap for subscription payment receipts

const presignClinicalUploadSchema = z.object({
  patientId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(160),
  contentType: z
    .string()
    .regex(/^(image\/(webp|jpeg|png)|application\/pdf)$/, "Unsupported file type"),
  fileSizeBytes: z.number().int().positive(),
});

const presignLogoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  contentType: z.string().regex(/^image\/(webp|jpeg|png|svg\+xml)$/),
  fileSizeBytes: z.number().int().positive(),
});

const presignReceiptUploadSchema = z.object({
  clinicId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(160),
  contentType: z.string().regex(/^(image\/(webp|jpeg|png)|application\/pdf)$/),
  fileSizeBytes: z.number().int().positive(),
});

@ApiTags("Cloudflare R2 Storage")
@ApiBearerAuth("clerk-jwt")
@Controller("storage")
@UseGuards(ClerkJwtGuard, RolesGuard, TenantAccessGuard, ClinicQuotaGuard)
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService
  ) {}

  @Post("clinical/presign-upload")
  @RequireClinicAccess(["dentist", "clinic_admin", "receptionist"])
  @RequireClinicWrite("storage")
  @RequireClinicFeature("xrayStorageEnabled")
  @ApiOperation({
    summary:
      "Generate a 5-min private R2 presigned PUT URL for a compressed clinical X-ray/photo (<= 500 KB)",
  })
  async presignClinicalUpload(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(presignClinicalUploadSchema))
    dto: z.infer<typeof presignClinicalUploadSchema>
  ) {
    if (dto.fileSizeBytes > MAX_CLINICAL_FILE_BYTES) {
      throw new DomainException(
        API_ERROR_CODES.FILE_TOO_LARGE,
        "Clinical images must be compressed to 500 KB or smaller before upload.",
        HttpStatus.BAD_REQUEST
      );
    }

    const [patient, plan] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: dto.patientId, clinicId: tenant.clinicId },
      }),
      this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      }),
    ]);

    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient does not belong to this clinic.",
        HttpStatus.NOT_FOUND
      );
    }
    if (
      plan &&
      tenant.clinic.storageUsedBytes + BigInt(dto.fileSizeBytes) >
        plan.maxStorageBytes
    ) {
      throw new DomainException(
        API_ERROR_CODES.QUOTA_EXCEEDED,
        "Uploading this file would exceed your clinic's storage quota.",
        HttpStatus.FORBIDDEN
      );
    }

    const storageKey = this.storageService.buildClinicalKey(
      tenant.clinicId,
      patient.id,
      dto.fileName
    );
    return this.storageService.createPresignedPutUrl({
      storageKey,
      contentType: dto.contentType,
      contentLength: dto.fileSizeBytes,
      visibility: "private",
    });
  }

  @Post("logo/presign-upload")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @RequireClinicFeature("customBrandingEnabled")
  @ApiOperation({
    summary: "Generate a public R2 presigned PUT URL for clinic logo upload (<= 500 KB)",
  })
  async presignLogoUpload(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(presignLogoUploadSchema))
    dto: z.infer<typeof presignLogoUploadSchema>
  ) {
    if (dto.fileSizeBytes > MAX_CLINICAL_FILE_BYTES) {
      throw new DomainException(
        API_ERROR_CODES.FILE_TOO_LARGE,
        "Clinic logo must be 500 KB or smaller.",
        HttpStatus.BAD_REQUEST
      );
    }

    const storageKey = this.storageService.buildLogoKey(
      tenant.clinicId,
      dto.fileName
    );
    return this.storageService.createPresignedPutUrl({
      storageKey,
      contentType: dto.contentType,
      contentLength: dto.fileSizeBytes,
      visibility: "public",
    });
  }

  @Post("receipt/presign-upload")
  @Roles("super_admin")
  @ApiOperation({
    summary: "Generate a private R2 presigned PUT URL for a payment receipt (<= 1 MB)",
  })
  async presignReceiptUpload(
    @Body(new ZodValidationPipe(presignReceiptUploadSchema))
    dto: z.infer<typeof presignReceiptUploadSchema>
  ) {
    if (dto.fileSizeBytes > MAX_RECEIPT_BYTES) {
      throw new DomainException(
        API_ERROR_CODES.FILE_TOO_LARGE,
        "Payment receipts must be 1 MB or smaller.",
        HttpStatus.BAD_REQUEST
      );
    }

    const storageKey = this.storageService.buildReceiptKey(
      dto.clinicId,
      dto.fileName
    );
    return this.storageService.createPresignedPutUrl({
      storageKey,
      contentType: dto.contentType,
      contentLength: dto.fileSizeBytes,
      visibility: "private",
    });
  }

  @Get("receipt/url")
  @Roles("super_admin")
  @ApiOperation({
    summary: "Generate a short-lived presigned GET URL for a private payment receipt",
  })
  async getReceiptUrl(@Query("storageKey") storageKey: string) {
    if (!storageKey?.startsWith("private/receipts/")) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "Invalid receipt storage key.",
        HttpStatus.BAD_REQUEST
      );
    }
    const url = await this.storageService.createPresignedGetUrl(storageKey, 300);
    return { url };
  }
}
