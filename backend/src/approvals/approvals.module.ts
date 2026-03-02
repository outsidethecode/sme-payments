import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { PurchaseOrdersModule } from "../purchase-orders/purchase-orders.module";
import { ApprovalsService } from "./approvals.service";
import { ApprovalsController } from "./approvals.controller";

@Module({
  imports: [PrismaModule, LedgerModule, forwardRef(() => PurchaseOrdersModule)],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
