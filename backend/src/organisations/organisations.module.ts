import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { OrganisationsService } from "./organisations.service";
import { OrganisationsController } from "./organisations.controller";
import { DelegationService } from "./delegation.service";

@Module({
  imports: [PrismaModule, LedgerModule],
  providers: [OrganisationsService, DelegationService],
  controllers: [OrganisationsController],
  exports: [OrganisationsService, DelegationService],
})
export class OrganisationsModule {}
