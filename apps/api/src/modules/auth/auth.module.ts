import { Global, Module } from "@nestjs/common";
import { ClerkService } from "./clerk.service";
import { ClerkJwtGuard } from "./guards/clerk-jwt.guard";
import { ClinicQuotaGuard } from "./guards/clinic-quota.guard";
import { RolesGuard } from "./guards/roles.guard";
import { TenantAccessGuard } from "./guards/tenant-access.guard";

@Global()
@Module({
  providers: [
    ClerkService,
    ClerkJwtGuard,
    RolesGuard,
    TenantAccessGuard,
    ClinicQuotaGuard,
  ],
  exports: [
    ClerkService,
    ClerkJwtGuard,
    RolesGuard,
    TenantAccessGuard,
    ClinicQuotaGuard,
  ],
})
export class AuthModule {}
