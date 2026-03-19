import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

/**
 * All recognized feature flags.
 * The string values are used as keys in env JSON and DB rows.
 */
export enum FeatureFlag {
  REAL_BANK_ESCROW = "REAL_BANK_ESCROW",
  REAL_KYB_PROVIDER = "REAL_KYB_PROVIDER",
  LP_MARKETPLACE = "LP_MARKETPLACE",
  EARLY_PAYMENTS = "EARLY_PAYMENTS",
  MULTI_CURRENCY = "MULTI_CURRENCY",
  ESCROW_TRANSACTIONS = "ESCROW_TRANSACTIONS",
  POLICY_ENGINE = "POLICY_ENGINE",
  SUPPLIER_APPROVALS = "SUPPLIER_APPROVALS",
  LP_FUNDING_APPROVALS = "LP_FUNDING_APPROVALS",
  DELEGATION = "DELEGATION",
  ESCALATION = "ESCALATION",
}

/** Resolved flag status including its source */
export interface FlagStatus {
  flag: string;
  enabled: boolean;
  source: "env" | "db-global" | "db-org" | "default";
}

/**
 * Built-in defaults for flags.
 * Already-shipped features default to ON; new/experimental features default to OFF.
 */
const BUILTIN_DEFAULTS: Record<FeatureFlag, boolean> = {
  [FeatureFlag.REAL_BANK_ESCROW]: false,
  [FeatureFlag.REAL_KYB_PROVIDER]: false,
  [FeatureFlag.LP_MARKETPLACE]: false,
  [FeatureFlag.EARLY_PAYMENTS]: true, // shipped — default ON
  [FeatureFlag.MULTI_CURRENCY]: true, // shipped — default ON
  [FeatureFlag.ESCROW_TRANSACTIONS]: true, // shipped — default ON
  [FeatureFlag.POLICY_ENGINE]: false, // default OFF until pilot
  [FeatureFlag.SUPPLIER_APPROVALS]: false, // Phase 9 — OFF until pilot
  [FeatureFlag.LP_FUNDING_APPROVALS]: false, // Phase 9 — OFF until pilot
  [FeatureFlag.DELEGATION]: false, // Phase 9 — OFF until pilot
  [FeatureFlag.ESCALATION]: false, // Phase 9 — OFF until pilot
};

/**
 * Runtime feature flag service.
 *
 * Resolution order (first match wins):
 *   1. Per-org DB override (`FeatureFlagOverride` where flag + organisationId)
 *   2. Global DB override  (`FeatureFlagOverride` where flag + organisationId IS NULL)
 *   3. `FEATURE_FLAGS` env-var JSON   (e.g. `{"EARLY_PAYMENTS":true}`)
 *   4. Hard-coded default → `false`
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly envDefaults: Record<string, boolean>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const raw = this.config.get<string>("FEATURE_FLAGS") || "{}";
    try {
      this.envDefaults = JSON.parse(raw);
    } catch {
      this.logger.warn(
        `Invalid FEATURE_FLAGS env var — ignoring. Value: ${raw}`,
      );
      this.envDefaults = {};
    }
    this.logger.log(
      `Feature flag env defaults: ${JSON.stringify(this.envDefaults)}`,
    );
  }

  /**
   * Check whether a feature flag is enabled.
   *
   * @param flag    - The flag to check
   * @param orgId   - Optional organisation ID for per-org overrides
   * @returns true if the feature is enabled
   */
  async isEnabled(flag: FeatureFlag, orgId?: string): Promise<boolean> {
    // 1. Per-org DB override
    if (orgId) {
      const orgOverride = await this.prisma.featureFlagOverride.findUnique({
        where: {
          flag_organisationId: { flag, organisationId: orgId },
        },
      });
      if (orgOverride) {
        return orgOverride.enabled;
      }
    }

    // 2. Global DB override (organisationId IS NULL)
    const globalOverride = await this.prisma.featureFlagOverride.findFirst({
      where: { flag, organisationId: null },
    });
    if (globalOverride) {
      return globalOverride.enabled;
    }

    // 3. Env-var default
    if (flag in this.envDefaults) {
      return !!this.envDefaults[flag];
    }

    // 4. Hard-coded built-in default
    return BUILTIN_DEFAULTS[flag] ?? false;
  }

  /**
   * List all known flags with their resolved status for a given org (or globally).
   */
  async listFlags(orgId?: string): Promise<FlagStatus[]> {
    const flags = Object.values(FeatureFlag);
    const result: FlagStatus[] = [];

    for (const flag of flags) {
      // Check per-org override
      if (orgId) {
        const orgOverride = await this.prisma.featureFlagOverride.findUnique({
          where: {
            flag_organisationId: { flag, organisationId: orgId },
          },
        });
        if (orgOverride) {
          result.push({
            flag,
            enabled: orgOverride.enabled,
            source: "db-org",
          });
          continue;
        }
      }

      // Check global override
      const globalOverride = await this.prisma.featureFlagOverride.findFirst({
        where: { flag, organisationId: null },
      });
      if (globalOverride) {
        result.push({
          flag,
          enabled: globalOverride.enabled,
          source: "db-global",
        });
        continue;
      }

      // Env default
      if (flag in this.envDefaults) {
        result.push({
          flag,
          enabled: !!this.envDefaults[flag],
          source: "env",
        });
        continue;
      }

      // Hard-coded built-in default
      result.push({
        flag,
        enabled: BUILTIN_DEFAULTS[flag] ?? false,
        source: "default",
      });
    }

    return result;
  }

  /**
   * Set a flag override.  Pass `organisationId: undefined` for a global override.
   */
  async setFlag(
    flag: string,
    enabled: boolean,
    organisationId?: string,
  ): Promise<{
    flag: string;
    enabled: boolean;
    organisationId: string | null;
  }> {
    // Find existing override
    const existing = await this.prisma.featureFlagOverride.findFirst({
      where: { flag, organisationId: organisationId ?? null },
    });

    let record;
    if (existing) {
      record = await this.prisma.featureFlagOverride.update({
        where: { id: existing.id },
        data: { enabled },
      });
    } else {
      record = await this.prisma.featureFlagOverride.create({
        data: {
          flag,
          enabled,
          organisationId: organisationId || undefined,
        },
      });
    }

    this.logger.log(
      `Flag ${flag} set to ${enabled} for ${organisationId ?? "GLOBAL"}`,
    );

    return {
      flag: record.flag,
      enabled: record.enabled,
      organisationId: record.organisationId,
    };
  }

  /**
   * Remove a flag override (reverts to next level in cascade).
   */
  async removeOverride(flag: string, organisationId?: string): Promise<void> {
    await this.prisma.featureFlagOverride.deleteMany({
      where: {
        flag,
        organisationId: organisationId ?? null,
      },
    });

    this.logger.log(
      `Flag override ${flag} removed for ${organisationId ?? "GLOBAL"}`,
    );
  }
}
