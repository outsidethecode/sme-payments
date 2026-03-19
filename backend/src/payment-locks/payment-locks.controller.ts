import { Controller, Get, UseGuards, Request } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { PaymentLocksService } from "./payment-locks.service";

@ApiTags("Payment Locks")
@Controller("payment-locks")
@UseGuards(JwtAuthGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
@ApiBearerAuth()
export class PaymentLocksController {
  constructor(private readonly paymentLocksService: PaymentLocksService) {}

  @Get()
  @ApiOperation({ summary: "List payment locks (filtered by role)" })
  async findAll(@Request() req: any) {
    return this.paymentLocksService.findAll(req.user.id, req.user.role);
  }
}
