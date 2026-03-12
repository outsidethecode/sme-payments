import { Controller, Post, Body, HttpCode, Logger } from "@nestjs/common";
import { SettlementService, BankWebhookPayload } from "./settlement.service";

/**
 * Bank webhook endpoint — NO JWT auth.
 * Authentication is via HMAC-SHA256 signature in the payload.
 *
 * POST /api/settlements/webhooks/bank-callback
 */
@Controller("settlements/webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly service: SettlementService) {}

  @Post("bank-callback")
  @HttpCode(200)
  async bankCallback(@Body() body: BankWebhookPayload) {
    this.logger.log(
      `Bank webhook received: ref=${body.externalRef} status=${body.status}`,
    );

    const result = await this.service.handleBankCallback(body);

    return {
      accepted: result.accepted,
      action: result.action,
      detail: result.detail,
    };
  }
}
