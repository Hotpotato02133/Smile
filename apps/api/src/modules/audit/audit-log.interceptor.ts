import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import {
  AUDIT_LOG_METADATA_KEY,
  type AuditLogMetadata,
} from "../../common/decorators/auth.decorators";
import type { AuthenticatedRequest } from "../../common/types/request-context";
import { AuditService } from "./audit.service";

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditLogMetadata | undefined>(
      AUDIT_LOG_METADATA_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!meta) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return next.handle().pipe(
      tap((result: unknown) => {
        const user = req.auth?.user;
        if (!user) return;

        const targetId =
          (typeof req.params?.id === "string" && req.params.id) ||
          (typeof req.params?.clinicId === "string" && req.params.clinicId) ||
          (result &&
          typeof result === "object" &&
          "id" in result &&
          typeof (result as { id: unknown }).id === "string"
            ? (result as { id: string }).id
            : "unknown");

        void this.auditService
          .record({
            actorUserId: user.id,
            actorRole: user.role,
            clinicId: req.tenant?.clinicId ?? user.clinicId ?? null,
            actionType: meta.actionType,
            targetEntity: meta.targetEntity,
            targetId,
            metadata: {
              method: req.method,
              path: req.url,
              ip: req.ip,
            },
          })
          .catch(() => undefined);
      })
    );
  }
}
