import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { VerifyService, VerifyReport } from "./verify.service";

@Controller("verify")
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  /**
   * POST /api/verify
   * Public endpoint — no auth required.
   * Accepts a Trust Envelope (evidence pack JSON) and returns a structured verification report.
   */
  @Post()
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      transform: false,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  )
  verify(@Body() body: any): VerifyReport {
    return this.verifyService.verify(body);
  }

  /**
   * GET /api/verify/health
   * Quick check that the verify endpoint is reachable.
   */
  @Get("health")
  health() {
    return { status: "ok", service: "evidence-verify" };
  }
}
