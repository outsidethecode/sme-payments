import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { IntegrityService } from "./integrity.service";
import { SettlementsModule } from "../settlements/settlements.module";

@Module({
  imports: [SettlementsModule],
  controllers: [AdminController],
  providers: [AdminService, IntegrityService],
})
export class AdminModule {}
