import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../../infra/prisma.service";
import { ClerkService } from "../auth/clerk.service";

export const CLINIC_ROOM = (clinicId: string) => `clinic:${clinicId}`;
export const PUBLIC_CLINIC_ROOM = (slug: string) => `public:clinic:${slug}`;

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly clerkService: ClerkService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Authenticated staff room subscription (`clinic:<clinicId>`).
   * Verifies Clerk JWT and resolves `clinicId` strictly from PostgreSQL (Law #1 & #2).
   */
  @SubscribeMessage("join:clinic")
  async handleJoinClinic(
    @ConnectedSocket() client: Socket,
    @MessageBody() body?: { overrideClinicId?: string }
  ): Promise<{ ok: boolean; room?: string; code?: string }> {
    try {
      const authToken =
        (typeof client.handshake.auth?.token === "string" &&
          client.handshake.auth.token) ||
        (typeof client.handshake.headers.authorization === "string" &&
        client.handshake.headers.authorization.startsWith("Bearer ")
          ? client.handshake.headers.authorization.slice("Bearer ".length)
          : "");

      if (!authToken) {
        return { ok: false, code: "UNAUTHENTICATED" };
      }

      const identity = await this.clerkService.verifySessionToken(authToken);
      const user = await this.prisma.user.findUnique({
        where: { clerkId: identity.clerkId },
      });

      if (!user || !user.isActive) {
        return { ok: false, code: "FORBIDDEN" };
      }

      let targetClinicId: string | null = null;
      if (user.role === "super_admin" && body?.overrideClinicId) {
        targetClinicId = body.overrideClinicId;
      } else if (
        (user.role === "clinic_admin" ||
          user.role === "dentist" ||
          user.role === "receptionist") &&
        user.clinicId
      ) {
        targetClinicId = user.clinicId;
      }

      if (!targetClinicId) {
        return { ok: false, code: "FORBIDDEN" };
      }

      const room = CLINIC_ROOM(targetClinicId);
      await client.join(room);
      return { ok: true, room };
    } catch (error) {
      this.logger.warn(
        `Rejected socket join:clinic: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      return { ok: false, code: "UNAUTHENTICATED" };
    }
  }

  /**
   * Unauthenticated public booking room (`public:clinic:<slug>`).
   * Only emits sanitized `{ dateKey }` invalidation signals — zero PHI (Law #6).
   */
  @SubscribeMessage("join:public-clinic")
  async handleJoinPublicClinic(
    @ConnectedSocket() client: Socket,
    @MessageBody() body?: { slug?: string }
  ): Promise<{ ok: boolean; room?: string }> {
    const slug = body?.slug?.trim().toLowerCase();
    if (!slug) return { ok: false };
    const room = PUBLIC_CLINIC_ROOM(slug);
    await client.join(room);
    return { ok: true, room };
  }

  emitAppointmentChanged(params: {
    clinicId: string;
    clinicSlug?: string;
    appointmentId: string;
    dateKey: string;
    status: string;
    action: "created" | "status_changed" | "rescheduled" | "cancelled";
  }): void {
    if (!this.server) return;
    this.server.to(CLINIC_ROOM(params.clinicId)).emit("appointment.changed", {
      appointmentId: params.appointmentId,
      dateKey: params.dateKey,
      status: params.status,
      action: params.action,
      timestamp: Date.now(),
    });
    if (params.clinicSlug) {
      this.server
        .to(PUBLIC_CLINIC_ROOM(params.clinicSlug))
        .emit("slots.changed", { dateKey: params.dateKey });
    }
  }

  emitSlotLockChanged(params: {
    clinicId: string;
    clinicSlug: string;
    dateKey: string;
  }): void {
    if (!this.server) return;
    this.server
      .to(CLINIC_ROOM(params.clinicId))
      .emit("slot_lock.changed", { dateKey: params.dateKey });
    this.server
      .to(PUBLIC_CLINIC_ROOM(params.clinicSlug))
      .emit("slots.changed", { dateKey: params.dateKey });
  }

  emitWaitlistUpdated(params: { clinicId: string; dateKey: string }): void {
    if (!this.server) return;
    this.server
      .to(CLINIC_ROOM(params.clinicId))
      .emit("waitlist.updated", { dateKey: params.dateKey });
  }

  emitOdontogramUpdated(params: {
    clinicId: string;
    patientId: string;
    toothNumber: number;
  }): void {
    if (!this.server) return;
    this.server.to(CLINIC_ROOM(params.clinicId)).emit("odontogram.updated", {
      patientId: params.patientId,
      toothNumber: params.toothNumber,
      timestamp: Date.now(),
    });
  }
}
