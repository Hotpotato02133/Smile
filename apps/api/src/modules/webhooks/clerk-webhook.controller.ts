import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { API_ERROR_CODES } from "@smile/shared";
import { Webhook } from "svix";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { AuthenticatedRequest } from "../../common/types/request-context";
import type { AppEnv } from "../../config/env";
import { UsersService } from "../users/users.service";

interface ClerkEmail {
  id: string;
  email_address: string;
}

interface ClerkPhone {
  id: string;
  phone_number: string;
}

interface ClerkUserPayload {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url?: string | null;
  primary_email_address_id: string | null;
  primary_phone_number_id?: string | null;
  email_addresses: ClerkEmail[];
  phone_numbers?: ClerkPhone[];
}

type ClerkWebhookEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserPayload }
  | { type: "user.deleted"; data: { id?: string } }
  | { type: string; data: unknown };

@ApiTags("Webhooks")
@Controller("webhooks")
export class ClerkWebhookController {
  constructor(
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly usersService: UsersService
  ) {}

  @Post("clerk")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Handle Clerk user lifecycle webhooks (Svix HMAC signature verified)",
  })
  @ApiResponse({ status: 200, description: "Webhook processed." })
  @ApiResponse({ status: 400, description: "Missing or invalid Svix signature." })
  async handleClerkWebhook(
    @Req() req: AuthenticatedRequest,
    @Headers("svix-id") svixId?: string,
    @Headers("svix-timestamp") svixTimestamp?: string,
    @Headers("svix-signature") svixSignature?: string
  ) {
    const secret = this.configService
      .get("CLERK_WEBHOOK_SECRET", { infer: true })
      ?.trim();
    if (!secret) {
      throw new DomainException(
        API_ERROR_CODES.INTERNAL_ERROR,
        "Webhook secret not configured.",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "Missing Svix signature headers.",
        HttpStatus.BAD_REQUEST
      );
    }

    const rawBody = req.rawBody
      ? req.rawBody.toString("utf8")
      : JSON.stringify(req.body ?? {});

    let event: ClerkWebhookEvent;
    try {
      event = new Webhook(secret).verify(rawBody, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as unknown as ClerkWebhookEvent;
    } catch {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "Invalid Svix webhook signature.",
        HttpStatus.BAD_REQUEST
      );
    }

    if (event.type === "user.created" || event.type === "user.updated") {
      const data = (event as { data: ClerkUserPayload }).data;
      const primaryEmail =
        data.email_addresses.find((e) => e.id === data.primary_email_address_id) ??
        data.email_addresses[0];
      if (!primaryEmail) {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "Clerk user payload has no email address.",
          HttpStatus.BAD_REQUEST
        );
      }

      const primaryPhone =
        data.phone_numbers?.find((p) => p.id === data.primary_phone_number_id) ??
        data.phone_numbers?.[0];

      await this.usersService.upsertFromClerk({
        clerkId: data.id,
        email: primaryEmail.email_address,
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        phone: primaryPhone?.phone_number,
        avatarUrl: data.image_url ?? undefined,
      });
    } else if (event.type === "user.deleted") {
      const id = (event as { data: { id?: string } }).data.id;
      if (id) {
        await this.usersService.deactivateFromClerk(id);
      }
    }

    return { received: true };
  }
}
