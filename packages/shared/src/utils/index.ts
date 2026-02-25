/** Format pennies to human-readable GBP string */
export function formatCurrency(pennies: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pennies / 100);
}

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
