import { Injectable, Logger, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IdentityProvider,
  IdentityInitiateResult,
  IdentityVerificationResult,
} from "./identity-provider.interface";

/**
 * Nafath identity provider for KSA production.
 *
 * Nafath is Saudi Arabia's national digital identity service operated by Elm.
 * API docs: https://developer.elm.sa
 *
 * Flow:
 *   1. POST /verify { nationalId, serviceId } → { transactionId, random }
 *   2. User confirms the random number on their Nafath mobile app
 *   3. GET /verify/status/{transactionId} → { verified, fullNameAr, ... }
 *
 * Requires env vars:
 *   NAFATH_API_URL     — Nafath API base URL
 *   NAFATH_APP_ID      — Application ID from Elm developer portal
 *   NAFATH_APP_KEY     — Application secret key
 *   NAFATH_SERVICE_ID  — Registered service ID
 */
@Injectable()
export class NafathIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(NafathIdentityProvider.name);
  private readonly apiUrl: string;
  private readonly appId: string;
  private readonly appKey: string;
  private readonly serviceId: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get<string>("NAFATH_API_URL", "");
    this.appId = this.config.get<string>("NAFATH_APP_ID", "");
    this.appKey = this.config.get<string>("NAFATH_APP_KEY", "");
    this.serviceId = this.config.get<string>("NAFATH_SERVICE_ID", "");
  }

  async initiate(nationalId: string): Promise<IdentityInitiateResult> {
    if (!this.apiUrl || !this.appId || !this.appKey) {
      throw new NotImplementedException(
        "Nafath API is not configured. Set NAFATH_API_URL, NAFATH_APP_ID, NAFATH_APP_KEY env vars.",
      );
    }

    this.logger.log(
      `Initiating Nafath verification for ${nationalId.slice(0, 2)}***`,
    );

    // TODO: Replace with actual Nafath API call when credentials are available
    //
    // const response = await fetch(`${this.apiUrl}/api/v1/nafath/request`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "APP-ID": this.appId,
    //     "APP-KEY": this.appKey,
    //   },
    //   body: JSON.stringify({
    //     nationalId,
    //     service: this.serviceId,
    //   }),
    // });
    //
    // const data = await response.json();
    // return {
    //   transactionId: data.transId,
    //   random: data.random,
    //   provider: "NAFATH",
    // };

    throw new NotImplementedException(
      "Nafath API integration pending — configure NAFATH_* env vars and complete implementation.",
    );
  }

  async checkStatus(
    transactionId: string,
  ): Promise<IdentityVerificationResult> {
    if (!this.apiUrl || !this.appId || !this.appKey) {
      throw new NotImplementedException(
        "Nafath API is not configured. Set NAFATH_API_URL, NAFATH_APP_ID, NAFATH_APP_KEY env vars.",
      );
    }

    this.logger.log(`Checking Nafath status for transaction ${transactionId}`);

    // TODO: Replace with actual Nafath API call
    //
    // const response = await fetch(
    //   `${this.apiUrl}/api/v1/nafath/request/status/${transactionId}`,
    //   {
    //     headers: {
    //       "APP-ID": this.appId,
    //       "APP-KEY": this.appKey,
    //     },
    //   },
    // );
    //
    // const data = await response.json();
    //
    // if (data.status === "COMPLETED") {
    //   return {
    //     verified: true,
    //     provider: "NAFATH",
    //     nationalIdMasked: this.mask(data.nationalId),
    //     fullNameAr: data.nameAr,
    //     fullNameEn: data.nameEn,
    //     dateOfBirth: data.birthDate,
    //     nationality: data.nationality,
    //     transactionId,
    //     verifiedAt: new Date(),
    //     rawResponse: data,
    //   };
    // }
    //
    // return {
    //   verified: false,
    //   provider: "NAFATH",
    //   transactionId,
    //   errorMessage: data.status === "WAITING" ? "WAITING" : data.errorMessage,
    // };

    throw new NotImplementedException(
      "Nafath API integration pending — configure NAFATH_* env vars and complete implementation.",
    );
  }
}
