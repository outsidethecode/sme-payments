import { Controller, Get, Query, UseGuards, Request } from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UsersService } from "./users.service";

@ApiTags("Users")
@Controller("users")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List users, optionally filtered by role" })
  @ApiQuery({ name: "role", required: false })
  async findAll(@Query("role") role?: string) {
    if (role) {
      return this.usersService.findByRole(role);
    }
    // Return all users (for admin usage)
    return this.usersService.findByRole("BUYER");
  }

  @Get("balance")
  @ApiOperation({ summary: "Get current user balance" })
  async getBalance(@Request() req: any) {
    const balance = await this.usersService.getBalance(req.user.id);
    return { balance };
  }
}
