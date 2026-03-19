import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { IdentityService } from "./identity.service";
import { MockIdentityProvider } from "./mock-identity.provider";
import { NafathIdentityProvider } from "./nafath-identity.provider";
import { IDENTITY_PROVIDER } from "./identity-provider.interface";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: IDENTITY_PROVIDER,
      useFactory: (config: ConfigService) => {
        // Check env var at startup — DB overrides are for runtime toggles
        const raw = config.get<string>("FEATURE_FLAGS", "{}");
        let flags: Record<string, boolean> = {};
        try {
          flags = JSON.parse(raw);
        } catch {
          // ignore
        }
        if (flags["REAL_IDENTITY_PROVIDER"]) {
          return new NafathIdentityProvider(config);
        }
        return new MockIdentityProvider();
      },
      inject: [ConfigService],
    },
    IdentityService,
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
