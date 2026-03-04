import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { SettlementsModule } from "../settlements/settlements.module";
import { DisputesService } from "./disputes.service";
import { DisputesController } from "./disputes.controller";

@Module({
  imports: [PrismaModule, LedgerModule, SettlementsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
