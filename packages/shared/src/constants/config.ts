/** Platform fee configuration (in basis points, 1 bps = 0.01%) */
export const PLATFORM_FEES = {
  /** Transaction fee charged on every settled PO (default 50 bps = 0.5%) */
  TRANSACTION_FEE_BPS: 50,

  /** Early payment facilitation fee (default 250 bps = 2.5%) — flat service fee (ujrah) */
  EARLY_PAY_FEE_BPS: 250,
} as const;

/** Default acceptance window in hours */
export const DEFAULT_ACCEPTANCE_WINDOW_HOURS = 48;

/** PO amount limits in minor units, per currency */
export const PO_LIMITS: Record<
  string,
  { MIN_AMOUNT: number; MAX_AMOUNT: number }
> = {
  GBP: { MIN_AMOUNT: 500_00, MAX_AMOUNT: 250_000_00 }, // £500 – £250,000
  SAR: { MIN_AMOUNT: 1_875_00, MAX_AMOUNT: 937_500_00 }, // SAR 1,875 – SAR 937,500 (≈ equivalent)
} as const;

/** Simulated initial balances for seeded accounts (in minor units), per currency */
export const SEED_BALANCES: Record<
  string,
  { BUYER: number; SUPPLIER: number; LIQUIDITY_PARTNER: number }
> = {
  GBP: {
    BUYER: 500_000_00, // £500,000
    SUPPLIER: 50_000_00, // £50,000
    LIQUIDITY_PARTNER: 2_000_000_00, // £2,000,000
  },
  SAR: {
    BUYER: 1_875_000_00, // SAR 1,875,000
    SUPPLIER: 187_500_00, // SAR 187,500
    LIQUIDITY_PARTNER: 7_500_000_00, // SAR 7,500,000
  },
} as const;
