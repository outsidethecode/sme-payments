import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { FeatureFlagService, FeatureFlag } from "./feature-flags.service";

@Controller("admin/feature-flags")
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureFlagController {
  constructor(private readonly flags: FeatureFlagService) {}

  /**
   * GET /admin/feature-flags?orgId=xxx
   * List all flags with resolved status.
   */
  @Get()
  @Roles("ADMIN")
  async listFlags(@Query("orgId") orgId?: string) {
    const flags = await this.flags.listFlags(orgId);
    return { flags, orgId: orgId ?? null };
  }

  /**
   * PATCH /admin/feature-flags/:flag
   * Toggle a flag globally or per-org.
   * Body: { enabled: boolean, organisationId?: string }
   */
  @Patch(":flag")
  @Roles("ADMIN")
  async toggleFlag(
    @Param("flag") flag: string,
    @Body() body: { enabled: boolean; organisationId?: string },
  ) {
    // Validate flag name
    const knownFlags = Object.values(FeatureFlag) as string[];
    if (!knownFlags.includes(flag)) {
      throw new BadRequestException(
        `Unknown flag "${flag}". Known flags: ${knownFlags.join(", ")}`,
      );
    }

    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("`enabled` must be a boolean");
    }

    const result = await this.flags.setFlag(
      flag,
      body.enabled,
      body.organisationId,
    );

    return result;
  }
}
