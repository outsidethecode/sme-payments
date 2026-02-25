/** Platform fee configuration (in basis points, 1 bps = 0.01%) */
export const PLATFORM_FEES = {
  /** Transaction fee charged on every settled PO (default 50 bps = 0.5%) */
  TRANSACTION_FEE_BPS: 50,

  /** Early payment facilitation fee (default 250 bps = 2.5%) — flat service fee (ujrah) */
  EARLY_PAY_FEE_BPS: 250,
} as const;

/** Default acceptance window in hours */
export const DEFAULT_ACCEPTANCE_WINDOW_HOURS = 48;

/** PO amount limits in pennies */
export const PO_LIMITS = {
  MIN_AMOUNT: 500_00, // £500
  MAX_AMOUNT: 250_000_00, // £250,000
} as const;

/** Currency */
export const CURRENCY = "GBP" as const;

/** Simulated initial balances for seeded accounts (in pennies) */
export const SEED_BALANCES = {
  BUYER: 500_000_00, // £500,000
  SUPPLIER: 50_000_00, // £50,000
  LIQUIDITY_PARTNER: 2_000_000_00, // £2,000,000
} as const;
