import { Module } from "@nestjs/common";
import { EarlyPaymentsService } from "./early-payments.service";
import { EarlyPaymentsController } from "./early-payments.controller";
import { LedgerModule } from "../ledger/ledger.module";
import { PoliciesModule } from "../policies/policies.module";
import { OrganisationsModule } from "../organisations/organisations.module";
import { SettlementsModule } from "../settlements/settlements.module";

@Module({
  imports: [
    LedgerModule,
    PoliciesModule,
    OrganisationsModule,
    SettlementsModule,
  ],
  controllers: [EarlyPaymentsController],
  providers: [EarlyPaymentsService],
  exports: [EarlyPaymentsService],
})
export class EarlyPaymentsModule {}
