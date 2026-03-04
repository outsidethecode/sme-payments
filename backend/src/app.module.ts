import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { OrganisationsModule } from "./organisations/organisations.module";
import { PoliciesModule } from "./policies/policies.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { PurchaseOrdersModule } from "./purchase-orders/purchase-orders.module";
import { PaymentLocksModule } from "./payment-locks/payment-locks.module";
import { EarlyPaymentsModule } from "./early-payments/early-payments.module";
import { SettlementsModule } from "./settlements/settlements.module";
import { BankModule } from "./bank/bank.module";
import { LedgerModule } from "./ledger/ledger.module";
import { AdminModule } from "./admin/admin.module";
import { PasskeysModule } from "./passkeys/passkeys.module";
import { KybModule } from "./kyb/kyb.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { DisputesModule } from "./disputes/disputes.module";
import { RiskModule } from "./risk/risk.module";
import { HealthModule } from "./health/health.module";
import { PdpaModule } from "./pdpa/pdpa.module";
import { ProofsModule } from "./proofs/proofs.module";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "short", ttl: 1000, limit: 20 },
        { name: "medium", ttl: 60000, limit: 100 },
      ],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganisationsModule,
    PoliciesModule,
    ApprovalsModule,
    PurchaseOrdersModule,
    PaymentLocksModule,
    EarlyPaymentsModule,
    SettlementsModule,
    BankModule,
    LedgerModule,
    AdminModule,
    PasskeysModule,
    KybModule,
    InvitationsModule,
    OnboardingModule,
    EvidenceModule,
    DisputesModule,
    RiskModule,
    HealthModule,
    PdpaModule,
    ProofsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
