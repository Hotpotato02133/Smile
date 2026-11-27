import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { User } from "@prisma/client";
import {
  CurrentTenant,
  CurrentUser,
  RequireClinicAccess,
} from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { TenantContext } from "../../common/types/request-context";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import {
  ClinicQuotaGuard,
  RequireClinicFeature,
  RequireClinicWrite,
} from "../auth/guards/clinic-quota.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantAccessGuard } from "../auth/guards/tenant-access.guard";
import {
  type ConfirmClinicalFileDto,
  confirmClinicalFileSchema,
  type RecordToothConditionDto,
  recordToothConditionSchema,
  type SetPatientRecallDto,
  setPatientRecallSchema,
} from "./clinical.schemas";
import { ClinicalService } from "./clinical.service";

@ApiTags("Clinical Odontogram & X-Ray Vault")
@ApiBearerAuth("clerk-jwt")
@Controller("clinical")
@UseGuards(ClerkJwtGuard, RolesGuard, TenantAccessGuard, ClinicQuotaGuard)
export class ClinicalController {
  constructor(private readonly clinicalService: ClinicalService) {}

  @Get("patients/:patientId/chart")
  @RequireClinicAccess(["dentist", "clinic_admin", "receptionist"])
  @ApiOperation({
    summary:
      "Get full clinic-isolated patient chart (32-tooth odontogram, medical alerts, presigned X-rays)",
  })
  getPatientChart(
    @CurrentTenant() tenant: TenantContext,
    @Param("patientId") patientId: string
  ) {
    return this.clinicalService.getPatientChart(tenant, patientId);
  }

  @Post("patients/:patientId/tooth-records")
  @RequireClinicAccess(["dentist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @RequireClinicFeature("odontogramEnabled")
  @ApiOperation({
    summary: "Append a 32-tooth odontogram condition record and broadcast Socket.IO update",
  })
  recordToothCondition(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("patientId") patientId: string,
    @Body(new ZodValidationPipe(recordToothConditionSchema))
    dto: RecordToothConditionDto
  ) {
    return this.clinicalService.recordToothCondition(tenant, actor, patientId, dto);
  }

  @Patch("patients/:patientId/recall")
  @RequireClinicAccess(["dentist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Set 6-month hygiene recall date for a patient" })
  setPatientRecall(
    @CurrentTenant() tenant: TenantContext,
    @Param("patientId") patientId: string,
    @Body(new ZodValidationPipe(setPatientRecallSchema))
    dto: SetPatientRecallDto
  ) {
    return this.clinicalService.setPatientRecallDate(tenant, patientId, dto);
  }

  @Get("patients/:patientId/files")
  @RequireClinicAccess(["dentist", "clinic_admin", "receptionist"])
  @ApiOperation({ summary: "List clinical X-rays/photos with short-lived presigned GET URLs" })
  listPatientFiles(
    @CurrentTenant() tenant: TenantContext,
    @Param("patientId") patientId: string
  ) {
    return this.clinicalService.listPatientFiles(tenant, patientId);
  }

  @Post("files/confirm")
  @RequireClinicAccess(["dentist", "clinic_admin", "receptionist"])
  @RequireClinicWrite("storage")
  @RequireClinicFeature("xrayStorageEnabled")
  @ApiOperation({
    summary:
      "Verify uploaded R2 file size via HeadObject (<= 500 KB) and record clinical file + quota",
  })
  confirmFile(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(confirmClinicalFileSchema))
    dto: ConfirmClinicalFileDto
  ) {
    return this.clinicalService.confirmClinicalFile(tenant, actor, dto);
  }

  @Delete("files/:fileId")
  @RequireClinicAccess(["dentist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({
    summary: "Delete clinical X-ray/photo from R2 and decrement clinic storageUsedBytes",
  })
  deleteFile(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("fileId") fileId: string
  ) {
    return this.clinicalService.deleteClinicalFile(tenant, actor, fileId);
  }
}
