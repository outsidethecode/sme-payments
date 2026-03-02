import { Module } from "@nestjs/common";
import { KybService } from "./kyb.service";
import { MockKybProvider } from "./mock-kyb.provider";
import { KYB_PROVIDER } from "./kyb-provider.interface";

@Module({
  providers: [
    {
      provide: KYB_PROVIDER,
      useClass: MockKybProvider,
    },
    KybService,
  ],
  exports: [KybService],
})
export class KybModule {}
