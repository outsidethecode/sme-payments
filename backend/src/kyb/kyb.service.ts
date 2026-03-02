import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  KybProvider,
  KybVerificationResult,
  KYB_PROVIDER,
} from "./kyb-provider.interface";

@Injectable()
export class KybService {
  private readonly logger = new Logger(KybService.name);

  constructor(
    @Inject(KYB_PROVIDER)
    private readonly provider: KybProvider,
  ) {}

  /**
   * Verify a business registration number.
   */
  async verify(
    registrationNo: string,
    jurisdiction: string,
    metadata?: Record<string, any>,
  ): Promise<KybVerificationResult> {
    this.logger.log(
      `KYB verification requested for ${registrationNo} (${jurisdiction})`,
    );
    return this.provider.verify(registrationNo, jurisdiction, metadata);
  }

  /**
   * Run sanctions screening.
   */
  async checkSanctions(
    entityName: string,
    jurisdiction: string,
  ): Promise<{ clean: boolean; details?: string }> {
    this.logger.log(
      `Sanctions check requested for "${entityName}" (${jurisdiction})`,
    );
    return this.provider.checkSanctions(entityName, jurisdiction);
  }
}
