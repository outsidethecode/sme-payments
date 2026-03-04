import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { FraudControlsService } from "./fraud-controls.service";
import { LpRiskService } from "./lp-risk.service";
import { RiskController } from "./risk.controller";

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [RiskController],
  providers: [FraudControlsService, LpRiskService],
  exports: [FraudControlsService, LpRiskService],
})
export class RiskModule {}
