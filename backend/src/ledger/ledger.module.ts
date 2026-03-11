import { Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";
import { AnchorService } from "./anchor.service";
import { AnchorSchedulerService } from "./anchor-scheduler.service";
import { LedgerController } from "./ledger.controller";
import { PasskeysModule } from "../passkeys/passkeys.module";
import { ANCHOR_PROVIDER } from "./anchor-providers/anchor-provider.interface";
import { RekorAnchorProvider } from "./anchor-providers/rekor.provider";
import { NoopAnchorProvider } from "./anchor-providers/noop.provider";

@Module({
  imports: [PasskeysModule],
  providers: [
    LedgerService,
    AnchorService,
    AnchorSchedulerService,
    {
      provide: ANCHOR_PROVIDER,
      useFactory: () => {
        const provider = process.env.ANCHOR_PROVIDER ?? "noop";
        if (provider === "rekor") {
          const url =
            process.env.REKOR_URL ??
            "https://rekor.sigstore.dev/api/v1/log/entries";
          return new RekorAnchorProvider(url);
        }
        return new NoopAnchorProvider();
      },
    },
  ],
  controllers: [LedgerController],
  exports: [LedgerService, AnchorService],
})
export class LedgerModule {}
