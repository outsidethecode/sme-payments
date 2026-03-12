import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { SettlementService } from "./settlement.service";
import { SettlementsController } from "./settlements.controller";
import { WebhookController } from "./webhook.controller";
import { SimulatedAdapter } from "./simulated.adapter";
import { KSABankTransferAdapter } from "./ksa-bank.adapter";
import { SETTLEMENT_ADAPTER } from "./settlement-adapter.interface";
import { InstrumentService } from "./instrument.service";
import { ReconciliationService } from "./reconciliation.service";

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
  controllers: [SettlementsController, WebhookController],
  providers: [
    SettlementService,
    InstrumentService,
    ReconciliationService,
    adapterProvider,
    SimulatedAdapter,
    KSABankTransferAdapter,
  ],
  exports: [
    SettlementService,
    InstrumentService,
    ReconciliationService,
    SETTLEMENT_ADAPTER,
  ],
})
export class SettlementsModule {}
