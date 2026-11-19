import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const GRACE_PERIOD_MS = 3 * DAY_MS;

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Formats an epoch timestamp as `"YYYY-MM"` in Asia/Manila (UTC+8). */
export function toManilaMonthKey(timestampMs: number): string {
  const d = new Date(timestampMs + MANILA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Formats an epoch timestamp as `"YYYY-MM-DD"` in Asia/Manila (UTC+8). */
export function toManilaDateKey(timestampMs: number): string {
  const d = new Date(timestampMs + MANILA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Law #7: Append an immutable entry to `platformAuditLogs`. */
export async function recordAuditLog(
  ctx: MutationCtx,
  params: {
    actorUserId: Id<"users">;
    actorRole: string;
    clinicId?: Id<"clinics">;
    actionType: string;
    targetEntity: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await ctx.db.insert("platformAuditLogs", {
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    clinicId: params.clinicId,
    actionType: params.actionType,
    targetEntity: params.targetEntity,
    targetId: params.targetId,
    metadataJson: JSON.stringify(params.metadata),
    createdAt: Date.now(),
  });
}
