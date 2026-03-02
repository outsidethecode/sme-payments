import { Module } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";
import { OnboardingController } from "./onboarding.controller";
import { KybModule } from "../kyb/kyb.module";

@Module({
  imports: [KybModule],
  providers: [OnboardingService],
  controllers: [OnboardingController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
