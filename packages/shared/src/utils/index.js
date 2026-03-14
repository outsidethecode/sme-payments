"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENCY_META = void 0;
exports.formatCurrency = formatCurrency;
exports.calculateServiceFee = calculateServiceFee;
exports.generatePOReference = generatePOReference;
function formatCurrency(amount, currency = "GBP") {
    const locale = currency === "SAR" ? "ar-SA" : "en-GB";
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
    }).format(amount / 100);
}
exports.CURRENCY_META = {
    GBP: { subUnit: "pence", subUnitsPerUnit: 100, symbol: "£" },
    SAR: { subUnit: "halalah", subUnitsPerUnit: 100, symbol: "SAR" },
};
function calculateServiceFee(amount, feeBps) {
    return Math.round((amount * feeBps) / 10_000);
}
function generatePOReference() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PO-${timestamp}-${random}`;
}
//# sourceMappingURL=index.js.map