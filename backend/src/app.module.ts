import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { PurchaseOrdersModule } from "./purchase-orders/purchase-orders.module";
import { PaymentLocksModule } from "./payment-locks/payment-locks.module";
import { EarlyPaymentsModule } from "./early-payments/early-payments.module";
import { SettlementsModule } from "./settlements/settlements.module";
import { BankModule } from "./bank/bank.module";
import { LedgerModule } from "./ledger/ledger.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    PurchaseOrdersModule,
    PaymentLocksModule,
    EarlyPaymentsModule,
    SettlementsModule,
    BankModule,
    LedgerModule,
    AdminModule,
  ],
})
export class AppModule {}
