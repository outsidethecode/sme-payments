import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PoliciesService } from "./policies.service";
import { PoliciesController } from "./policies.controller";

@Module({
  imports: [PrismaModule],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
