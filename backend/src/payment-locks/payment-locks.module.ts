import { Module } from "@nestjs/common";
import { PaymentLocksService } from "./payment-locks.service";
import { PaymentLocksController } from "./payment-locks.controller";

@Module({
  controllers: [PaymentLocksController],
  providers: [PaymentLocksService],
  exports: [PaymentLocksService],
})
export class PaymentLocksModule {}
