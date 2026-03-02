import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { SettlementService } from "./settlement.service";
import { SettlementsController } from "./settlements.controller";
import { SimulatedAdapter } from "./simulated.adapter";
import { KSABankTransferAdapter } from "./ksa-bank.adapter";
import { SETTLEMENT_ADAPTER } from "./settlement-adapter.interface";

/**
 * The active adapter is selected by the SETTLEMENT_RAIL env var:
 *   - "KSA_BANK" → KSABankTransferAdapter
 *   - default    → SimulatedAdapter
 */
const adapterProvider = {
  provide: SETTLEMENT_ADAPTER,
  useClass:
    process.env.SETTLEMENT_RAIL === "KSA_BANK"
      ? KSABankTransferAdapter
      : SimulatedAdapter,
};

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [SettlementsController],
  providers: [
    SettlementService,
    adapterProvider,
    SimulatedAdapter,
    KSABankTransferAdapter,
  ],
  exports: [SettlementService, SETTLEMENT_ADAPTER],
})
export class SettlementsModule {}
