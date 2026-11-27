import { Global, Module } from "@nestjs/common";
import { ClerkService } from "./clerk.service";
import { ClerkJwtGuard } from "./guards/clerk-jwt.guard";
import { RolesGuard } from "./guards/roles.guard";
import { TenantAccessGuard } from "./guards/tenant-access.guard";

@Global()
@Module({
  providers: [ClerkService, ClerkJwtGuard, RolesGuard, TenantAccessGuard],
  exports: [ClerkService, ClerkJwtGuard, RolesGuard, TenantAccessGuard],
})
export class AuthModule {}
