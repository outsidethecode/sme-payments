import { Module } from "@nestjs/common";
import { PdpaService } from "./pdpa.service";
import { PdpaController } from "./pdpa.controller";

@Module({
  controllers: [PdpaController],
  providers: [PdpaService],
})
export class PdpaModule {}
