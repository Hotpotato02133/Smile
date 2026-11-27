import { Global, Module } from "@nestjs/common";
import { AuditLogInterceptor } from "./audit-log.interceptor";
import { AuditService } from "./audit.service";

@Global()
@Module({
  providers: [AuditService, AuditLogInterceptor],
  exports: [AuditService, AuditLogInterceptor],
})
export class AuditModule {}
