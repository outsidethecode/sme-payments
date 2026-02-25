import { Module } from "@nestjs/common";
import { EarlyPaymentsService } from "./early-payments.service";
import { EarlyPaymentsController } from "./early-payments.controller";
import { LedgerModule } from "../ledger/ledger.module";

@Module({
  imports: [LedgerModule],
  controllers: [EarlyPaymentsController],
  providers: [EarlyPaymentsService],
  exports: [EarlyPaymentsService],
})
export class EarlyPaymentsModule {}
