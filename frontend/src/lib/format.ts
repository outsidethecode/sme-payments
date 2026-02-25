/**
 * Format pennies to GBP string. e.g. 150000 → "£1,500.00"
 */
export function formatCurrency(pennies: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pennies / 100);
}

/**
 * Format ISO date string to human-readable. e.g. "2024-01-15T10:30:00Z" → "15 Jan 2024"
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format ISO date string with time.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * PO status colours for badges
 */
export function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "DRAFT":
      return "secondary";
    case "SENT":
      return "outline";
    case "ACCEPTED":
    case "VERIFIED":
    case "SETTLED":
      return "default";
    case "CANCELLED":
    case "DISPUTED":
      return "destructive";
    default:
      return "secondary";
  }
}

/**
 * Human-readable status label
 */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
