import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { PurchaseOrdersModule } from "../purchase-orders/purchase-orders.module";
import { ApprovalsService } from "./approvals.service";
import { ApprovalsController } from "./approvals.controller";
import { ApprovalCallbackRegistry } from "./approval-callback.registry";
import { EscalationService } from "./escalation.service";

@Module({
  imports: [PrismaModule, LedgerModule, forwardRef(() => PurchaseOrdersModule)],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalCallbackRegistry, EscalationService],
  exports: [ApprovalsService, ApprovalCallbackRegistry],
})
export class ApprovalsModule {}
