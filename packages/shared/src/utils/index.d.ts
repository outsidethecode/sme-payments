export declare function formatCurrency(amount: number, currency?: "GBP" | "SAR"): string;
export declare const CURRENCY_META: Record<string, {
    subUnit: string;
    subUnitsPerUnit: number;
    symbol: string;
}>;
export declare function calculateServiceFee(amount: number, feeBps: number): number;
export declare function generatePOReference(): string;
