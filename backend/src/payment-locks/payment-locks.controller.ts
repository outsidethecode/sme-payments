import { Controller, Get, UseGuards, Request } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PaymentLocksService } from "./payment-locks.service";

@ApiTags("Payment Locks")
@Controller("payment-locks")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentLocksController {
  constructor(private readonly paymentLocksService: PaymentLocksService) {}

  @Get()
  @ApiOperation({ summary: "List payment locks (filtered by role)" })
  async findAll(@Request() req: any) {
    return this.paymentLocksService.findAll(req.user.id, req.user.role);
  }
}
