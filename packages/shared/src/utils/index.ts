/** Format smallest-unit amount to a human-readable currency string */
export function formatCurrency(
  amount: number,
  currency: "GBP" | "SAR" = "GBP",
): string {
  const locale = currency === "SAR" ? "ar-SA" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

/**
 * Currency metadata
 *   subUnit: name of the smallest unit (pence / halalah)
 *   subUnitsPerUnit: 100 for both GBP and SAR
 *   symbol: human-readable symbol
 */
export const CURRENCY_META: Record<
  string,
  { subUnit: string; subUnitsPerUnit: number; symbol: string }
> = {
  GBP: { subUnit: "pence", subUnitsPerUnit: 100, symbol: "£" },
  SAR: { subUnit: "halalah", subUnitsPerUnit: 100, symbol: "SAR" },
};

/** Calculate early-pay service fee (flat fee based on BPS) */
export function calculateServiceFee(amount: number, feeBps: number): number {
  return Math.round((amount * feeBps) / 10_000);
}

/** Generate a PO reference number */
export function generatePOReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${timestamp}-${random}`;
}
