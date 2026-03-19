import { Module, forwardRef } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { LedgerModule } from "../ledger/ledger.module";
import { UsersModule } from "../users/users.module";
import { PoliciesModule } from "../policies/policies.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { OrganisationsModule } from "../organisations/organisations.module";
import { SettlementsModule } from "../settlements/settlements.module";

@Module({
  imports: [
    LedgerModule,
    UsersModule,
    forwardRef(() => PoliciesModule),
    forwardRef(() => ApprovalsModule),
    OrganisationsModule,
    SettlementsModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  providers: [PurchaseOrdersService],
  controllers: [PurchaseOrdersController],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
