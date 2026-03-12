import { Module } from "@nestjs/common";
import { EarlyPaymentsService } from "./early-payments.service";
import { EarlyPaymentsController } from "./early-payments.controller";
import { RiskSnapshotService } from "./risk-snapshot.service";
import { LedgerModule } from "../ledger/ledger.module";
import { PoliciesModule } from "../policies/policies.module";
import { OrganisationsModule } from "../organisations/organisations.module";
import { SettlementsModule } from "../settlements/settlements.module";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    LedgerModule,
    PoliciesModule,
    OrganisationsModule,
    SettlementsModule,
  ],
  controllers: [EarlyPaymentsController],
  providers: [EarlyPaymentsService, RiskSnapshotService],
  exports: [EarlyPaymentsService, RiskSnapshotService],
})
export class EarlyPaymentsModule {}
