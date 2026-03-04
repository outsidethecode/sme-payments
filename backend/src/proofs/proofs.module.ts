import { Module } from "@nestjs/common";
import { ProofGeneratorService } from "./proof-generator.service";
import { ProofVerifierService } from "./proof-verifier.service";
import { ProofsController } from "./proofs.controller";

@Module({
  providers: [ProofGeneratorService, ProofVerifierService],
  controllers: [ProofsController],
  exports: [ProofGeneratorService, ProofVerifierService],
})
export class ProofsModule {}
