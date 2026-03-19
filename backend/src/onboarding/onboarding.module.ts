import { Module } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";
import { OnboardingController } from "./onboarding.controller";
import { KybModule } from "../kyb/kyb.module";
import { IdentityModule } from "../identity/identity.module";
import { PasskeysModule } from "../passkeys/passkeys.module";

@Module({
  imports: [KybModule, IdentityModule, PasskeysModule],
  providers: [OnboardingService],
  controllers: [OnboardingController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
