"use client";

import { formatCurrency } from "@/lib/format";

interface MoneyProps {
  /** Amount in minor units (pennies / halalas) */
  amount: number;
  /** ISO 4217 currency code */
  currency?: "GBP" | "SAR";
  /** Additional CSS class names */
  className?: string;
}

/**
 * Renders a monetary value with the correct currency symbol.
 * Accepts amount in minor units and an optional currency code.
 */
export function Money({ amount, currency = "GBP", className }: MoneyProps) {
  return (
    <span className={className} data-currency={currency}>
      {formatCurrency(amount, currency)}
    </span>
  );
}
