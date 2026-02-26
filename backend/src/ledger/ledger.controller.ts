import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LedgerService } from "./ledger.service";
import { PasskeysService } from "../passkeys/passkeys.service";

@ApiTags("Ledger")
@Controller("ledger")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly passkeysService: PasskeysService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List ledger events" })
  @ApiQuery({ name: "entityId", required: false })
  async list(@Query("entityId") entityId?: string) {
    return this.ledgerService.getEvents(entityId);
  }

  @Get("verify/:entityId")
  @ApiOperation({ summary: "Verify hash chain for an entity" })
  async verify(@Param("entityId") entityId: string) {
    return this.ledgerService.verifyChain(entityId);
  }

  /**
   * Step 1 of the sign flow: request a WebAuthn challenge for a specific action.
   * The purpose string ties the challenge to the action being signed.
   */
  @Post("challenge")
  @ApiOperation({ summary: "Request signing challenge for a ledger action" })
  async requestChallenge(
    @Request() req: any,
    @Body() body: { entityId: string; eventType: string },
  ) {
    const purpose = `sign:${body.eventType}:${body.entityId}`;
    const options = await this.passkeysService.generateAuthOptions(
      req.user.id,
      purpose,
    );
    return { purpose, options };
  }

  /**
   * Step 2: Submit a signed event with the WebAuthn assertion.
   * Verifies the assertion, then appends the event with the real signature.
   */
  @Post("events")
  @ApiOperation({ summary: "Submit a passkey-signed ledger event" })
  async submitSignedEvent(
    @Request() req: any,
    @Body()
    body: {
      purpose: string;
      assertion: any;
      entityType: string;
      entityId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ) {
    // Verify the WebAuthn assertion
    const verified = await this.passkeysService.verifyAuthResponse(
      req.user.id,
      body.purpose,
      body.assertion,
    );

    // Append the event with real signature data
    return this.ledgerService.logEvent({
      entityType: body.entityType,
      entityId: body.entityId,
      eventType: body.eventType,
      actorId: req.user.id,
      actorRole: req.user.role,
      payload: body.payload,
      signature: verified.signature,
      authenticatorData: verified.authenticatorData,
      publicKey: verified.publicKey,
      credentialId: verified.credentialId,
    });
  }
}
