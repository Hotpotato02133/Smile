import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma.service";

export interface RecordAuditLogInput {
  actorUserId: string;
  actorRole: string;
  clinicId?: string | null;
  actionType: string;
  targetEntity: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Law #7: Append an immutable audit log entry (supports running inside an active Prisma transaction). */
  async record(
    params: RecordAuditLogInput,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.platformAuditLog.create({
      data: {
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        clinicId: params.clinicId ?? null,
        actionType: params.actionType,
        targetEntity: params.targetEntity,
        targetId: params.targetId,
        metadataJson: JSON.stringify(params.metadata),
      },
    });
  }
}
