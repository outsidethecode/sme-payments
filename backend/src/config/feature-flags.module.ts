import { Global, Module } from "@nestjs/common";
import { FeatureFlagService } from "./feature-flags.service";
import { FeatureFlagController } from "./feature-flags.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FeatureFlagController],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
