import { createClerkClient, verifyToken } from "@clerk/backend";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { API_ERROR_CODES } from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { VerifiedClerkIdentity } from "../../common/types/request-context";
import type { AppEnv } from "../../config/env";

export interface ClerkUserProfile {
  clerkId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
}

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly secretKey: string | undefined;
  private readonly client: ReturnType<typeof createClerkClient> | null;

  constructor(configService: ConfigService<AppEnv, true>) {
    this.secretKey = configService.get("CLERK_SECRET_KEY", { infer: true })?.trim();
    this.client = this.secretKey
      ? createClerkClient({ secretKey: this.secretKey })
      : null;
  }

  async verifySessionToken(token: string): Promise<VerifiedClerkIdentity> {
    if (!this.secretKey) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Authentication provider is not configured on the server.",
        HttpStatus.UNAUTHORIZED
      );
    }

    try {
      const payload = await verifyToken(token, {
        secretKey: this.secretKey,
      });

      if (!payload.sub) {
        throw new DomainException(
          API_ERROR_CODES.UNAUTHENTICATED,
          "Invalid session token: missing subject.",
          HttpStatus.UNAUTHORIZED
        );
      }

      const claims = payload as Record<string, unknown>;
      return {
        clerkId: payload.sub,
        email: typeof claims.email === "string" ? claims.email : undefined,
        firstName:
          typeof claims.given_name === "string"
            ? claims.given_name
            : typeof claims.first_name === "string"
              ? claims.first_name
              : undefined,
        lastName:
          typeof claims.family_name === "string"
            ? claims.family_name
            : typeof claims.last_name === "string"
              ? claims.last_name
              : undefined,
        phone:
          typeof claims.phone_number === "string" ? claims.phone_number : undefined,
        avatarUrl:
          typeof claims.picture === "string" ? claims.picture : undefined,
        claims,
      };
    } catch (error) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Invalid or expired authentication token.",
        HttpStatus.UNAUTHORIZED
      );
    }
  }

  /** Fetches authoritative Clerk user profile when session JWT claims omit email/name. */
  async getClerkUserProfile(clerkId: string): Promise<ClerkUserProfile | null> {
    if (!this.client) return null;
    try {
      const clerkUser = await this.client.users.getUser(clerkId);
      const primaryEmail =
        clerkUser.emailAddresses.find(
          (e) => e.id === clerkUser.primaryEmailAddressId
        ) ?? clerkUser.emailAddresses[0];
      const primaryPhone =
        clerkUser.phoneNumbers.find(
          (p) => p.id === clerkUser.primaryPhoneNumberId
        ) ?? clerkUser.phoneNumbers[0];

      return {
        clerkId: clerkUser.id,
        email: primaryEmail?.emailAddress?.trim().toLowerCase() ?? "",
        firstName: clerkUser.firstName ?? "",
        lastName: clerkUser.lastName ?? "",
        phone: primaryPhone?.phoneNumber,
        avatarUrl: clerkUser.imageUrl || undefined,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Clerk profile for ${clerkId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      return null;
    }
  }

  /** Mirrors role & clinicId back into Clerk publicMetadata so Next.js src/proxy.ts can route by role. */
  async syncPublicMetadata(
    clerkId: string,
    role: string,
    clinicId: string | null
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.users.updateUserMetadata(clerkId, {
        publicMetadata: { role, clinicId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync Clerk publicMetadata for ${clerkId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }
}
