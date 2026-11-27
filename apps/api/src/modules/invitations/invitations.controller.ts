import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AllowInactiveUser,
  AllowUnprovisionedUser,
  CurrentAuth,
} from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { AuthContext } from "../../common/types/request-context";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import { InvitationsService } from "./invitations.service";

const declineInvitationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

@ApiTags("Invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get(":token")
  @ApiOperation({ summary: "Public sanitized lookup for an invitation token" })
  getInvitation(@Param("token") token: string) {
    return this.invitationsService.getByToken(token);
  }

  @Post(":token/accept")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("clerk-jwt")
  @UseGuards(ClerkJwtGuard)
  @AllowUnprovisionedUser()
  @AllowInactiveUser()
  @ApiOperation({ summary: "Accept a pending invitation for the signed-in email" })
  acceptInvitation(
    @Param("token") token: string,
    @CurrentAuth() auth: AuthContext
  ) {
    return this.invitationsService.acceptByToken(token, auth);
  }

  @Post(":token/decline")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("clerk-jwt")
  @UseGuards(ClerkJwtGuard)
  @AllowUnprovisionedUser()
  @AllowInactiveUser()
  @ApiOperation({ summary: "Decline a pending invitation" })
  declineInvitation(
    @Param("token") token: string,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(declineInvitationSchema))
    body: { reason?: string }
  ) {
    return this.invitationsService.declineByToken(token, auth, body.reason);
  }
}
