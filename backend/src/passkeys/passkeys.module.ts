import { Module } from "@nestjs/common";
import { PasskeysService } from "./passkeys.service";
import { PasskeysController } from "./passkeys.controller";

@Module({
  providers: [PasskeysService],
  controllers: [PasskeysController],
  exports: [PasskeysService],
})
export class PasskeysModule {}
