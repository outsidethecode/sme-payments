import { Module } from "@nestjs/common";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { LedgerModule } from "../ledger/ledger.module";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [LedgerModule, UsersModule],
  providers: [PurchaseOrdersService],
  controllers: [PurchaseOrdersController],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
