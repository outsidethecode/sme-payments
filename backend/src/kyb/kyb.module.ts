import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KybService } from "./kyb.service";
import { MockKybProvider } from "./mock-kyb.provider";
import { KYB_PROVIDER } from "./kyb-provider.interface";

@Module({
  providers: [
    {
      provide: KYB_PROVIDER,
      useFactory: (config: ConfigService) => {
        // Check env var at startup — DB overrides are for runtime toggles
        const raw = config.get<string>("FEATURE_FLAGS", "{}");
        let flags: Record<string, boolean> = {};
        try {
          flags = JSON.parse(raw);
        } catch {
          // ignore
        }
        if (flags["REAL_KYB_PROVIDER"]) {
          // TODO: return new WathqKybProvider(config) when implemented
          throw new Error(
            "WathqKybProvider not yet implemented. Disable REAL_KYB_PROVIDER flag.",
          );
        }
        return new MockKybProvider();
      },
      inject: [ConfigService],
    },
    KybService,
  ],
  exports: [KybService],
})
export class KybModule {}
