import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  AllowInactiveUser,
  AllowUnprovisionedUser,
  CurrentAuth,
} from "../../common/decorators/auth.decorators";
import type { AuthContext } from "../../common/types/request-context";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import { UsersService } from "./users.service";

@ApiTags("Users")
@ApiBearerAuth("clerk-jwt")
@Controller("users")
@UseGuards(ClerkJwtGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @AllowUnprovisionedUser()
  @AllowInactiveUser()
  @ApiOperation({
    summary: "Get the currently authenticated user profile from PostgreSQL",
  })
  @ApiResponse({ status: 200, description: "Resolved user profile or null." })
  @ApiResponse({ status: 401, description: "Missing or invalid Clerk JWT." })
  getMe(@CurrentAuth() auth: AuthContext) {
    return this.usersService.toCurrentUserResponse(auth.user);
  }

  @Post("ensure")
  @HttpCode(HttpStatus.OK)
  @AllowUnprovisionedUser()
  @AllowInactiveUser()
  @ApiOperation({
    summary:
      "Idempotently provision the signed-in Clerk user and apply role/invitation resolution",
  })
  @ApiResponse({
    status: 200,
    description: "User exists and role/clinic assignment is synced.",
  })
  ensureCurrentUser(@CurrentAuth() auth: AuthContext) {
    return this.usersService.ensureCurrentUser(auth.identity);
  }
}
