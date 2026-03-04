import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { EvidenceController } from "./evidence.controller";
import { EvidenceService } from "./evidence.service";
import { PrismaModule } from "../prisma/prisma.module";
import { LedgerModule } from "../ledger/ledger.module";
import { ProofsModule } from "../proofs/proofs.module";

@Module({
  imports: [
    PrismaModule,
    LedgerModule,
    ProofsModule,
    MulterModule.register({
      storage: memoryStorage(),
    }),
  ],
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
