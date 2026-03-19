import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OrganisationsModule } from "../organisations/organisations.module";
import { LedgerModule } from "../ledger/ledger.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { PoliciesService } from "./policies.service";
import { PolicyEvaluationService } from "./policy-evaluation.service";
import { PolicyTemplateService } from "./policy-template.service";
import { PoliciesController } from "./policies.controller";

@Module({
  imports: [
    PrismaModule,
    OrganisationsModule,
    LedgerModule,
    forwardRef(() => ApprovalsModule),
  ],
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicyEvaluationService, PolicyTemplateService],
  exports: [PoliciesService, PolicyEvaluationService, PolicyTemplateService],
})
export class PoliciesModule {}
