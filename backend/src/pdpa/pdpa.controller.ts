import { Controller, Get, Delete, UseGuards, Request } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { PdpaService } from "./pdpa.service";

@ApiTags("PDPA / Data Protection")
@Controller("pdpa")
@UseGuards(JwtAuthGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
@ApiBearerAuth()
export class PdpaController {
  constructor(private readonly pdpaService: PdpaService) {}

  @Get("export")
  @ApiOperation({
    summary: "Export all personal data (PDPA Subject Access Request)",
  })
  async exportMyData(@Request() req: any) {
    return this.pdpaService.exportUserData(req.user.id);
  }

  @Delete("erase")
  @ApiOperation({
    summary: "Erase personal data (PDPA Right to Erasure / pseudonymisation)",
  })
  async eraseMyData(@Request() req: any) {
    return this.pdpaService.eraseUserData(req.user.id);
  }
}
