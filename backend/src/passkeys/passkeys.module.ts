import { Global, Module } from "@nestjs/common";
import { PasskeysService } from "./passkeys.service";
import { PasskeysController } from "./passkeys.controller";
import { RedisChallengeStore } from "./redis-challenge-store";

@Global()
@Module({
  providers: [PasskeysService, RedisChallengeStore],
  controllers: [PasskeysController],
  exports: [PasskeysService],
})
export class PasskeysModule {}
