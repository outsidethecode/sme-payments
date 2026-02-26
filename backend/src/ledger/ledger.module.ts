import { Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";
import { LedgerController } from "./ledger.controller";
import { PasskeysModule } from "../passkeys/passkeys.module";

@Module({
  imports: [PasskeysModule],
  providers: [LedgerService],
  controllers: [LedgerController],
  exports: [LedgerService],
})
export class LedgerModule {}
