import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PasskeysService } from "./passkeys.service";

@ApiTags("Passkeys")
@Controller("passkeys")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PasskeysController {
  constructor(private readonly passkeysService: PasskeysService) {}

  // ── Registration ──────────────────────────────────────────

  @Post("register/options")
  @ApiOperation({ summary: "Generate passkey registration options" })
  async registerOptions(@Request() req: any) {
    return this.passkeysService.generateRegOptions(req.user.id);
  }

  @Post("register/verify")
  @ApiOperation({ summary: "Verify passkey registration response" })
  async registerVerify(@Request() req: any, @Body() body: any) {
    return this.passkeysService.verifyRegResponse(req.user.id, body);
  }

  // ── Authentication / Signing ──────────────────────────────

  @Post("authenticate/options")
  @ApiOperation({ summary: "Generate passkey authentication options" })
  async authOptions(@Request() req: any, @Body() body: { purpose?: string }) {
    return this.passkeysService.generateAuthOptions(
      req.user.id,
      body.purpose ?? "login",
    );
  }

  @Post("authenticate/verify")
  @ApiOperation({ summary: "Verify passkey authentication (signing)" })
  async authVerify(
    @Request() req: any,
    @Body() body: { purpose: string; response: any },
  ) {
    return this.passkeysService.verifyAuthResponse(
      req.user.id,
      body.purpose,
      body.response,
    );
  }

  // ── Management ────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List user passkeys" })
  async list(@Request() req: any) {
    return this.passkeysService.listPasskeys(req.user.id);
  }

  @Get("status")
  @ApiOperation({ summary: "Check if user has any passkeys registered" })
  async status(@Request() req: any) {
    const hasPasskey = await this.passkeysService.hasPasskey(req.user.id);
    return { hasPasskey };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a passkey" })
  async remove(@Param("id") id: string, @Request() req: any) {
    return this.passkeysService.deletePasskey(req.user.id, id);
  }
}
